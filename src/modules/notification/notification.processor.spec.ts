import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationProcessor } from './notification.processor.js';
import { DatabaseService } from '../../database/database.service.js';
import { NotificationType } from '@prisma/client';
import { Job } from 'bullmq';

describe('NotificationProcessor (Tenant Isolation & Idempotency)', () => {
  let processor: NotificationProcessor;
  let db: any;

  beforeEach(async () => {
    db = {
      organizationMember: {
        findUnique: vi.fn(),
      },
      notification: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationProcessor,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    processor = module.get<NotificationProcessor>(NotificationProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('Tenant Boundary Isolation', () => {
    it('should skip job if user does not belong to the target organization', async () => {
      const mockJob = {
        id: 'job-notif-1',
        attemptsMade: 0,
        data: {
          userId: 'user-intruder',
          organizationId: 'org-victim',
          type: NotificationType.INFO,
          title: 'Alert',
          message: 'Cross tenant attempt',
        },
      } as Job<any>;

      db.organizationMember.findUnique.mockResolvedValueOnce(null);

      const res = await processor.process(mockJob);

      expect(res).toEqual({ skipped: true, reason: 'TENANT_MEMBERSHIP_NOT_FOUND' });
      expect(db.notification.create).not.toHaveBeenCalled();
    });

    it('should proceed if user is an active member of the target organization', async () => {
      const mockJob = {
        id: 'job-notif-2',
        attemptsMade: 0,
        data: {
          userId: 'user-valid',
          organizationId: 'org-valid',
          type: NotificationType.INFO,
          title: 'New Sale',
          message: 'Sale created',
        },
      } as Job<any>;

      db.organizationMember.findUnique.mockResolvedValueOnce({
        id: 'mem-1',
        userId: 'user-valid',
        organizationId: 'org-valid',
      });
      db.notification.create.mockResolvedValueOnce({ id: 'notif-1' });

      const res = await processor.process(mockJob);

      expect(db.notification.create).toHaveBeenCalled();
      expect(res.id).toBe('notif-1');
    });
  });

  describe('Idempotency & Duplicate Handling', () => {
    it('should return existing unread notification without creating duplicates for same entity', async () => {
      const mockJob = {
        id: 'job-notif-dup',
        attemptsMade: 1,
        data: {
          userId: 'user-1',
          organizationId: 'org-1',
          type: NotificationType.SALE_COMPLETED,
          title: 'Sale Completed',
          message: 'SALE-001 has completed',
          entityType: 'Sale',
          entityId: 'sale-123',
        },
      } as Job<any>;

      db.organizationMember.findUnique.mockResolvedValueOnce({ id: 'mem-1' });
      db.notification.findFirst.mockResolvedValueOnce({
        id: 'notif-existing-1',
        isRead: false,
      });

      const res = await processor.process(mockJob);

      expect(res.id).toBe('notif-existing-1');
      expect(db.notification.create).not.toHaveBeenCalled();
    });
  });
});
