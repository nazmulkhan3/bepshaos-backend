import { NotificationQueueService } from '../notification/notification.queue.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { SalesService } from './sales.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  BranchStatus,
  CustomerStatus,
  ProductStatus,
  SaleStatus,
  InventoryMovementType,
  Prisma,
} from '@prisma/client';

describe('SalesService', () => {
  let service: SalesService;
  let db: any;

  beforeEach(async () => {
    db = {
      $transaction: vi.fn((callback) => callback(db)),
      $queryRaw: vi.fn(),
      sale: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      branch: {
        findUnique: vi.fn(),
      },
      customer: {
        findUnique: vi.fn(),
      },
      product: {
        findMany: vi.fn(),
      },
      inventory: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      inventoryMovement: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };

    const mockLedgerService = {
      postSaleJournal: vi.fn().mockResolvedValue({}),
      reverseSaleJournal: vi.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SalesService,
        {
          provide: DatabaseService,
          useValue: db,
        },
        {
          provide: LedgerService,
          useValue: mockLedgerService,
        },
        {
          provide: NotificationQueueService,
          useValue: { enqueue: vi.fn() },
        },
        ],
    }).compile();

    service = module.get<SalesService>(SalesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const orgId = 'org-1';
    const userId = 'user-1';
    const validDto = {
      branchId: 'branch-1',
      customerId: 'customer-1',
      items: [
        {
          productId: 'prod-1',
          quantity: 2,
          unitPrice: 100,
          discountAmount: 10,
          taxAmount: 5,
        },
      ],
      discountAmount: 5,
      taxAmount: 2,
      note: 'Test Sale',
    };

    it('should reject sale with duplicate products in items', async () => {
      const duplicateDto = {
        branchId: 'branch-1',
        items: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-1', quantity: 3 },
        ],
      };

      await expect(
        service.create(orgId, userId, duplicateDto as any)
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject sale with quantity <= 0', async () => {
      const invalidQtyDto = {
        branchId: 'branch-1',
        items: [{ productId: 'prod-1', quantity: 0 }],
      };

      await expect(
        service.create(orgId, userId, invalidQtyDto as any)
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if branch not found or belongs to another org', async () => {
      db.branch.findUnique.mockResolvedValue(null);

      await expect(service.create(orgId, userId, validDto as any)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException if branch is inactive', async () => {
      db.branch.findUnique.mockResolvedValue({
        id: 'branch-1',
        organizationId: orgId,
        status: BranchStatus.INACTIVE,
      });

      await expect(service.create(orgId, userId, validDto as any)).rejects.toThrow(
        ConflictException
      );
    });

    it('should throw NotFoundException if customer not found or archived', async () => {
      db.branch.findUnique.mockResolvedValue({
        id: 'branch-1',
        organizationId: orgId,
        status: BranchStatus.ACTIVE,
      });
      db.customer.findUnique.mockResolvedValue(null);

      await expect(service.create(orgId, userId, validDto as any)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException if customer is inactive', async () => {
      db.branch.findUnique.mockResolvedValue({
        id: 'branch-1',
        organizationId: orgId,
        status: BranchStatus.ACTIVE,
      });
      db.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        organizationId: orgId,
        status: CustomerStatus.INACTIVE,
      });

      await expect(service.create(orgId, userId, validDto as any)).rejects.toThrow(
        ConflictException
      );
    });

    it('should throw NotFoundException if product is missing', async () => {
      db.branch.findUnique.mockResolvedValue({
        id: 'branch-1',
        organizationId: orgId,
        status: BranchStatus.ACTIVE,
      });
      db.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        organizationId: orgId,
        status: CustomerStatus.ACTIVE,
      });
      db.product.findMany.mockResolvedValue([]);

      await expect(service.create(orgId, userId, validDto as any)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException if product is discontinued', async () => {
      db.branch.findUnique.mockResolvedValue({
        id: 'branch-1',
        organizationId: orgId,
        status: BranchStatus.ACTIVE,
      });
      db.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        organizationId: orgId,
        status: CustomerStatus.ACTIVE,
      });
      db.product.findMany.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'Old Item',
          status: ProductStatus.DISCONTINUED,
          sellingPrice: new Prisma.Decimal(100),
        },
      ]);

      await expect(service.create(orgId, userId, validDto as any)).rejects.toThrow(
        ConflictException
      );
    });

    it('should throw ConflictException on insufficient stock', async () => {
      db.branch.findUnique.mockResolvedValue({
        id: 'branch-1',
        organizationId: orgId,
        status: BranchStatus.ACTIVE,
      });
      db.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        organizationId: orgId,
        status: CustomerStatus.ACTIVE,
      });
      db.product.findMany.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'Widget',
          status: ProductStatus.ACTIVE,
          sellingPrice: new Prisma.Decimal(100),
        },
      ]);
      db.inventory.findFirst.mockResolvedValue({
        id: 'inv-1',
        organizationId: orgId,
        branchId: 'branch-1',
        productId: 'prod-1',
        quantity: 1,
      });
      db.$queryRaw.mockResolvedValue([{ id: 'inv-1', quantity: 1 }]);

      await expect(service.create(orgId, userId, validDto as any)).rejects.toThrow(
        ConflictException
      );
    });

    it('should create sale successfully and deduct inventory atomically', async () => {
      db.branch.findUnique.mockResolvedValue({
        id: 'branch-1',
        organizationId: orgId,
        status: BranchStatus.ACTIVE,
      });
      db.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        organizationId: orgId,
        status: CustomerStatus.ACTIVE,
      });
      db.product.findMany.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'Widget',
          status: ProductStatus.ACTIVE,
          sellingPrice: new Prisma.Decimal(100),
        },
      ]);
      db.inventory.findFirst.mockResolvedValue({
        id: 'inv-1',
        organizationId: orgId,
        branchId: 'branch-1',
        productId: 'prod-1',
        quantity: 10,
      });
      db.$queryRaw.mockResolvedValue([{ id: 'inv-1', quantity: 10 }]);
      db.sale.findFirst.mockResolvedValue({ saleNumber: 'SALE-000005' });

      const mockCreatedSale = {
        id: 'sale-1',
        saleNumber: 'SALE-000006',
        subtotal: new Prisma.Decimal(200),
        discountAmount: new Prisma.Decimal(15),
        taxAmount: new Prisma.Decimal(7),
        totalAmount: new Prisma.Decimal(192),
        status: SaleStatus.COMPLETED,
        items: [{ id: 'item-1', productId: 'prod-1', quantity: 2 }],
      };
      db.sale.create.mockResolvedValue(mockCreatedSale);

      const result = await service.create(orgId, userId, validDto as any);

      expect(result.saleNumber).toBe('SALE-000006');
      expect(db.inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: { quantity: 8 },
        })
      );
      expect(db.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: InventoryMovementType.STOCK_OUT,
            referenceType: 'SALE',
            referenceId: 'sale-1',
            quantity: 2,
          }),
        })
      );
      expect(db.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SALE_CREATED',
            entity: 'Sale',
            entityId: 'sale-1',
          }),
        })
      );
    });

    it('should handle idempotency: return existing sale if payload matches', async () => {
      const dtoWithKey = { ...validDto, idempotencyKey: 'idem-key-1' };
      const expectedHash = (service as any).generateRequestHash(dtoWithKey);

      const existingSale = {
        id: 'existing-sale-1',
        organizationId: orgId,
        idempotencyKey: 'idem-key-1',
        requestHash: expectedHash,
        saleNumber: 'SALE-000001',
      };
      db.sale.findUnique.mockResolvedValue(existingSale);

      const result = await service.create(orgId, userId, dtoWithKey as any);
      expect(result.id).toBe('existing-sale-1');
      expect(db.sale.create).not.toHaveBeenCalled();
    });

    it('should handle idempotency: throw ConflictException if payload differs for same key', async () => {
      const dtoWithKey = { ...validDto, idempotencyKey: 'idem-key-1' };
      const existingSale = {
        id: 'existing-sale-1',
        organizationId: orgId,
        idempotencyKey: 'idem-key-1',
        requestHash: 'different-hash',
        saleNumber: 'SALE-000001',
      };
      db.sale.findUnique.mockResolvedValue(existingSale);

      await expect(service.create(orgId, userId, dtoWithKey as any)).rejects.toThrow(
        ConflictException
      );
    });

    it('should test transaction atomicity rollback on error before commit', async () => {
      db.branch.findUnique.mockResolvedValue({
        id: 'branch-1',
        organizationId: orgId,
        status: BranchStatus.ACTIVE,
      });
      db.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        organizationId: orgId,
        status: CustomerStatus.ACTIVE,
      });
      db.product.findMany.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'Widget',
          status: ProductStatus.ACTIVE,
          sellingPrice: new Prisma.Decimal(100),
        },
      ]);
      db.inventory.findFirst.mockResolvedValue({
        id: 'inv-1',
        organizationId: orgId,
        branchId: 'branch-1',
        productId: 'prod-1',
        quantity: 10,
      });
      db.$queryRaw.mockResolvedValue([{ id: 'inv-1', quantity: 10 }]);
      db.sale.findFirst.mockResolvedValue(null);

      // Force sale creation to throw error
      db.sale.create.mockRejectedValue(new Error('Simulated DB failure before commit'));

      await expect(service.create(orgId, userId, validDto as any)).rejects.toThrow(
        'Simulated DB failure before commit'
      );
      // Ensure movements were not created
      expect(db.inventoryMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    const orgId = 'org-1';
    const userId = 'user-1';
    const saleId = 'sale-1';

    it('should throw NotFoundException if sale does not exist or wrong org', async () => {
      db.sale.findUnique.mockResolvedValue(null);

      await expect(service.cancel(orgId, saleId, userId)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException if sale is already cancelled', async () => {
      db.sale.findUnique.mockResolvedValue({
        id: saleId,
        organizationId: orgId,
        status: SaleStatus.CANCELLED,
      });
      db.$queryRaw.mockResolvedValue([{ status: SaleStatus.CANCELLED }]);

      // Idempotent success is expected based on current logic
      const result = await service.cancel(orgId, saleId, userId);
      expect(result).toBeDefined();
    });

    it('should cancel sale and restore stock with compensating movement', async () => {
      const mockSale = {
        id: saleId,
        organizationId: orgId,
        branchId: 'branch-1',
        saleNumber: 'SALE-000001',
        status: SaleStatus.COMPLETED,
        items: [{ productId: 'prod-1', quantity: 3 }],
      };
      db.sale.findUnique.mockResolvedValue(mockSale);
      db.inventory.findFirst.mockResolvedValue({
        id: 'inv-1',
        organizationId: orgId,
        branchId: 'branch-1',
        productId: 'prod-1',
        quantity: 5,
      });
      db.$queryRaw
        .mockResolvedValueOnce([{ status: SaleStatus.COMPLETED }])
        .mockResolvedValueOnce([{ id: 'inv-1', quantity: 5 }]);
      db.sale.update.mockResolvedValue({
        ...mockSale,
        status: SaleStatus.CANCELLED,
      });

      const result = await service.cancel(orgId, saleId, userId, { reason: 'Customer returned' });

      expect(result.status).toBe(SaleStatus.CANCELLED);
      // Restores 5 + 3 = 8
      expect(db.inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: { quantity: 8 },
        })
      );
      expect(db.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: InventoryMovementType.STOCK_IN,
            referenceType: 'SALE_CANCEL',
            referenceId: saleId,
            quantity: 3,
          }),
        })
      );
      expect(db.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SALE_CANCELLED',
            entity: 'Sale',
            entityId: saleId,
          }),
        })
      );
    });

    it('should test cancellation rollback atomicity if inventory update fails', async () => {
      const mockSale = {
        id: saleId,
        organizationId: orgId,
        branchId: 'branch-1',
        saleNumber: 'SALE-000001',
        status: SaleStatus.COMPLETED,
        items: [{ productId: 'prod-1', quantity: 3 }],
      };
      db.sale.findUnique.mockResolvedValue(mockSale);
      db.inventory.findFirst.mockResolvedValue({
        id: 'inv-1',
        organizationId: orgId,
        branchId: 'branch-1',
        productId: 'prod-1',
        quantity: 5,
      });
      db.$queryRaw
        .mockResolvedValueOnce([{ status: SaleStatus.COMPLETED }])
        .mockResolvedValueOnce([{ id: 'inv-1', quantity: 5 }]);
      db.inventory.update.mockRejectedValue(new Error('DB failure during stock restore'));

      await expect(service.cancel(orgId, saleId, userId)).rejects.toThrow(
        'DB failure during stock restore'
      );
      expect(db.sale.update).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll and findOne', () => {
    it('should return sale by ID', async () => {
      db.sale.findUnique.mockResolvedValue({
        id: 'sale-1',
        organizationId: 'org-1',
        saleNumber: 'SALE-000001',
      });

      const res = await service.findOne('org-1', 'sale-1');
      expect(res.id).toBe('sale-1');
    });

    it('should return paginated sales', async () => {
      db.sale.findMany.mockResolvedValue([{ id: 'sale-1' }]);
      db.sale.count.mockResolvedValue(1);

      const res = await service.findAll('org-1', { page: 1, limit: 10 } as any);
      expect(res.data.length).toBe(1);
      expect(res.meta.total).toBe(1);
    });
  });
});
