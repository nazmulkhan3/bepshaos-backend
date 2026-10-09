import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { PlanService } from '../subscription/services/plan.service.js';
import { OrganizationStatus, SubscriptionStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';

describe('AdminService (Platform Administration Operations)', () => {
  let service: AdminService;
  let db: any;
  let auditLogService: any;
  let planService: any;

  beforeEach(async () => {
    db = {
      $transaction: vi.fn(async (cb) => cb(db)),
      $queryRaw: vi.fn(),
      organization: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
      subscription: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      plan: {
        findUnique: vi.fn(),
      },
    };

    auditLogService = {
      logAction: vi.fn().mockResolvedValue({}),
      queryLogs: vi.fn().mockResolvedValue({ total: 0, data: [] }),
    };

    planService = {
      createPlan: vi.fn(),
      updatePlan: vi.fn(),
      getPlanById: vi.fn(),
      getAllPlans: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: DatabaseService, useValue: db },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: PlanService, useValue: planService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listOrganizations', () => {
    it('should query organizations with search and pagination metrics', async () => {
      db.organization.count.mockResolvedValueOnce(1);
      db.organization.findMany.mockResolvedValueOnce([
        {
          id: 'org-1',
          name: 'Acme Corp',
          slug: 'acme-corp',
          status: OrganizationStatus.ACTIVE,
          hasUsedTrial: true,
          createdAt: new Date(),
          business: { name: 'Acme', phone: '123', email: 'acme@test.com' },
          subscriptions: [{ id: 'sub-1', plan: { name: 'Pro' } }],
          _count: { members: 3, branches: 2, products: 50, sales: 120 },
        },
      ]);

      const res = await service.listOrganizations({ search: 'Acme', limit: 10 });

      expect(res.total).toBe(1);
      expect(res.data[0].id).toBe('org-1');
      expect(res.data[0].counts.sales).toBe(120);
    });
  });

  describe('updateOrganization & Audit Logging', () => {
    it('should update organization status and record audit log with old/new states', async () => {
      const orgId = 'org-1';
      db.organization.findUnique.mockResolvedValueOnce({
        id: orgId,
        name: 'Store A',
        status: OrganizationStatus.ACTIVE,
      });

      db.organization.update.mockResolvedValueOnce({
        id: orgId,
        name: 'Store A',
        status: OrganizationStatus.SUSPENDED,
      });

      const res = await service.updateOrganization(
        orgId,
        { status: OrganizationStatus.SUSPENDED },
        'admin-usr-1',
      );

      expect(res.status).toBe(OrganizationStatus.SUSPENDED);
      expect(auditLogService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_UPDATE_ORGANIZATION',
          entity: 'Organization',
          entityId: orgId,
          userId: 'admin-usr-1',
          oldData: { name: 'Store A', status: OrganizationStatus.ACTIVE },
          newData: { name: 'Store A', status: OrganizationStatus.SUSPENDED },
        }),
        db,
      );
    });

    it('should throw NotFoundException if organization does not exist', async () => {
      db.organization.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateOrganization('non-existent', {}, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('overrideSubscription & Row-Level Lock', () => {
    it('should lock organization row, override plan, and log audit event', async () => {
      const orgId = 'org-1';
      db.$queryRaw.mockResolvedValueOnce([{ id: orgId, status: 'ACTIVE' }]);

      const mockCurrentSub = {
        id: 'sub-1',
        organizationId: orgId,
        planId: 'plan-starter',
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date('2026-10-31T00:00:00Z'),
        plan: { code: 'STARTER', name: 'Starter' },
      };
      db.subscription.findFirst.mockResolvedValueOnce(mockCurrentSub);

      const mockTargetPlan = { id: 'plan-enterprise', code: 'ENTERPRISE', name: 'Enterprise' };
      db.plan.findUnique.mockResolvedValueOnce(mockTargetPlan);

      const updatedDate = new Date('2027-10-31T00:00:00Z');
      db.subscription.update.mockResolvedValueOnce({
        id: 'sub-1',
        planId: 'plan-enterprise',
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: updatedDate,
        plan: mockTargetPlan,
      });

      const res = await service.overrideSubscription(
        orgId,
        {
          planCode: 'ENTERPRISE',
          currentPeriodEnd: updatedDate.toISOString(),
          reason: 'VIP contract signed',
        },
        'admin-usr-1',
      );

      expect(db.$queryRaw).toHaveBeenCalled();
      expect(db.subscription.update).toHaveBeenCalled();
      expect(auditLogService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_OVERRIDE_SUBSCRIPTION',
          entity: 'Subscription',
          entityId: 'sub-1',
          userId: 'admin-usr-1',
          newData: expect.objectContaining({
            planCode: 'ENTERPRISE',
            reason: 'VIP contract signed',
          }),
        }),
        db,
      );
      expect(res.plan.code).toBe('ENTERPRISE');
    });
  });
});
