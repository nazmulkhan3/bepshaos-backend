import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionLimitService } from './subscription-limit.service.js';
import { DatabaseService } from '../../../database/database.service.js';
import { QuotaResourceType } from '../interfaces/plan-limits.interface.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus, BranchStatus, MemberStatus, ProductStatus, SaleStatus } from '@prisma/client';

describe('SubscriptionLimitService', () => {
  let service: SubscriptionLimitService;
  let db: any;

  beforeEach(async () => {
    db = {
      $queryRaw: vi.fn(),
      $transaction: vi.fn((cb) => cb(db)),
      subscription: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      plan: {
        findUnique: vi.fn(),
      },
      branch: {
        count: vi.fn(),
      },
      organizationMember: {
        count: vi.fn(),
      },
      product: {
        count: vi.fn(),
      },
      sale: {
        count: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionLimitService,
        {
          provide: DatabaseService,
          useValue: db,
        },
      ],
    }).compile();

    service = module.get<SubscriptionLimitService>(SubscriptionLimitService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('lockOrganization', () => {
    it('should lock organization row with FOR UPDATE and return row', async () => {
      db.$queryRaw.mockResolvedValueOnce([{ id: 'org-1', status: 'ACTIVE', hasUsedTrial: false }]);

      const result = await service.lockOrganization('org-1', db);
      expect(result).toEqual({ id: 'org-1', status: 'ACTIVE', hasUsedTrial: false });
      expect(db.$queryRaw).toHaveBeenCalled();
    });

    it('should throw NotFoundException if organization does not exist', async () => {
      db.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.lockOrganization('missing-org', db)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('enforceQuota', () => {
    const mockPlan = {
      id: 'plan-free',
      code: 'FREE',
      name: 'Free Plan',
      maxBranches: 1,
      maxStaff: 2,
      maxProducts: 100,
      maxTransactions: 50,
    };

    const mockSub = {
      id: 'sub-1',
      organizationId: 'org-1',
      status: SubscriptionStatus.ACTIVE,
      plan: mockPlan,
      currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
    };

    beforeEach(() => {
      db.$queryRaw.mockResolvedValue([{ id: 'org-1', status: 'ACTIVE', hasUsedTrial: false }]);
      db.subscription.findFirst.mockResolvedValue(mockSub);
    });

    it('should allow branch creation when under branch limit', async () => {
      db.branch.count.mockResolvedValueOnce(0); // 0 < 1

      await expect(
        service.enforceQuota('org-1', QuotaResourceType.BRANCH, db),
      ).resolves.toBeUndefined();
    });

    it('should reject branch creation when branch limit reached', async () => {
      db.branch.count.mockResolvedValueOnce(1); // 1 >= 1

      await expect(
        service.enforceQuota('org-1', QuotaResourceType.BRANCH, db),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow staff member addition when under limit', async () => {
      db.organizationMember.count.mockResolvedValueOnce(1); // 1 < 2

      await expect(
        service.enforceQuota('org-1', QuotaResourceType.STAFF, db),
      ).resolves.toBeUndefined();
    });

    it('should reject staff member addition when limit reached', async () => {
      db.organizationMember.count.mockResolvedValueOnce(2); // 2 >= 2

      await expect(
        service.enforceQuota('org-1', QuotaResourceType.STAFF, db),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow product creation when under limit', async () => {
      db.product.count.mockResolvedValueOnce(50); // 50 < 100

      await expect(
        service.enforceQuota('org-1', QuotaResourceType.PRODUCT, db),
      ).resolves.toBeUndefined();
    });

    it('should reject product creation when limit reached', async () => {
      db.product.count.mockResolvedValueOnce(100); // 100 >= 100

      await expect(
        service.enforceQuota('org-1', QuotaResourceType.PRODUCT, db),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should count only COMPLETED sales within current quota period', async () => {
      db.sale.count.mockResolvedValueOnce(49); // 49 < 50

      await expect(
        service.enforceQuota('org-1', QuotaResourceType.TRANSACTION, db),
      ).resolves.toBeUndefined();

      expect(db.sale.count).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          status: SaleStatus.COMPLETED,
          completedAt: {
            gte: mockSub.currentPeriodStart,
            lt: mockSub.currentPeriodEnd,
          },
        },
      });
    });

    it('should reject sale transition to COMPLETED when transaction limit is reached', async () => {
      db.sale.count.mockResolvedValueOnce(50); // 50 >= 50

      await expect(
        service.enforceQuota('org-1', QuotaResourceType.TRANSACTION, db),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if subscription is PAST_DUE', async () => {
      db.subscription.findFirst.mockResolvedValueOnce({
        ...mockSub,
        status: SubscriptionStatus.PAST_DUE,
      });

      await expect(
        service.enforceQuota('org-1', QuotaResourceType.BRANCH, db),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Free Plan Lazy Rollover', () => {
    it('should roll over expired Free plan subscription period on access', async () => {
      const expiredEnd = new Date('2026-09-01T00:00:00Z');
      const expiredSub = {
        id: 'sub-free-expired',
        organizationId: 'org-1',
        status: SubscriptionStatus.ACTIVE,
        plan: { code: 'FREE', name: 'Free Plan' },
        currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEnd: expiredEnd,
      };

      db.subscription.update.mockResolvedValueOnce({
        ...expiredSub,
        currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
      });

      const updated = await service.syncSubscriptionPeriod(expiredSub, db);
      expect(db.subscription.update).toHaveBeenCalled();
      expect(updated.currentPeriodStart.getTime()).toBeGreaterThan(expiredEnd.getTime());
    });
  });
});
