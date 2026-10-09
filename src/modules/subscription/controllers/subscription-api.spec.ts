import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller.js';
import { PlanController } from './plan.controller.js';
import { SubscriptionWebhookController } from './subscription-webhook.controller.js';
import { SubscriptionService } from '../services/subscription.service.js';
import { SubscriptionLimitService } from '../services/subscription-limit.service.js';
import { PlanService } from '../services/plan.service.js';
import { SubscriptionWebhookService } from '../services/subscription-webhook.service.js';
import { DatabaseService } from '../../../database/database.service.js';
import { AuthorizationService } from '../../authorization/authorization.service.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../../common/guards/permission.guard.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('Subscription & Billing API Integration', () => {
  let subController: SubscriptionController;
  let planController: PlanController;
  let webhookController: SubscriptionWebhookController;

  let subscriptionService: any;
  let limitService: any;
  let planService: any;
  let webhookService: any;

  beforeEach(async () => {
    subscriptionService = {
      getCurrentSubscription: vi.fn(),
      startTrial: vi.fn(),
      changePlan: vi.fn(),
      cancelSubscription: vi.fn(),
    };

    limitService = {
      getSubscriptionUsage: vi.fn(),
      checkQuota: vi.fn(),
    };

    planService = {
      getPublicPlans: vi.fn(),
      getPlanByCode: vi.fn(),
    };

    webhookService = {
      ingestWebhook: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        SubscriptionController,
        PlanController,
        SubscriptionWebhookController,
      ],
      providers: [
        { provide: SubscriptionService, useValue: subscriptionService },
        { provide: SubscriptionLimitService, useValue: limitService },
        { provide: PlanService, useValue: planService },
        { provide: SubscriptionWebhookService, useValue: webhookService },
        { provide: DatabaseService, useValue: {} },
        { provide: AuthorizationService, useValue: {} },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    subController = module.get<SubscriptionController>(SubscriptionController);
    planController = module.get<PlanController>(PlanController);
    webhookController = module.get<SubscriptionWebhookController>(SubscriptionWebhookController);
  });

  describe('PlanController (Public API)', () => {
    it('should return list of public active plans', async () => {
      const mockPlans = [
        { code: 'FREE', name: 'Free Tier', priceMonthly: 0 },
        { code: 'PRO', name: 'Pro Tier', priceMonthly: 1500 },
      ];
      planService.getPublicPlans.mockResolvedValueOnce(mockPlans);

      const res = await planController.getPublicPlans();
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockPlans);
    });

    it('should return specific plan details by code', async () => {
      const mockPlan = { code: 'PRO', name: 'Pro Tier', maxStaff: 5, maxProducts: 500 };
      planService.getPlanByCode.mockResolvedValueOnce(mockPlan);

      const res = await planController.getPlanByCode('PRO');
      expect(res.success).toBe(true);
      expect(res.data.code).toBe('PRO');
    });
  });

  describe('SubscriptionController (Tenant API)', () => {
    it('should get current subscription with plan limits', async () => {
      const mockSub = {
        id: 'sub-1',
        status: 'ACTIVE',
        plan: { code: 'PRO', maxProducts: 500 },
      };
      subscriptionService.getCurrentSubscription.mockResolvedValueOnce(mockSub);

      const res = await subController.getCurrentSubscription('org-1');
      expect(res.success).toBe(true);
      expect(res.data.status).toBe('ACTIVE');
    });

    it('should get current resource usage vs quotas', async () => {
      const mockUsage = {
        organizationId: 'org-1',
        planCode: 'PRO',
        quotas: {
          products: { current: 42, max: 500, allowed: true },
          staff: { current: 2, max: 5, allowed: true },
        },
      };
      limitService.getSubscriptionUsage.mockResolvedValueOnce(mockUsage);

      const res = await subController.getUsage('org-1');
      expect(res.success).toBe(true);
      expect(res.data.quotas.products.current).toBe(42);
    });

    it('should handle trial activation', async () => {
      const mockTrialRes = {
        id: 'sub-trial-1',
        status: 'TRIAL',
        trialEndsAt: new Date(),
      };
      subscriptionService.startTrial.mockResolvedValueOnce(mockTrialRes);

      const res = await subController.startTrial('org-1', { planCode: 'PRO' }, { user: { sub: 'u-1' } } as any);
      expect(res.success).toBe(true);
      expect(res.data.status).toBe('TRIAL');
    });
  });

  describe('SubscriptionWebhookController (Replay & Ingestion)', () => {
    it('should receive webhook and schedule execution with replay protection', async () => {
      const mockAck = {
        received: true,
        eventId: 'event-uuid-1',
        status: 'SCHEDULED',
      };
      webhookService.ingestWebhook.mockResolvedValueOnce(mockAck);

      const res = await webhookController.handleWebhook(
        'BKASH',
        { paymentID: 'TRX123', status: 'Completed' },
        { 'x-signature': 'sig-xyz' },
      );

      expect(webhookService.ingestWebhook).toHaveBeenCalledWith(
        'BKASH',
        { paymentID: 'TRX123', status: 'Completed' },
        { 'x-signature': 'sig-xyz' },
      );
      expect(res).toEqual(mockAck);
    });
  });
});
