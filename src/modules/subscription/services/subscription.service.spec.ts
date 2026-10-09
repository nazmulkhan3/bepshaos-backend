import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service.js';
import { SubscriptionLimitService } from './subscription-limit.service.js';
import { BillingProviderRegistry } from '../billing/billing-provider.registry.js';
import { DatabaseService } from '../../../database/database.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus, BillingRecordStatus, Prisma } from '@prisma/client';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let db: any;
  let limitService: any;
  let providerRegistry: any;

  beforeEach(async () => {
    db = {
      $transaction: vi.fn((cb) => cb(db)),
      organization: {
        update: vi.fn(),
      },
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
      subscriptionBillingRecord: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
    };

    limitService = {
      lockOrganization: vi.fn().mockResolvedValue({ id: 'org-1', status: 'ACTIVE', hasUsedTrial: false }),
      getEffectiveSubscription: vi.fn(),
      getSubscriptionUsage: vi.fn(),
    };

    providerRegistry = {
      getProvider: vi.fn().mockReturnValue({
        verifyTransaction: vi.fn().mockResolvedValue({
          isPaid: true,
          amount: 1500,
          currency: 'BDT',
          paidAt: new Date(),
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: DatabaseService, useValue: db },
        { provide: SubscriptionLimitService, useValue: limitService },
        { provide: BillingProviderRegistry, useValue: providerRegistry },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startTrial', () => {
    it('should start 14-day PRO trial if organization has not used trial yet', async () => {
      const mockProPlan = { id: 'plan-pro', code: 'PRO', name: 'Pro Plan', isActive: true };
      db.plan.findUnique.mockResolvedValueOnce(mockProPlan);
      db.subscription.findFirst.mockResolvedValueOnce(null);
      db.subscription.create.mockResolvedValueOnce({
        id: 'sub-trial',
        organizationId: 'org-1',
        planId: 'plan-pro',
        status: SubscriptionStatus.TRIAL,
      });

      const res = await service.startTrial('org-1', { planCode: 'PRO' });

      expect(db.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { hasUsedTrial: true },
      });
      expect(res.status).toBe(SubscriptionStatus.TRIAL);
    });

    it('should reject trial if organization already used trial', async () => {
      limitService.lockOrganization.mockResolvedValueOnce({
        id: 'org-1',
        status: 'ACTIVE',
        hasUsedTrial: true,
      });

      await expect(service.startTrial('org-1', {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('changePlan', () => {
    const mockStarterPlan = {
      id: 'plan-starter',
      code: 'STARTER',
      name: 'Starter Plan',
      isActive: true,
      priceMonthly: new Prisma.Decimal(500),
      priceYearly: new Prisma.Decimal(0),
      currency: 'BDT',
      maxBranches: 2,
      maxStaff: 5,
      maxProducts: 500,
    };

    beforeEach(() => {
      limitService.getEffectiveSubscription.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        planId: 'plan-free',
        status: SubscriptionStatus.ACTIVE,
      });
      db.plan.findUnique.mockResolvedValue(mockStarterPlan);
      db.branch.count.mockResolvedValue(1);
      db.organizationMember.count.mockResolvedValue(2);
      db.product.count.mockResolvedValue(100);
    });

    it('should reject annual checkout if priceYearly is 0', async () => {
      await expect(
        service.changePlan('org-1', { planCode: 'STARTER', billingCycle: 'YEARLY' }),
      ).rejects.toThrow('Annual billing is currently unavailable');
    });

    it('should reject downgrade if current branches exceed target limit', async () => {
      db.branch.count.mockResolvedValueOnce(5); // 5 > 2

      await expect(
        service.changePlan('org-1', { planCode: 'STARTER', billingCycle: 'MONTHLY' }),
      ).rejects.toThrow('Cannot switch to \'Starter Plan\': organization has 5 active branches');
    });

    it('should create billing record and activate immediately when transactionId is verified', async () => {
      db.subscriptionBillingRecord.create.mockResolvedValueOnce({
        id: 'rec-1',
        invoiceNumber: 'INV-20261009-AAA',
        status: BillingRecordStatus.PAID,
        amount: new Prisma.Decimal(500),
      });

      db.subscription.update.mockResolvedValueOnce({
        id: 'sub-1',
        planId: 'plan-starter',
        status: SubscriptionStatus.ACTIVE,
      });

      const res = await service.changePlan('org-1', {
        planCode: 'STARTER',
        billingCycle: 'MONTHLY',
        provider: 'MANUAL',
        transactionId: 'TXN-123456',
      });

      expect(res.subscription.status).toBe(SubscriptionStatus.ACTIVE);
      expect(res.billingRecord).toBeDefined();
    });
  });

  describe('cancelSubscription', () => {
    it('should set cancelAtPeriodEnd flag when cancelled at period end', async () => {
      limitService.getEffectiveSubscription.mockResolvedValueOnce({
        id: 'sub-1',
        cancelAtPeriodEnd: false,
      });
      db.subscription.update.mockResolvedValueOnce({
        id: 'sub-1',
        cancelAtPeriodEnd: true,
      });

      const res = await service.cancelSubscription('org-1', { immediately: false, reason: 'Budget cut' });
      expect(db.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cancelAtPeriodEnd: true }),
        }),
      );
    });

    it('should immediately downgrade to FREE when cancelled immediately', async () => {
      limitService.getEffectiveSubscription.mockResolvedValueOnce({
        id: 'sub-1',
      });
      db.plan.findUnique.mockResolvedValueOnce({
        id: 'plan-free',
        code: 'FREE',
      });
      db.subscription.update.mockResolvedValueOnce({
        id: 'sub-1',
        planId: 'plan-free',
        status: SubscriptionStatus.ACTIVE,
      });

      const res = await service.cancelSubscription('org-1', { immediately: true });
      expect(db.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planId: 'plan-free',
            status: SubscriptionStatus.ACTIVE,
          }),
        }),
      );
    });
  });
});
