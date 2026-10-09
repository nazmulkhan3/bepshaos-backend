import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import { Prisma, SubscriptionStatus, MemberStatus, BranchStatus, ProductStatus, SaleStatus } from '@prisma/client';
import { QuotaResourceType, SubscriptionUsage } from '../interfaces/plan-limits.interface.js';

@Injectable()
export class SubscriptionLimitService {
  private readonly logger = new Logger(SubscriptionLimitService.name);

  constructor(private readonly prisma: DatabaseService) {}

  /**
   * Acquire Level-1 Organization row lock inside interactive transaction
   */
  async lockOrganization(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string; status: string; hasUsedTrial: boolean }> {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string; hasUsedTrial: boolean }>>`
      SELECT id, status, "hasUsedTrial"
      FROM "Organization"
      WHERE id = ${organizationId}
      FOR UPDATE
    `;

    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Organization '${organizationId}' not found`);
    }

    return rows[0];
  }

  /**
   * Calculates calendar month period boundaries (UTC) for Free plan lazy rollover
   */
  private getCalendarMonthPeriod(date: Date = new Date()): { start: Date; end: Date } {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    return { start, end };
  }

  /**
   * Synchronizes and lazily rolls over the Free subscription period if expired.
   * Must be called under the Organization row lock.
   */
  async syncSubscriptionPeriod(
    subscription: any,
    tx: Prisma.TransactionClient,
  ): Promise<any> {
    const now = new Date();

    // Only roll over ACTIVE Free plan subscriptions automatically
    if (
      subscription.status === SubscriptionStatus.ACTIVE &&
      subscription.plan.code === 'FREE' &&
      subscription.currentPeriodEnd <= now
    ) {
      const { start, end } = this.getCalendarMonthPeriod(now);
      this.logger.log(
        `Rolling over Free plan period for subscription ${subscription.id} to [${start.toISOString()} - ${end.toISOString()}]`,
      );

      return tx.subscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodStart: start,
          currentPeriodEnd: end,
        },
        include: { plan: true },
      });
    }

    // Check if a paid subscription period ended and needs status evaluation
    if (
      subscription.status === SubscriptionStatus.ACTIVE &&
      subscription.plan.code !== 'FREE' &&
      subscription.currentPeriodEnd <= now
    ) {
      // Check grace period (3 days default)
      const graceEnd = subscription.gracePeriodEndsAt ||
        new Date(subscription.currentPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000);

      if (now > graceEnd) {
        this.logger.warn(`Subscription ${subscription.id} expired past grace period; marking PAST_DUE`);
        return tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: SubscriptionStatus.PAST_DUE,
            gracePeriodEndsAt: graceEnd,
          },
          include: { plan: true },
        });
      }
    }

    return subscription;
  }

  /**
   * Fetch current effective subscription for an organization inside a transaction,
   * creating a canonical FREE subscription if none exists.
   */
  async getEffectiveSubscription(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ) {
    let sub = await tx.subscription.findFirst({
      where: {
        organizationId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE],
        },
      },
      include: {
        plan: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!sub) {
      // Auto-provision canonical FREE subscription
      const freePlan = await tx.plan.findUnique({
        where: { code: 'FREE' },
      });

      if (!freePlan) {
        throw new NotFoundException('Canonical FREE plan not found in database');
      }

      const { start, end } = this.getCalendarMonthPeriod();
      sub = await tx.subscription.create({
        data: {
          organizationId,
          planId: freePlan.id,
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'MONTHLY',
          currentPeriodStart: start,
          currentPeriodEnd: end,
          provider: 'INTERNAL_SYSTEM',
        },
        include: {
          plan: true,
        },
      });
    }

    // Lazily sync period if needed
    return this.syncSubscriptionPeriod(sub, tx);
  }

  /**
   * Transaction-safe quota enforcement:
   * Locks organization row -> loads effective subscription -> evaluates quota.
   * Throws ForbiddenException if quota exceeded.
   */
  async enforceQuota(
    organizationId: string,
    resourceType: QuotaResourceType,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // 1. Level-1 Organization Row Lock
    await this.lockOrganization(organizationId, tx);

    // 2. Fetch subscription & sync period
    const sub = await this.getEffectiveSubscription(organizationId, tx);

    // If subscription is PAST_DUE, reject operations that create new resources
    if (sub.status === SubscriptionStatus.PAST_DUE) {
      throw new ForbiddenException(
        'Subscription is past due. Please settle outstanding invoices or renew your plan to proceed.',
      );
    }

    const plan = sub.plan;

    switch (resourceType) {
      case QuotaResourceType.BRANCH: {
        if (plan.maxBranches !== null && plan.maxBranches !== undefined) {
          const count = await tx.branch.count({
            where: {
              organizationId,
              status: BranchStatus.ACTIVE,
            },
          });
          if (count >= plan.maxBranches) {
            throw new ForbiddenException(
              `Branch limit reached (${count}/${plan.maxBranches}) for plan '${plan.name}'. Upgrade to add more branches.`,
            );
          }
        }
        break;
      }

      case QuotaResourceType.STAFF: {
        if (plan.maxStaff !== null && plan.maxStaff !== undefined) {
          const count = await tx.organizationMember.count({
            where: {
              organizationId,
              status: MemberStatus.ACTIVE,
            },
          });
          if (count >= plan.maxStaff) {
            throw new ForbiddenException(
              `Staff member limit reached (${count}/${plan.maxStaff}) for plan '${plan.name}'. Upgrade to add more members.`,
            );
          }
        }
        break;
      }

      case QuotaResourceType.PRODUCT: {
        if (plan.maxProducts !== null && plan.maxProducts !== undefined) {
          const count = await tx.product.count({
            where: {
              organizationId,
              status: ProductStatus.ACTIVE,
            },
          });
          if (count >= plan.maxProducts) {
            throw new ForbiddenException(
              `Product catalog limit reached (${count}/${plan.maxProducts}) for plan '${plan.name}'. Upgrade to add more products.`,
            );
          }
        }
        break;
      }

      case QuotaResourceType.TRANSACTION: {
        if (plan.maxTransactions !== null && plan.maxTransactions !== undefined) {
          // Count only COMPLETED Sales where completedAt is within current quota period
          const periodStart = sub.currentPeriodStart;
          const periodEnd = sub.currentPeriodEnd;

          const count = await tx.sale.count({
            where: {
              organizationId,
              status: SaleStatus.COMPLETED,
              completedAt: {
                gte: periodStart,
                lt: periodEnd,
              },
            },
          });

          if (count >= plan.maxTransactions) {
            throw new ForbiddenException(
              `Monthly sales transaction limit reached (${count}/${plan.maxTransactions}) for plan '${plan.name}'. Upgrade to process more sales this period.`,
            );
          }
        }
        break;
      }
    }
  }

  /**
   * Get current usage metrics and limits for an organization (read-only query)
   */
  async getSubscriptionUsage(organizationId: string): Promise<SubscriptionUsage> {
    const sub = await this.prisma.$transaction(async (tx) => {
      return this.getEffectiveSubscription(organizationId, tx);
    });

    const plan = sub.plan;

    const [branchCount, staffCount, productCount, txCount] = await Promise.all([
      this.prisma.branch.count({
        where: {
          organizationId,
          status: BranchStatus.ACTIVE,
        },
      }),
      this.prisma.organizationMember.count({
        where: {
          organizationId,
          status: MemberStatus.ACTIVE,
        },
      }),
      this.prisma.product.count({
        where: {
          organizationId,
          status: ProductStatus.ACTIVE,
        },
      }),
      this.prisma.sale.count({
        where: {
          organizationId,
          status: SaleStatus.COMPLETED,
          completedAt: {
            gte: sub.currentPeriodStart,
            lt: sub.currentPeriodEnd,
          },
        },
      }),
    ]);

    return {
      branches: {
        used: branchCount,
        limit: plan.maxBranches,
      },
      staff: {
        used: staffCount,
        limit: plan.maxStaff,
      },
      products: {
        used: productCount,
        limit: plan.maxProducts,
      },
      transactions: {
        used: txCount,
        limit: plan.maxTransactions,
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
      },
    };
  }
}
