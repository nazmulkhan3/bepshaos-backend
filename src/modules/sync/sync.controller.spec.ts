import { Test, TestingModule } from '@nestjs/testing';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import {
  SyncEntityType,
  SyncOperationAction,
  SyncOperationStatus,
} from './dto/index.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('SyncController (API Integration)', () => {
  let controller: SyncController;
  let syncService: any;

  const mockCtx = {
    organizationId: 'org-test-1',
    userId: 'user-test-1',
    membershipId: 'mem-1',
    roleId: 'role-1',
    roleName: 'OWNER',
    status: 'ACTIVE' as any,
    organizationStatus: 'ACTIVE' as any,
  };

  beforeEach(async () => {
    syncService = {
      processUploadBatch: vi.fn(),
      getIncrementalDownload: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        { provide: SyncService, useValue: syncService },
        { provide: DatabaseService, useValue: {} },
        { provide: AuthorizationService, useValue: {} },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SyncController>(SyncController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('upload (POST /organizations/:organizationId/sync/upload)', () => {
    it('should delegate upload batch to syncService with authenticated organization context', async () => {
      const uploadDto = {
        operations: [
          {
            operationId: 'op-101',
            entityType: SyncEntityType.CUSTOMER,
            action: SyncOperationAction.CREATE,
            clientId: 'client-cust-1',
            data: { name: 'Acme Offline Customer' },
          },
        ],
      };

      const mockResponse = {
        batchId: 'batch-abc-123',
        processedCount: 1,
        successCount: 1,
        conflictCount: 0,
        rejectedCount: 0,
        results: [
          {
            operationId: 'op-101',
            status: SyncOperationStatus.SUCCESS,
            entityType: SyncEntityType.CUSTOMER,
            clientId: 'client-cust-1',
            serverId: 'server-cust-1',
          },
        ],
      };

      syncService.processUploadBatch.mockResolvedValueOnce(mockResponse);

      const res = await controller.upload(mockCtx, uploadDto);

      expect(syncService.processUploadBatch).toHaveBeenCalledWith(
        'org-test-1',
        'user-test-1',
        uploadDto,
      );
      expect(res).toEqual(mockResponse);
      expect(res.results[0].status).toBe(SyncOperationStatus.SUCCESS);
    });

    it('should return structured conflicts and partial status results', async () => {
      const uploadDto = {
        operations: [
          {
            operationId: 'op-conflict-1',
            entityType: SyncEntityType.CUSTOMER,
            action: SyncOperationAction.UPDATE,
            serverId: 'server-cust-1',
            data: { name: 'Conflicting Name' },
          },
        ],
      };

      const mockConflictResponse = {
        batchId: 'batch-conflict-123',
        processedCount: 1,
        successCount: 0,
        conflictCount: 1,
        rejectedCount: 0,
        results: [
          {
            operationId: 'op-conflict-1',
            status: SyncOperationStatus.CONFLICT,
            entityType: SyncEntityType.CUSTOMER,
            serverId: 'server-cust-1',
            message: 'Update conflict: Server record has been updated since client change',
            conflictDetails: {
              reason: 'SERVER_RECORD_NEWER',
            },
          },
        ],
      };

      syncService.processUploadBatch.mockResolvedValueOnce(mockConflictResponse);

      const res = await controller.upload(mockCtx, uploadDto);

      expect(res.conflictCount).toBe(1);
      expect(res.results[0].status).toBe(SyncOperationStatus.CONFLICT);
      expect(res.results[0].conflictDetails?.reason).toBe('SERVER_RECORD_NEWER');
    });
  });

  describe('download (GET /organizations/:organizationId/sync/download)', () => {
    it('should delegate incremental download to syncService with cursor query', async () => {
      const query = {
        since: '2026-10-09T10:00:00Z',
        limit: 50,
      };

      const mockDownloadData = {
        serverTime: '2026-10-09T15:00:00Z',
        nextCursor: '2026-10-09T14:30:00Z',
        hasMore: false,
        customers: [{ id: 'c1', name: 'Updated Cust' }],
        categories: [],
        products: [{ id: 'p1', name: 'Updated Prod' }],
        sales: [],
        payments: [],
      };

      syncService.getIncrementalDownload.mockResolvedValueOnce(mockDownloadData);

      const res = await controller.download(mockCtx, query);

      expect(syncService.getIncrementalDownload).toHaveBeenCalledWith('org-test-1', query);
      expect(res.customers.length).toBe(1);
      expect(res.products.length).toBe(1);
      expect(res.nextCursor).toBe('2026-10-09T14:30:00Z');
      expect(res.hasMore).toBe(false);
    });
  });
});
