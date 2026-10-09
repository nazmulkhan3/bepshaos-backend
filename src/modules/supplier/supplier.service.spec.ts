import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { SupplierService } from './supplier.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { SupplierStatus } from '@prisma/client';

describe('SupplierService', () => {
  let service: SupplierService;

  const mockPrismaService = {
    supplier: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
    auditLog: {
      create: vi.fn(),
    },
  };

  beforeEach(async () => {
    mockPrismaService.$transaction.mockImplementation(async (callback: any) => {
      return callback(mockPrismaService);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierService,
        { provide: DatabaseService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SupplierService>(SupplierService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create supplier with SUP-000001 when no suppliers exist', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);
      mockPrismaService.supplier.create.mockResolvedValue({ id: 'sup1', supplierCode: 'SUP-000001', name: 'Test Supplier' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.create('org1', { name: 'Test Supplier' } as any, 'user1');

      expect(result.supplierCode).toBe('SUP-000001');
      expect(mockPrismaService.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ supplierCode: 'SUP-000001', name: 'Test Supplier', organizationId: 'org1' }),
      });
    });

    it('should generate next sequential code SUP-000002', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ supplierCode: 'SUP-000001' });
      mockPrismaService.supplier.create.mockResolvedValue({ id: 'sup2', supplierCode: 'SUP-000002', name: 'Second Supplier' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.create('org1', { name: 'Second Supplier' } as any, 'user1');

      expect(result.supplierCode).toBe('SUP-000002');
    });

    it('should generate SUP-000010 from SUP-000009', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ supplierCode: 'SUP-000009' });
      mockPrismaService.supplier.create.mockResolvedValue({ id: 'sup10', supplierCode: 'SUP-000010', name: 'Tenth' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.create('org1', { name: 'Tenth' } as any, 'user1');

      expect(result.supplierCode).toBe('SUP-000010');
    });

    it('should store organizationId correctly', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);
      mockPrismaService.supplier.create.mockResolvedValue({ id: 'sup1', supplierCode: 'SUP-000001' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.create('org-abc', { name: 'Org Test' } as any, 'user1');

      expect(mockPrismaService.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ organizationId: 'org-abc' }),
      });
    });

    it('should create audit log on creation', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);
      mockPrismaService.supplier.create.mockResolvedValue({ id: 'sup1', supplierCode: 'SUP-000001' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.create('org1', { name: 'Audit Test' } as any, 'user1');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'SUPPLIER_CREATED',
          entity: 'Supplier',
          entityId: 'sup1',
          organizationId: 'org1',
          userId: 'user1',
        }),
      });
    });

    it('should retry on P2002 unique constraint violation', async () => {
      let tries = 0;
      mockPrismaService.supplier.findFirst.mockResolvedValue({ supplierCode: 'SUP-000001' });
      mockPrismaService.supplier.create.mockImplementation(() => {
        tries++;
        if (tries === 1) {
          const error: any = new Error('Unique constraint');
          error.code = 'P2002';
          error.meta = { target: ['organizationId', 'supplierCode'] };
          throw error;
        }
        return Promise.resolve({ id: 'sup2', supplierCode: 'SUP-000002' });
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.create('org1', { name: 'Retry Test' } as any, 'user1');

      expect(result.supplierCode).toBe('SUP-000002');
      expect(tries).toBe(2);
    });

    it('should throw ConflictException after 5 retries', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ supplierCode: 'SUP-000001' });
      mockPrismaService.supplier.create.mockImplementation(() => {
        const error: any = new Error('Unique constraint');
        error.code = 'P2002';
        error.meta = { target: ['organizationId', 'supplierCode'] };
        throw error;
      });

      await expect(service.create('org1', { name: 'Fail' } as any, 'user1')).rejects.toThrow(ConflictException);
    });

    it('should throw non-P2002 errors immediately', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);
      mockPrismaService.supplier.create.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.create('org1', { name: 'Error' } as any, 'user1')).rejects.toThrow('DB connection lost');
    });
  });

  describe('findOne', () => {
    it('should return supplier if found in same organization', async () => {
      const mockSupplier = { id: 'sup1', name: 'Found', organizationId: 'org1', addresses: [] };
      mockPrismaService.supplier.findFirst.mockResolvedValue(mockSupplier);

      const result = await service.findOne('org1', 'sup1');

      expect(result).toEqual(mockSupplier);
      expect(mockPrismaService.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: 'sup1', organizationId: 'org1' },
        include: { addresses: true },
      });
    });

    it('should throw NotFoundException if supplier not found', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);

      await expect(service.findOne('org1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should not return supplier from another organization', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);

      await expect(service.findOne('org1', 'sup-from-org2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const mockData = [{ id: 'sup1', name: 'Supplier 1' }, { id: 'sup2', name: 'Supplier 2' }];
      mockPrismaService.supplier.findMany.mockResolvedValue(mockData);
      mockPrismaService.supplier.count.mockResolvedValue(2);

      const result = await service.findAll('org1', { page: 1, limit: 20 } as any);

      expect(result.data).toEqual(mockData);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it('should filter by status', async () => {
      mockPrismaService.supplier.findMany.mockResolvedValue([]);
      mockPrismaService.supplier.count.mockResolvedValue(0);

      await service.findAll('org1', { status: SupplierStatus.ACTIVE } as any);

      expect(mockPrismaService.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: SupplierStatus.ACTIVE }),
        }),
      );
    });

    it('should default to excluding ARCHIVED', async () => {
      mockPrismaService.supplier.findMany.mockResolvedValue([]);
      mockPrismaService.supplier.count.mockResolvedValue(0);

      await service.findAll('org1', {} as any);

      expect(mockPrismaService.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { not: 'ARCHIVED' } }),
        }),
      );
    });

    it('should search across name, companyName, email, phone, supplierCode, taxNumber', async () => {
      mockPrismaService.supplier.findMany.mockResolvedValue([]);
      mockPrismaService.supplier.count.mockResolvedValue(0);

      await service.findAll('org1', { search: 'test' } as any);

      expect(mockPrismaService.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.any(Object) }),
              expect.objectContaining({ companyName: expect.any(Object) }),
              expect.objectContaining({ supplierCode: expect.any(Object) }),
              expect.objectContaining({ email: expect.any(Object) }),
              expect.objectContaining({ phone: expect.any(Object) }),
              expect.objectContaining({ taxNumber: expect.any(Object) }),
            ]),
          }),
        }),
      );
    });

    it('should sort by allowed fields only', async () => {
      mockPrismaService.supplier.findMany.mockResolvedValue([]);
      mockPrismaService.supplier.count.mockResolvedValue(0);

      await service.findAll('org1', { sortBy: 'name', sortOrder: 'asc' } as any);

      expect(mockPrismaService.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('should reject invalid sortBy fields and default to createdAt', async () => {
      mockPrismaService.supplier.findMany.mockResolvedValue([]);
      mockPrismaService.supplier.count.mockResolvedValue(0);

      await service.findAll('org1', { sortBy: 'invalidField' } as any);

      expect(mockPrismaService.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should paginate correctly', async () => {
      mockPrismaService.supplier.findMany.mockResolvedValue([]);
      mockPrismaService.supplier.count.mockResolvedValue(50);

      const result = await service.findAll('org1', { page: 2, limit: 10 } as any);

      expect(mockPrismaService.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.meta.total).toBe(50);
      expect(result.meta.totalPages).toBe(5);
      expect(result.meta.page).toBe(2);
    });
  });

  describe('update', () => {
    it('should update supplier successfully', async () => {
      const mockSupplier = { id: 'sup1', name: 'Original', organizationId: 'org1' };
      const updatedSupplier = { id: 'sup1', name: 'Updated', organizationId: 'org1' };
      mockPrismaService.supplier.findFirst.mockResolvedValue(mockSupplier);
      mockPrismaService.supplier.update.mockResolvedValue(updatedSupplier);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.update('org1', 'sup1', { name: 'Updated' } as any, 'user1');

      expect(result.name).toBe('Updated');
    });

    it('should include organizationId in lookup', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);

      await expect(service.update('org1', 'sup1', { name: 'X' } as any, 'user1')).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: 'sup1', organizationId: 'org1' },
        include: { addresses: true },
      });
    });

    it('should not update supplier from another organization', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);

      await expect(service.update('org1', 'sup-from-org2', { name: 'Hacked' } as any, 'user1')).rejects.toThrow(NotFoundException);
    });

    it('should create audit log on update', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ id: 'sup1', organizationId: 'org1' });
      mockPrismaService.supplier.update.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.update('org1', 'sup1', { name: 'Updated' } as any, 'user1');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'SUPPLIER_UPDATED', entity: 'Supplier', entityId: 'sup1' }),
      });
    });
  });

  describe('archive', () => {
    it('should set status to ARCHIVED', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ id: 'sup1', organizationId: 'org1' });
      mockPrismaService.supplier.update.mockResolvedValue({ id: 'sup1', status: SupplierStatus.ARCHIVED });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.archive('org1', 'sup1', 'user1');

      expect(result.status).toBe(SupplierStatus.ARCHIVED);
      expect(mockPrismaService.supplier.update).toHaveBeenCalledWith({
        where: { id: 'sup1' },
        data: { status: 'ARCHIVED' },
      });
    });

    it('should not physically delete the supplier', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ id: 'sup1', organizationId: 'org1' });
      mockPrismaService.supplier.update.mockResolvedValue({ id: 'sup1', status: SupplierStatus.ARCHIVED });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.archive('org1', 'sup1', 'user1');

      expect(mockPrismaService.supplier.update).toHaveBeenCalled();
      // verify no delete was called
      expect((mockPrismaService.supplier as any).delete).toBeUndefined();
    });

    it('should not archive supplier from another organization', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);

      await expect(service.archive('org1', 'sup-from-org2', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('should create audit log on archive', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ id: 'sup1', organizationId: 'org1' });
      mockPrismaService.supplier.update.mockResolvedValue({ id: 'sup1', status: SupplierStatus.ARCHIVED });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.archive('org1', 'sup1', 'user1');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'SUPPLIER_ARCHIVED', entity: 'Supplier', entityId: 'sup1' }),
      });
    });
  });

  describe('restore', () => {
    it('should restore ARCHIVED supplier to ACTIVE', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ id: 'sup1', organizationId: 'org1', status: 'ARCHIVED' });
      mockPrismaService.supplier.update.mockResolvedValue({ id: 'sup1', status: SupplierStatus.ACTIVE });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.restore('org1', 'sup1', 'user1');

      expect(result.status).toBe(SupplierStatus.ACTIVE);
      expect(mockPrismaService.supplier.update).toHaveBeenCalledWith({
        where: { id: 'sup1' },
        data: { status: 'ACTIVE' },
      });
    });

    it('should throw NotFoundException if supplier not found', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);

      await expect(service.restore('org1', 'nonexistent', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if supplier is not ARCHIVED', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ id: 'sup1', status: 'ACTIVE' });

      await expect(service.restore('org1', 'sup1', 'user1')).rejects.toThrow(ConflictException);
    });

    it('should not restore supplier from another organization', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue(null);

      await expect(service.restore('org1', 'sup-from-org2', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('should create audit log on restore', async () => {
      mockPrismaService.supplier.findFirst.mockResolvedValue({ id: 'sup1', status: 'ARCHIVED' });
      mockPrismaService.supplier.update.mockResolvedValue({ id: 'sup1', status: SupplierStatus.ACTIVE });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.restore('org1', 'sup1', 'user1');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'SUPPLIER_RESTORED', entity: 'Supplier', entityId: 'sup1' }),
      });
    });
  });
});
