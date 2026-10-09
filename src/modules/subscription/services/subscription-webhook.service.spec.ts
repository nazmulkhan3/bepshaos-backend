import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionWebhookService } from './subscription-webhook.service.js';
import { DatabaseService } from '../../../database/database.service.js';
import { BillingProviderRegistry } from '../billing/billing-provider.registry.js';
import { WebhookEventStatus, BillingRecordStatus, SubscriptionStatus, Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('SubscriptionWebhookService (Integration & Concurrency)', () => {
  let service: SubscriptionWebhookService;
  let db: any;
  let providerRegistry: any;

  beforeEach(async () => {
    db = {
      $transaction: vi.fn(async (cb) => cb(db)),
      $queryRaw: vi.fn(),
      subscriptionWebhookEvent: {
        findUnique: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      subscriptionBillingRecord: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      plan: {
        findUnique: vi.fn(),
      },
      subscription: {
        update: vi.fn(),
      },
    };

    providerRegistry = {
      getProvider: vi.fn().mockReturnValue({
        verifyWebhook: vi.fn().mockResolvedValue({
          isValid: true,
          providerEventId: 'evt_test_123',
          eventType: 'PAYMENT_SUCCESS',
          providerTxnId: 'txn_999',
          organizationId: 'org-test',
          subscriptionId: 'sub-test',
          billingRecordId: 'rec-test',
          rawPayload: {
            eventId: 'evt_test_123',
            billingRecordId: 'rec-test',
            invoiceNumber: 'INV-20261009-ABC',
          },
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionWebhookService,
        { provide: DatabaseService, useValue: db },
        { provide: BillingProviderRegistry, useValue: providerRegistry },
      ],
    }).compile();

    service = module.get<SubscriptionWebhookService>(SubscriptionWebhookService);
  });

  describe('Webhook Authentication & Signature Verification', () => {
    it('should reject webhook if provider validation fails', async () => {
      providerRegistry.getProvider.mockReturnValueOnce({
        verifyWebhook: vi.fn().mockResolvedValue({ isValid: false }),
      });

      await expect(
        service.ingestWebhook('MANUAL', {}, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Duplicate Replay Protection', () => {
    it('should short-circuit with success if event was already PROCESSED', async () => {
      db.subscriptionWebhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt-db-1',
        status: WebhookEventStatus.PROCESSED,
      });

      const res = await service.ingestWebhook('MANUAL', { eventId: 'evt_test_123' }, {});

      expect(res.success).toBe(true);
      expect(res.message).toBe('Event already processed');
      expect(db.subscriptionWebhookEvent.updateMany).not.toHaveBeenCalled();
    });

    it('should handle concurrent duplicate insertion (P2002 collision) gracefully', async () => {
      // First findUnique returns null (race window)
      db.subscriptionWebhookEvent.findUnique
        .mockResolvedValueOnce(null)
        // Second findUnique after collision returns the winning record
        .mockResolvedValueOnce({
          id: 'evt-db-existing',
          status: WebhookEventStatus.PROCESSED,
        });

      // create throws P2002 unique constraint violation
      const p2002Error: any = new Error('Unique constraint failed');
      p2002Error.code = 'P2002';
      db.subscriptionWebhookEvent.create.mockRejectedValueOnce(p2002Error);

      const res = await service.ingestWebhook('MANUAL', { eventId: 'evt_test_123' }, {});

      expect(res.success).toBe(true);
      expect(res.message).toBe('Event already processed');
    });
  });

  describe('Durable Lease Ownership', () => {
    it('should skip processing if worker cannot claim lease (already PROCESSING by another worker)', async () => {
      db.subscriptionWebhookEvent.findUnique.mockResolvedValueOnce(null);
      db.subscriptionWebhookEvent.create.mockResolvedValueOnce({
        id: 'evt-1',
        status: WebhookEventStatus.PENDING,
      });

      // Lease claim fails (count = 0)
      db.subscriptionWebhookEvent.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.processEvent('evt-1');

      // Since lease was not claimed, transaction should not run
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('should claim lease and process when lease is available', async () => {
      db.subscriptionWebhookEvent.updateMany.mockResolvedValueOnce({ count: 1 });
      db.subscriptionWebhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt-1',
        providerTxnId: 'txn_999',
        eventType: 'PAYMENT_SUCCESS',
        payload: { billingRecordId: 'rec-test' },
      });

      db.subscriptionBillingRecord.findUnique.mockResolvedValueOnce({
        id: 'rec-test',
        organizationId: 'org-test',
        subscriptionId: 'sub-test',
        planCode: 'PRO',
        billingCycle: 'MONTHLY',
        periodStart: new Date(),
        periodEnd: new Date(),
      });

      db.plan.findUnique.mockResolvedValueOnce({ id: 'plan-pro', code: 'PRO' });

      await service.processEvent('evt-1');

      // Verify Level-1 Organization lock acquired inside transaction
      expect(db.$queryRaw).toHaveBeenCalled();
      // Verify billing record updated to PAID
      expect(db.subscriptionBillingRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-test' },
          data: expect.objectContaining({ status: BillingRecordStatus.PAID }),
        }),
      );
      // Verify subscription activated
      expect(db.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-test' },
          data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
        }),
      );
      // Verify event marked PROCESSED and lease cleared
      expect(db.subscriptionWebhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-1' },
          data: expect.objectContaining({
            status: WebhookEventStatus.PROCESSED,
            lockedBy: null,
          }),
        }),
      );
    });
  });

  describe('Atomic State Transitions', () => {
    it('should set subscription to PAST_DUE upon PAYMENT_FAILED event', async () => {
      db.subscriptionWebhookEvent.updateMany.mockResolvedValueOnce({ count: 1 });
      db.subscriptionWebhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt-failed',
        providerTxnId: 'txn_fail',
        eventType: 'PAYMENT_FAILED',
        payload: { billingRecordId: 'rec-fail' },
      });

      db.subscriptionBillingRecord.findUnique.mockResolvedValueOnce({
        id: 'rec-fail',
        organizationId: 'org-test',
        subscriptionId: 'sub-test',
      });

      await service.processEvent('evt-failed');

      expect(db.subscriptionBillingRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-fail' },
          data: expect.objectContaining({ status: BillingRecordStatus.FAILED }),
        }),
      );

      expect(db.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-test' },
          data: expect.objectContaining({ status: SubscriptionStatus.PAST_DUE }),
        }),
      );
    });
  });
});
