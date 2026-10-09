import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard.js';
import { DatabaseService } from '../../database/database.service.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('AdminController (Platform Admin API Integration)', () => {
  let controller: AdminController;
  let adminService: any;
  let auditLogService: any;

  beforeEach(async () => {
    adminService = {
      listOrganizations: vi.fn(),
      getOrganizationDetails: vi.fn(),
      updateOrganization: vi.fn(),
      overrideSubscription: vi.fn(),
      getAllPlans: vi.fn(),
      createPlan: vi.fn(),
      updatePlan: vi.fn(),
    };

    auditLogService = {
      queryLogs: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: adminService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: DatabaseService, useValue: {} },
      ],
    })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listOrganizations (GET /admin/organizations)', () => {
    it('should list all platform organizations with metrics', async () => {
      const mockResult = {
        data: [{ id: 'org-1', name: 'Org 1', membersCount: 5 }],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };
      adminService.listOrganizations.mockResolvedValueOnce(mockResult);

      const res = await controller.listOrganizations({ page: 1, limit: 10 });

      expect(adminService.listOrganizations).toHaveBeenCalledWith({ page: 1, limit: 10 });
      expect(res.success).toBe(true);
      expect(res.data.length).toBe(1);
    });
  });

  describe('overrideSubscription (PATCH /admin/organizations/:organizationId/subscription/override)', () => {
    it('should invoke overrideSubscription with admin user id', async () => {
      const mockSub = { id: 'sub-1', planId: 'plan-pro', status: 'ACTIVE' };
      adminService.overrideSubscription.mockResolvedValueOnce(mockSub);

      const req = { user: { sub: 'platform-admin-1' } };
      const res = await controller.overrideSubscription(
        'org-1',
        { planCode: 'PRO', status: 'ACTIVE' as any },
        req,
      );

      expect(adminService.overrideSubscription).toHaveBeenCalledWith(
        'org-1',
        { planCode: 'PRO', status: 'ACTIVE' },
        'platform-admin-1',
      );
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockSub);
    });
  });

  describe('queryAuditLogs (GET /admin/audit-logs)', () => {
    it('should query platform audit logs across tenants', async () => {
      const mockLogs = {
        data: [{ id: 'log-1', action: 'OFFLINE_SYNC_BATCH_PROCESSED' }],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      };
      auditLogService.queryLogs.mockResolvedValueOnce(mockLogs);

      const res = await controller.queryAuditLogs({ page: 1, limit: 20 });

      expect(auditLogService.queryLogs).toHaveBeenCalledWith({ page: 1, limit: 20 });
      expect(res.success).toBe(true);
      expect(res.data.length).toBe(1);
    });
  });
});
