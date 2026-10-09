import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import { SubscriptionLimitService } from './subscription-limit.service.js';
import { BillingProviderRegistry } from '../billing/billing-provider.registry.js';
import { ChangePlanDto, CancelSubscriptionDto, StartTrialDto } from '../dto/subscription.dto.js';
import {
  Prisma,
  SubscriptionStatus,
  BillingRecordStatus,
  MemberStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';

import { AuditLogService } from '../../audit-log/audit-log.service.js';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly limitService: SubscriptionLimitService,
    private readonly providerRegistry: BillingProviderRegistry,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Helper to generate human-readable sequential invoice number
   */
  private generateInvoiceNumber(): string {
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = randomBytes(3).toString('hex').toUpperCase();
    return `INV-${datePrefix}-${randomSuffix}`;
  }

  /**
   * Calculate next period end from start date
   */
  private calculatePeriodEnd(start: Date, billingCycle: 'MONTHLY' | 'YEARLY'): Date {
    const end = new Date(start.getTime());
    if (billingCycle === 'YEARLY') {
      end.setUTCFullYear(end.getUTCFullYear() + 1);
    } else {
      end.setUTCMonth(end.getUTCMonth() + 1);
    }
    return end;
  }

  /**
   * Get current organization subscription and plan details
   */
  async getCurrentSubscription(organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const sub = await this.limitService.getEffectiveSubscription(organizationId, tx);
      const usage = await this.limitService.getSubscriptionUsage(organizationId);
      return {
        subscription: sub,
        usage,
      };
    });
  }

  /**
   * Start 14-day free trial on PRO plan (one-time per organization)
   */
  async startTrial(organizationId: string, dto: StartTrialDto) {
    const targetPlanCode = (dto.planCode || 'PRO').toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock organization row
      const org = await this.limitService.lockOrganization(organizationId, tx);

      if (org.hasUsedTrial) {
        throw new BadRequestException('Organization has already utilized its free trial period');
      }

      const targetPlan = await tx.plan.findUnique({
        where: { code: targetPlanCode },
      });

      if (!targetPlan || !targetPlan.isActive) {
        throw new NotFoundException(`Plan '${targetPlanCode}' is not available for trial`);
      }

      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days

      // Update organization to mark trial used
      await tx.organization.update({
        where: { id: organizationId },
        data: { hasUsedTrial: true },
      });

      // Find existing active subscription
      const existingSub = await tx.subscription.findFirst({
        where: {
          organizationId,
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE],
          },
        },
      });

      if (existingSub) {
        // Upgrade existing subscription to trialing
        const updated = await tx.subscription.update({
          where: { id: existingSub.id },
          data: {
            planId: targetPlan.id,
            status: SubscriptionStatus.TRIAL,
            currentPeriodStart: now,
            currentPeriodEnd: trialEndsAt,
            trialEndsAt,
            cancelAtPeriodEnd: false,
          },
          include: { plan: true },
        });

        await this.auditLogService.logAction(
          {
            action: 'SUBSCRIPTION_START_TRIAL',
            entity: 'Subscription',
            entityId: updated.id,
            organizationId,
            newData: { plan: targetPlan.code, trialEndsAt },
          },
          tx,
        );

        return updated;
      }

      // Create new trialing subscription
      const created = await tx.subscription.create({
        data: {
          organizationId,
          planId: targetPlan.id,
          status: SubscriptionStatus.TRIAL,
          billingCycle: 'MONTHLY',
          startDate: now,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
          trialEndsAt,
          provider: 'INTERNAL_SYSTEM',
        },
        include: { plan: true },
      });

      await this.auditLogService.logAction(
        {
          action: 'SUBSCRIPTION_START_TRIAL',
          entity: 'Subscription',
          entityId: created.id,
          organizationId,
          newData: { plan: targetPlan.code, trialEndsAt },
        },
        tx,
      );

      return created;
    });
  }

  /**
   * Change subscription plan (Upgrade, Downgrade, or Cycle Switch)
   * With transaction safety and server-side billing verification
   */
  async changePlan(organizationId: string, dto: ChangePlanDto) {
    const targetCode = dto.planCode.toUpperCase();
    const billingCycle = dto.billingCycle;

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock organization row
      await this.limitService.lockOrganization(organizationId, tx);

      // 2. Fetch target plan
      const targetPlan = await tx.plan.findUnique({
        where: { code: targetCode },
      });

      if (!targetPlan || !targetPlan.isActive) {
        throw new NotFoundException(`Plan '${targetCode}' is not available`);
      }

      // Safety check: Annual checkout disabled if yearly price is 0
      if (billingCycle === 'YEARLY' && targetPlan.priceYearly.toNumber() <= 0) {
        throw new BadRequestException('Annual billing is currently unavailable for this plan.');
      }

      // 3. Fetch current subscription
      const currentSub = await this.limitService.getEffectiveSubscription(organizationId, tx);

      // Check for downgrade eligibility: current usage must not exceed target plan quotas
      if (targetPlan.maxBranches !== null) {
        const branchCount = await tx.branch.count({
          where: { organizationId, status: 'ACTIVE' },
        });
        if (branchCount > targetPlan.maxBranches) {
          throw new BadRequestException(
            `Cannot switch to '${targetPlan.name}': organization has ${branchCount} active branches (max allowed: ${targetPlan.maxBranches}). Please deactivate branches first.`,
          );
        }
      }

      if (targetPlan.maxStaff !== null) {
        const staffCount = await tx.organizationMember.count({
          where: { organizationId, status: MemberStatus.ACTIVE },
        });
        if (staffCount > targetPlan.maxStaff) {
          throw new BadRequestException(
            `Cannot switch to '${targetPlan.name}': organization has ${staffCount} staff members (max allowed: ${targetPlan.maxStaff}). Please deactivate members first.`,
          );
        }
      }

      if (targetPlan.maxProducts !== null) {
        const productCount = await tx.product.count({
          where: { organizationId, status: 'ACTIVE' },
        });
        if (productCount > targetPlan.maxProducts) {
          throw new BadRequestException(
            `Cannot switch to '${targetPlan.name}': organization has ${productCount} active products (max allowed: ${targetPlan.maxProducts}). Please deactivate products first.`,
          );
        }
      }

      const now = new Date();
      const planPrice = billingCycle === 'YEARLY' ? targetPlan.priceYearly : targetPlan.priceMonthly;
      const isFreePlan = targetPlan.code === 'FREE' || planPrice.toNumber() === 0;

      if (isFreePlan) {
        // Switching to Free plan: execute immediately, reset period
        const periodEnd = this.calculatePeriodEnd(now, 'MONTHLY');
        const updated = await tx.subscription.update({
          where: { id: currentSub.id },
          data: {
            planId: targetPlan.id,
            status: SubscriptionStatus.ACTIVE,
            billingCycle: 'MONTHLY',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
            pendingPlanId: null,
          },
          include: { plan: true },
        });

        await this.auditLogService.logAction(
          {
            action: 'SUBSCRIPTION_CHANGE_PLAN',
            entity: 'Subscription',
            entityId: updated.id,
            organizationId,
            newData: { plan: targetPlan.code, billingCycle: 'MONTHLY' },
          },
          tx,
        );

        return {
          subscription: updated,
          billingRecord: null,
          message: `Successfully switched to Free plan`,
        };
      }

      // Paid plan: Create SubscriptionBillingRecord
      const providerName = (dto.provider || 'INTERNAL_SYSTEM').toUpperCase();
      const invoiceNumber = this.generateInvoiceNumber();
      const periodEnd = this.calculatePeriodEnd(now, billingCycle);

      // Verify transaction if provided (e.g., immediate settlement)
      let recordStatus: BillingRecordStatus = BillingRecordStatus.PENDING;
      let paidAt: Date | null = null;

      if (dto.transactionId) {
        const provider = this.providerRegistry.getProvider(providerName);
        const verification = await provider.verifyTransaction(dto.transactionId);
        if (verification.isPaid) {
          recordStatus = BillingRecordStatus.PAID;
          paidAt = verification.paidAt || now;
        }
      }

      const billingRecord = await tx.subscriptionBillingRecord.create({
        data: {
          organizationId,
          subscriptionId: currentSub.id,
          invoiceNumber,
          planCode: targetPlan.code,
          planName: targetPlan.name,
          amount: planPrice,
          currency: targetPlan.currency,
          billingCycle,
          periodStart: now,
          periodEnd,
          status: recordStatus,
          paidAt,
          provider: providerName,
          transactionId: dto.transactionId || null,
        },
      });

      // If already paid (or dummy/manual success), activate subscription immediately
      let updatedSubscription = currentSub;
      if (recordStatus === BillingRecordStatus.PAID) {
        updatedSubscription = await tx.subscription.update({
          where: { id: currentSub.id },
          data: {
            planId: targetPlan.id,
            status: SubscriptionStatus.ACTIVE,
            billingCycle,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            pendingPlanId: null,
          },
          include: { plan: true },
        });

        await this.auditLogService.logAction(
          {
            action: 'SUBSCRIPTION_UPGRADE_ACTIVE',
            entity: 'Subscription',
            entityId: updatedSubscription.id,
            organizationId,
            newData: { plan: targetPlan.code, billingCycle, invoiceNumber },
          },
          tx,
        );
      } else {
        // Flag pending upgrade awaiting payment
        updatedSubscription = await tx.subscription.update({
          where: { id: currentSub.id },
          data: {
            pendingPlanId: targetPlan.id,
          },
          include: { plan: true },
        });

        await this.auditLogService.logAction(
          {
            action: 'SUBSCRIPTION_UPGRADE_PENDING',
            entity: 'Subscription',
            entityId: updatedSubscription.id,
            organizationId,
            newData: { targetPlan: targetPlan.code, invoiceNumber },
          },
          tx,
        );
      }

      return {
        subscription: updatedSubscription,
        billingRecord,
        message: recordStatus === BillingRecordStatus.PAID
          ? `Subscription upgraded to ${targetPlan.name} successfully`
          : `Invoice created. Awaiting payment to activate ${targetPlan.name}`,
      };
    });
  }

  /**
   * Cancel subscription (immediate or at period end)
   */
  async cancelSubscription(organizationId: string, dto: CancelSubscriptionDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.limitService.lockOrganization(organizationId, tx);
      const sub = await this.limitService.getEffectiveSubscription(organizationId, tx);

      const now = new Date();

      if (dto.immediately) {
        // Immediate cancellation: downgrade back to canonical Free plan
        const freePlan = await tx.plan.findUnique({ where: { code: 'FREE' } });
        if (!freePlan) {
          throw new NotFoundException('Canonical FREE plan not found');
        }

        const periodEnd = this.calculatePeriodEnd(now, 'MONTHLY');
        const updated = await tx.subscription.update({
          where: { id: sub.id },
          data: {
            planId: freePlan.id,
            status: SubscriptionStatus.ACTIVE,
            billingCycle: 'MONTHLY',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            cancelledAt: now,
            cancellationReason: dto.reason || 'Immediate cancellation by tenant',
            pendingPlanId: null,
          },
          include: { plan: true },
        });

        await this.auditLogService.logAction(
          {
            action: 'SUBSCRIPTION_CANCEL_IMMEDIATE',
            entity: 'Subscription',
            entityId: updated.id,
            organizationId,
            newData: { plan: freePlan.code, reason: dto.reason },
          },
          tx,
        );

        return updated;
      }

      // Period-end cancellation: flag to cancel at period end
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          cancelAtPeriodEnd: true,
          cancellationReason: dto.reason || 'Cancelled by tenant at period end',
        },
        include: { plan: true },
      });

      await this.auditLogService.logAction(
        {
          action: 'SUBSCRIPTION_CANCEL_SCHEDULED',
          entity: 'Subscription',
          entityId: updated.id,
          organizationId,
          newData: { cancelAtPeriodEnd: true, reason: dto.reason },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Reactivate a subscription that was set to cancel at period end
   */
  async reactivateSubscription(organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.limitService.lockOrganization(organizationId, tx);
      const sub = await this.limitService.getEffectiveSubscription(organizationId, tx);

      if (!sub.cancelAtPeriodEnd) {
        throw new BadRequestException('Subscription is not scheduled for cancellation');
      }

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          cancelAtPeriodEnd: false,
          cancellationReason: null,
        },
        include: { plan: true },
      });

      await this.auditLogService.logAction(
        {
          action: 'SUBSCRIPTION_REACTIVATED',
          entity: 'Subscription',
          entityId: updated.id,
          organizationId,
          newData: { cancelAtPeriodEnd: false },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * List billing history / invoices for an organization
   */
  async getBillingHistory(organizationId: string) {
    return this.prisma.subscriptionBillingRecord.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Background Job: Process subscription lifecycle, trial expiry, period-end cancellations, and grace period transitions
   */
  async processSubscriptionLifecycle(batchSize = 50): Promise<{
    expiredTrials: number;
    cancelledSubs: number;
    pastDueSubs: number;
  }> {
    const now = new Date();
    let expiredTrials = 0;
    let cancelledSubs = 0;
    let pastDueSubs = 0;

    const freePlan = await this.prisma.plan.findUnique({
      where: { code: 'FREE' },
    });

    if (!freePlan) {
      this.logger.error('Cannot process subscription lifecycle: canonical FREE plan missing');
      return { expiredTrials, cancelledSubs, pastDueSubs };
    }

    // 1. Process Expired Trials (TRIAL status where trialEndsAt <= now)
    const expiredTrialList = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.TRIAL,
        trialEndsAt: { lte: now },
      },
      take: batchSize,
    });

    for (const sub of expiredTrialList) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "Organization" WHERE id = ${sub.organizationId} FOR UPDATE
        `;

        const periodEnd = this.calculatePeriodEnd(now, 'MONTHLY');
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            planId: freePlan.id,
            status: SubscriptionStatus.ACTIVE,
            billingCycle: 'MONTHLY',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            trialEndsAt: null,
          },
        });

        await this.auditLogService.logAction(
          {
            action: 'SUBSCRIPTION_TRIAL_EXPIRED',
            entity: 'Subscription',
            entityId: sub.id,
            organizationId: sub.organizationId,
            newData: { plan: 'FREE', status: 'ACTIVE' },
          },
          tx,
        );

        expiredTrials++;
      });
    }

    // 2. Process Period-End Cancellations (cancelAtPeriodEnd = true where currentPeriodEnd <= now)
    const scheduledCancellations = await this.prisma.subscription.findMany({
      where: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: { lte: now },
        planId: { not: freePlan.id },
      },
      take: batchSize,
    });

    for (const sub of scheduledCancellations) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "Organization" WHERE id = ${sub.organizationId} FOR UPDATE
        `;

        const periodEnd = this.calculatePeriodEnd(now, 'MONTHLY');
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            planId: freePlan.id,
            status: SubscriptionStatus.ACTIVE,
            billingCycle: 'MONTHLY',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            cancelledAt: now,
            pendingPlanId: null,
          },
        });

        await this.auditLogService.logAction(
          {
            action: 'SUBSCRIPTION_PERIOD_END_CANCELLED',
            entity: 'Subscription',
            entityId: sub.id,
            organizationId: sub.organizationId,
            newData: { plan: 'FREE', cancelledAt: now },
          },
          tx,
        );

        cancelledSubs++;
      });
    }

    // 3. Process Paid Subscriptions that ended past grace period -> PAST_DUE
    const expiredPaidSubs = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        planId: { not: freePlan.id },
        currentPeriodEnd: { lte: now },
        cancelAtPeriodEnd: false,
      },
      take: batchSize,
    });

    for (const sub of expiredPaidSubs) {
      const graceEnd = sub.gracePeriodEndsAt ||
        new Date(sub.currentPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000);

      if (now > graceEnd) {
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "Organization" WHERE id = ${sub.organizationId} FOR UPDATE
          `;

          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              status: SubscriptionStatus.PAST_DUE,
              gracePeriodEndsAt: graceEnd,
            },
          });

          await this.auditLogService.logAction(
            {
              action: 'SUBSCRIPTION_GRACE_PERIOD_EXPIRED',
              entity: 'Subscription',
              entityId: sub.id,
              organizationId: sub.organizationId,
              newData: { status: 'PAST_DUE' },
            },
            tx,
          );

          pastDueSubs++;
        });
      }
    }

    return { expiredTrials, cancelledSubs, pastDueSubs };
  }
}
