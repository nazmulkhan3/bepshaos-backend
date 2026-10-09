import { Test, TestingModule } from '@nestjs/testing';
import { SyncService } from './sync.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { SalesService } from '../sales/sales.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CustomerService } from '../customer/customer.service.js';
import { ProductService } from '../product/product.service.js';
import { CategoryService } from '../category/category.service.js';
import {
  SyncEntityType,
  SyncOperationAction,
  SyncOperationStatus,
} from './dto/index.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('SyncService (Offline Sync)', () => {
  let service: SyncService;
  let db: any;
  let authz: any;
  let auditLog: any;
  let sales: any;
  let inventory: any;
  let customer: any;
  let product: any;
  let category: any;

  beforeEach(async () => {
    db = {
      customer: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      category: {
        findFirst: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      product: {
        findFirst: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      sale: {
        findFirst: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    authz = {
      hasPermissions: vi.fn().mockResolvedValue(true),
    };

    auditLog = {
      logAction: vi.fn().mockResolvedValue({}),
    };

    sales = {
      create: vi.fn(),
    };

    inventory = {
      adjust: vi.fn(),
    };

    customer = {
      create: vi.fn(),
      update: vi.fn(),
    };

    product = {
      create: vi.fn(),
    };

    category = {
      create: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: DatabaseService, useValue: db },
        { provide: AuthorizationService, useValue: authz },
        { provide: AuditLogService, useValue: auditLog },
        { provide: SalesService, useValue: sales },
        { provide: InventoryService, useValue: inventory },
        { provide: CustomerService, useValue: customer },
        { provide: ProductService, useValue: product },
        { provide: CategoryService, useValue: category },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processUploadBatch (Authorization & Tenant Boundary)', () => {
    it('should reject operation if user lacks permission for the entity action', async () => {
      authz.hasPermissions.mockResolvedValueOnce(false);

      const res = await service.processUploadBatch('org-1', 'user-1', {
        operations: [
          {
            operationId: 'op-1',
            entityType: SyncEntityType.CUSTOMER,
            action: SyncOperationAction.CREATE,
            data: { name: 'New Customer' },
          },
        ],
      });

      expect(res.processedCount).toBe(1);
      expect(res.successCount).toBe(0);
      expect(res.rejectedCount).toBe(1);
      expect(res.results[0].status).toBe(SyncOperationStatus.REJECTED);
      expect(res.results[0].message).toContain('Forbidden');
    });

    it('should detect cross-tenant clientId collision and mark as CONFLICT', async () => {
      // Customer with this clientId already exists in a DIFFERENT organization
      db.customer.findFirst.mockResolvedValueOnce({
        id: 'cust-99',
        organizationId: 'other-org',
        clientId: 'client-uuid-1',
      });

      const res = await service.processUploadBatch('org-1', 'user-1', {
        operations: [
          {
            operationId: 'op-1',
            entityType: SyncEntityType.CUSTOMER,
            action: SyncOperationAction.CREATE,
            clientId: 'client-uuid-1',
            data: { name: 'Collision Customer' },
          },
        ],
      });

      expect(res.results[0].status).toBe(SyncOperationStatus.CONFLICT);
      expect(res.results[0].conflictDetails?.reason).toBe('CROSS_TENANT_COLLISION');
      expect(customer.create).not.toHaveBeenCalled();
    });
  });

  describe('processUploadBatch (Idempotency & Duplicate Replays)', () => {
    it('should handle duplicate customer create replay idempotently without creating new record', async () => {
      db.customer.findFirst.mockResolvedValueOnce({
        id: 'cust-1',
        organizationId: 'org-1',
        clientId: 'client-uuid-1',
        name: 'Existing Customer',
      });

      const res = await service.processUploadBatch('org-1', 'user-1', {
        operations: [
          {
            operationId: 'op-dup',
            entityType: SyncEntityType.CUSTOMER,
            action: SyncOperationAction.CREATE,
            clientId: 'client-uuid-1',
            data: { name: 'Existing Customer' },
          },
        ],
      });

      expect(res.successCount).toBe(1);
      expect(res.results[0].status).toBe(SyncOperationStatus.SUCCESS);
      expect(res.results[0].serverId).toBe('cust-1');
      expect(res.results[0].message).toContain('Idempotent replay');
      expect(customer.create).not.toHaveBeenCalled();
    });

    it('should handle duplicate sale replay idempotently using clientId', async () => {
      db.sale.findFirst.mockResolvedValueOnce({
        id: 'sale-1',
        organizationId: 'org-1',
        clientId: 'sale-client-1',
        saleNumber: 'SALE-000001',
      });

      const res = await service.processUploadBatch('org-1', 'user-1', {
        operations: [
          {
            operationId: 'op-sale-dup',
            entityType: SyncEntityType.SALE,
            action: SyncOperationAction.CREATE,
            clientId: 'sale-client-1',
            data: { branchId: 'branch-1', items: [{ productId: 'p-1', quantity: 1 }] },
          },
        ],
      });

      expect(res.successCount).toBe(1);
      expect(res.results[0].status).toBe(SyncOperationStatus.SUCCESS);
      expect(res.results[0].serverId).toBe('sale-1');
      expect(sales.create).not.toHaveBeenCalled();
    });
  });

  describe('processUploadBatch (Conflict Detection & Safe Partial Failures)', () => {
    it('should detect update conflict when server updatedAt is newer than client timestamp', async () => {
      const serverDate = new Date('2026-10-09T12:00:00Z');
      const clientOlderDate = '2026-10-09T10:00:00Z';

      db.customer.findFirst.mockResolvedValueOnce({
        id: 'cust-1',
        organizationId: 'org-1',
        updatedAt: serverDate,
        name: 'Server Side Name',
      });

      const res = await service.processUploadBatch('org-1', 'user-1', {
        operations: [
          {
            operationId: 'op-update-conflict',
            entityType: SyncEntityType.CUSTOMER,
            action: SyncOperationAction.UPDATE,
            serverId: 'cust-1',
            clientTimestamp: clientOlderDate,
            data: { name: 'Client Stale Update' },
          },
        ],
      });

      expect(res.conflictCount).toBe(1);
      expect(res.results[0].status).toBe(SyncOperationStatus.CONFLICT);
      expect(res.results[0].conflictDetails?.reason).toBe('SERVER_RECORD_NEWER');
      expect(customer.update).not.toHaveBeenCalled();
    });

    it('should process multi-operation batch with partial failure without failing entire batch', async () => {
      // Op 1: Customer create succeeds
      db.customer.findFirst.mockResolvedValueOnce(null);
      db.customer.findUnique.mockResolvedValueOnce(null);
      customer.create.mockResolvedValueOnce({ id: 'c-new', name: 'Alpha' });
      db.customer.update.mockResolvedValueOnce({});

      // Op 2: Sale create fails with Insufficient stock
      db.sale.findFirst.mockResolvedValueOnce(null);
      sales.create.mockRejectedValueOnce(new Error('Insufficient stock for product Widget A'));

      // Op 3: Inventory adjustment succeeds
      inventory.adjust.mockResolvedValueOnce({ id: 'inv-mov-1', quantity: 10 });

      const res = await service.processUploadBatch('org-1', 'user-1', {
        operations: [
          {
            operationId: 'op-1',
            entityType: SyncEntityType.CUSTOMER,
            action: SyncOperationAction.CREATE,
            data: { name: 'Alpha' },
          },
          {
            operationId: 'op-2',
            entityType: SyncEntityType.SALE,
            action: SyncOperationAction.CREATE,
            data: { branchId: 'b-1', items: [{ productId: 'p-1', quantity: 500 }] },
          },
          {
            operationId: 'op-3',
            entityType: SyncEntityType.INVENTORY_ADJUSTMENT,
            action: SyncOperationAction.CREATE,
            data: { branchId: 'b-1', productId: 'p-1', newQuantity: 10 },
          },
        ],
      });

      expect(res.processedCount).toBe(3);
      expect(res.successCount).toBe(2);
      expect(res.conflictCount).toBe(1);
      expect(res.rejectedCount).toBe(0);

      expect(res.results[0].status).toBe(SyncOperationStatus.SUCCESS);
      expect(res.results[1].status).toBe(SyncOperationStatus.CONFLICT);
      expect(res.results[1].message).toContain('Insufficient stock');
      expect(res.results[2].status).toBe(SyncOperationStatus.SUCCESS);
    });
  });

  describe('getIncrementalDownload (Cursor Pagination & Organization Isolation)', () => {
    it('should query entities strictly scoped to organizationId with updatedAt cursor', async () => {
      const since = '2026-10-09T00:00:00Z';
      const mockUpdated = new Date('2026-10-09T05:00:00Z');

      db.customer.findMany.mockResolvedValueOnce([{ id: 'c1', updatedAt: mockUpdated }]);
      db.category.findMany.mockResolvedValueOnce([]);
      db.product.findMany.mockResolvedValueOnce([{ id: 'p1', updatedAt: mockUpdated }]);
      db.sale.findMany.mockResolvedValueOnce([]);
      db.payment.findMany.mockResolvedValueOnce([]);

      const result = await service.getIncrementalDownload('org-test-1', {
        since,
        limit: 50,
      });

      expect(db.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-test-1',
            updatedAt: { gt: new Date(since) },
          }),
          take: 50,
        }),
      );

      expect(result.customers.length).toBe(1);
      expect(result.products.length).toBe(1);
      expect(result.nextCursor).toBe(mockUpdated.toISOString());
      expect(result.hasMore).toBe(false);
    });
  });
});
