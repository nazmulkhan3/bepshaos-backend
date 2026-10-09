import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionMaintenanceProcessor } from './subscription-maintenance.processor.js';
import { SubscriptionService } from './services/subscription.service.js';
import { SubscriptionWebhookService } from './services/subscription-webhook.service.js';
import { Job } from 'bullmq';

describe('SubscriptionMaintenanceProcessor (Background Jobs & Queue)', () => {
  let processor: SubscriptionMaintenanceProcessor;
  let subscriptionService: any;
  let webhookService: any;

  beforeEach(async () => {
    subscriptionService = {
      processSubscriptionLifecycle: vi.fn().mockResolvedValue({
        expiredTrials: 2,
        cancelledSubs: 1,
        pastDueSubs: 3,
      }),
    };

    webhookService = {
      recoverExpiredLeasesAndRetries: vi.fn().mockResolvedValue(4),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionMaintenanceProcessor,
        { provide: SubscriptionService, useValue: subscriptionService },
        { provide: SubscriptionWebhookService, useValue: webhookService },
      ],
    }).compile();

    processor = module.get<SubscriptionMaintenanceProcessor>(SubscriptionMaintenanceProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process FULL_MAINTENANCE', () => {
    it('should invoke both lifecycle processing and webhook lease recovery', async () => {
      const mockJob = {
        id: 'job-maint-1',
        data: { action: 'FULL_MAINTENANCE', batchSize: 50 },
      } as Job<any>;

      const res = await processor.process(mockJob);

      expect(subscriptionService.processSubscriptionLifecycle).toHaveBeenCalledWith(50);
      expect(webhookService.recoverExpiredLeasesAndRetries).toHaveBeenCalledWith(5, 50);
      expect(res.lifecycle.expiredTrials).toBe(2);
      expect(res.recoveredWebhooks).toBe(4);
    });

    it('should handle action = PROCESS_LIFECYCLE only', async () => {
      const mockJob = {
        id: 'job-maint-2',
        data: { action: 'PROCESS_LIFECYCLE', batchSize: 25 },
      } as Job<any>;

      const res = await processor.process(mockJob);

      expect(subscriptionService.processSubscriptionLifecycle).toHaveBeenCalledWith(25);
      expect(webhookService.recoverExpiredLeasesAndRetries).not.toHaveBeenCalled();
      expect(res.lifecycle).toBeDefined();
      expect(res.recoveredWebhooks).toBeUndefined();
    });

    it('should propagate and log errors if processing fails', async () => {
      subscriptionService.processSubscriptionLifecycle.mockRejectedValueOnce(
        new Error('Database lock timeout'),
      );

      const mockJob = {
        id: 'job-fail-1',
        data: { action: 'PROCESS_LIFECYCLE' },
      } as Job<any>;

      await expect(processor.process(mockJob)).rejects.toThrow('Database lock timeout');
    });
  });
});
