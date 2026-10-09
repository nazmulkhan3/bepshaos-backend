import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import { BillingProviderRegistry } from '../billing/billing-provider.registry.js';
import {
  WebhookEventStatus,
  BillingRecordStatus,
  SubscriptionStatus,
} from '@prisma/client';

@Injectable()
export class SubscriptionWebhookService {
  private readonly logger = new Logger(SubscriptionWebhookService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly providerRegistry: BillingProviderRegistry,
  ) {}

  /**
   * Ingest webhook event safely with deduplication and lease locking
   */
  async ingestWebhook(
    providerName: string,
    payload: any,
    headers: Record<string, string>,
  ) {
    const provider = this.providerRegistry.getProvider(providerName);
    const verification = await provider.verifyWebhook(payload, headers);

    if (!verification.isValid) {
      throw new BadRequestException('Webhook signature or verification failed');
    }

    const { providerEventId, eventType, providerTxnId, status, rawPayload } = verification;

    // 1. Check or create durable WebhookEvent record
    let eventRecord = await this.prisma.subscriptionWebhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: providerName.toUpperCase(),
          providerEventId,
        },
      },
    });

    if (eventRecord && eventRecord.status === WebhookEventStatus.PROCESSED) {
      this.logger.log(`Webhook event ${providerEventId} already processed. Skipping.`);
      return { success: true, message: 'Event already processed', eventId: eventRecord.id };
    }

    if (!eventRecord) {
      try {
        eventRecord = await this.prisma.subscriptionWebhookEvent.create({
          data: {
            provider: providerName.toUpperCase(),
            providerEventId,
            providerTxnId,
            eventType,
            organizationId: verification.organizationId || null,
            subscriptionId: verification.subscriptionId || null,
            billingRecordId: verification.billingRecordId || null,
            payload: rawPayload,
            status: WebhookEventStatus.PENDING,
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          // Concurrent duplicate insertion collided on unique(provider, providerEventId)
          eventRecord = await this.prisma.subscriptionWebhookEvent.findUnique({
            where: {
              provider_providerEventId: {
                provider: providerName.toUpperCase(),
                providerEventId,
              },
            },
          });
        } else {
          throw err;
        }
      }
    }

    if (!eventRecord) {
      return { success: false, message: 'Could not record or find webhook event' };
    }

    if (eventRecord.status === WebhookEventStatus.PROCESSED) {
      return { success: true, message: 'Event already processed', eventId: eventRecord.id };
    }

    // 2. Process event atomically with durable lease
    await this.processEvent(eventRecord.id);

    return {
      success: true,
      message: 'Webhook received and processed',
      eventId: eventRecord.id,
    };
  }

  /**
   * Process a webhook event atomically under lease
   */
  async processEvent(eventId: string) {
    const workerId = `worker-${process.pid}-${Date.now()}`;
    const leaseDurationMs = 60 * 1000; // 60s lease
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

    // Try to claim lease
    const updated = await this.prisma.subscriptionWebhookEvent.updateMany({
      where: {
        id: eventId,
        status: { in: [WebhookEventStatus.PENDING, WebhookEventStatus.FAILED] },
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        lockedBy: workerId,
        lockedAt: now,
        leaseExpiresAt,
        status: WebhookEventStatus.PROCESSING,
      },
    });

    if (updated.count === 0) {
      this.logger.warn(`Could not claim lease on webhook event ${eventId}; already locked or processed`);
      return;
    }

    try {
      const event = await this.prisma.subscriptionWebhookEvent.findUnique({
        where: { id: eventId },
      });

      if (!event) return;

      const payload = event.payload as any;

      await this.prisma.$transaction(async (tx) => {
        // Resolve invoice/billing record
        const invoiceNumber = payload.invoiceNumber;
        const transactionId = event.providerTxnId || payload.transactionId;
        const billingRecordId = event.billingRecordId || payload.billingRecordId;

        let billingRecord = null;
        if (billingRecordId) {
          billingRecord = await tx.subscriptionBillingRecord.findUnique({
            where: { id: billingRecordId },
          });
        } else if (invoiceNumber) {
          billingRecord = await tx.subscriptionBillingRecord.findUnique({
            where: { invoiceNumber },
          });
        } else if (transactionId) {
          billingRecord = await tx.subscriptionBillingRecord.findFirst({
            where: { transactionId },
          });
        }

        if (billingRecord) {
          // Acquire Level-1 Organization lock
          await tx.$queryRaw`
            SELECT id FROM "Organization" WHERE id = ${billingRecord.organizationId} FOR UPDATE
          `;

          if (event.eventType === 'PAYMENT_SUCCESS') {
            await tx.subscriptionBillingRecord.update({
              where: { id: billingRecord.id },
              data: {
                status: BillingRecordStatus.PAID,
                paidAt: now,
                transactionId: transactionId || billingRecord.transactionId,
                rawProviderPayload: payload,
              },
            });

            // Activate or extend subscription
            if (billingRecord.subscriptionId) {
              const targetPlan = await tx.plan.findUnique({
                where: { code: billingRecord.planCode },
              });

              if (targetPlan) {
                await tx.subscription.update({
                  where: { id: billingRecord.subscriptionId },
                  data: {
                    planId: targetPlan.id,
                    status: SubscriptionStatus.ACTIVE,
                    billingCycle: billingRecord.billingCycle,
                    currentPeriodStart: billingRecord.periodStart,
                    currentPeriodEnd: billingRecord.periodEnd,
                    cancelAtPeriodEnd: false,
                    pendingPlanId: null,
                  },
                });
              }
            }
          } else if (event.eventType === 'PAYMENT_FAILED') {
            await tx.subscriptionBillingRecord.update({
              where: { id: billingRecord.id },
              data: {
                status: BillingRecordStatus.FAILED,
                rawProviderPayload: payload,
              },
            });

            if (billingRecord.subscriptionId) {
              await tx.subscription.update({
                where: { id: billingRecord.subscriptionId },
                data: {
                  status: SubscriptionStatus.PAST_DUE,
                },
              });
            }
          }
        }
      });

      // Mark event as PROCESSED
      await this.prisma.subscriptionWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          lockedBy: null,
          lockedAt: null,
          leaseExpiresAt: null,
        },
      });

      this.logger.log(`Webhook event ${eventId} successfully processed`);
    } catch (err: any) {
      this.logger.error(`Failed to process webhook event ${eventId}: ${err.message}`, err.stack);
      await this.prisma.subscriptionWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: WebhookEventStatus.FAILED,
          error: err.message,
          retryCount: { increment: 1 },
          lockedBy: null,
          lockedAt: null,
          leaseExpiresAt: null,
        },
      });
      throw err;
    }
  }

  /**
   * Background Recovery: Scan for expired leases and failed webhook events eligible for bounded retry
   */
  async recoverExpiredLeasesAndRetries(maxRetries = 5, limit = 20): Promise<number> {
    const now = new Date();

    // 1. Recover events stuck in PROCESSING past lease expiration
    const stuckEvents = await this.prisma.subscriptionWebhookEvent.findMany({
      where: {
        status: WebhookEventStatus.PROCESSING,
        leaseExpiresAt: { lt: now },
      },
      take: limit,
    });

    for (const event of stuckEvents) {
      await this.prisma.subscriptionWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: WebhookEventStatus.PENDING,
          lockedBy: null,
          lockedAt: null,
          leaseExpiresAt: null,
          error: 'Lease expired; recovered to PENDING for retry',
        },
      });
    }

    // 2. Query retryable events (PENDING or FAILED under maxRetries)
    const retryableEvents = await this.prisma.subscriptionWebhookEvent.findMany({
      where: {
        status: { in: [WebhookEventStatus.PENDING, WebhookEventStatus.FAILED] },
        retryCount: { lt: maxRetries },
      },
      take: limit,
      orderBy: { updatedAt: 'asc' },
    });

    let processedCount = 0;
    for (const event of retryableEvents) {
      try {
        await this.processEvent(event.id);
        processedCount++;
      } catch (err: any) {
        this.logger.warn(`Failed recovery retry for webhook event ${event.id}: ${err.message}`);
      }
    }

    return processedCount;
  }
}
