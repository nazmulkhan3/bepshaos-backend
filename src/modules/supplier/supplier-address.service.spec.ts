import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { SupplierAddressService } from './supplier-address.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { SupplierService } from './supplier.service.js';
import { NotFoundException } from '@nestjs/common';

describe('SupplierAddressService', () => {
  let service: SupplierAddressService;
  let _supplierService: SupplierService;

  const mockPrismaService = {
    supplierAddress: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
    auditLog: {
      create: vi.fn(),
    },
  };

  const mockSupplierService = {
    findOne: vi.fn(),
  };

  beforeEach(async () => {
    mockPrismaService.$transaction.mockImplementation(async (callback: any) => {
      return callback(mockPrismaService);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierAddressService,
        { provide: DatabaseService, useValue: mockPrismaService },
        { provide: SupplierService, useValue: mockSupplierService },
      ],
    }).compile();

    service = module.get<SupplierAddressService>(SupplierAddressService);
    _supplierService = module.get<SupplierService>(SupplierService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create address successfully', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.count.mockResolvedValue(0);
      mockPrismaService.supplierAddress.create.mockResolvedValue({ id: 'addr1', addressLine1: '123 Main St', isDefault: true });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.create('org1', 'sup1', { addressLine1: '123 Main St', isDefault: true } as any, 'user1');

      expect(result.id).toBe('addr1');
      expect(result.isDefault).toBe(true);
    });

    it('should auto-set first address as default', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.count.mockResolvedValue(0);
      mockPrismaService.supplierAddress.create.mockImplementation((args: any) => {
        return Promise.resolve({ id: 'addr1', ...args.data });
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.create('org1', 'sup1', { addressLine1: '123 Main St' } as any, 'user1');

      expect(result.isDefault).toBe(true);
    });

    it('should not auto-set default when isDefault is explicitly false', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.count.mockResolvedValue(0);
      mockPrismaService.supplierAddress.create.mockImplementation((args: any) => {
        return Promise.resolve({ id: 'addr1', ...args.data });
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.create('org1', 'sup1', { addressLine1: '123 Main St', isDefault: false } as any, 'user1');

      expect(result.isDefault).toBe(false);
    });

    it('should unset other defaults when creating default address', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.count.mockResolvedValue(2);
      mockPrismaService.supplierAddress.create.mockImplementation((args: any) => {
        return Promise.resolve({ id: 'addr3', ...args.data });
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.create('org1', 'sup1', { addressLine1: 'New Default', isDefault: true } as any, 'user1');

      expect(mockPrismaService.supplierAddress.updateMany).toHaveBeenCalledWith({
        where: { supplierId: 'sup1' },
        data: { isDefault: false },
      });
    });

    it('should reject if supplier not found in organization', async () => {
      mockSupplierService.findOne.mockRejectedValue(new NotFoundException('Supplier not found'));

      await expect(service.create('org1', 'nonexistent', { addressLine1: 'X' } as any, 'user1')).rejects.toThrow(NotFoundException);
    });

    it('should create audit log', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.count.mockResolvedValue(0);
      mockPrismaService.supplierAddress.create.mockResolvedValue({ id: 'addr1', isDefault: true });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.create('org1', 'sup1', { addressLine1: 'Audit Test', isDefault: true } as any, 'user1');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'SUPPLIER_ADDRESS_CREATED', entity: 'SupplierAddress', entityId: 'addr1' }),
      });
    });
  });

  describe('findAll', () => {
    it('should return addresses for supplier', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.findMany.mockResolvedValue([
        { id: 'addr1', addressLine1: 'Main' },
        { id: 'addr2', addressLine1: 'Branch' },
      ]);

      const result = await service.findAll('org1', 'sup1');

      expect(result).toHaveLength(2);
    });

    it('should reject if supplier not in organization', async () => {
      mockSupplierService.findOne.mockRejectedValue(new NotFoundException());

      await expect(service.findAll('org1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('should return address if found', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.findFirst.mockResolvedValue({ id: 'addr1', supplierId: 'sup1', addressLine1: 'Main' });

      const result = await service.findOne('org1', 'sup1', 'addr1');

      expect(result.id).toBe('addr1');
    });

    it('should throw NotFoundException if address not found', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.findFirst.mockResolvedValue(null);

      await expect(service.findOne('org1', 'sup1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should reject cross-tenant address access', async () => {
      mockSupplierService.findOne.mockRejectedValue(new NotFoundException());

      await expect(service.findOne('org1', 'other-sup', 'addr1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update address successfully', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.findFirst.mockResolvedValue({ id: 'addr1', supplierId: 'sup1' });
      mockPrismaService.supplierAddress.update.mockResolvedValue({ id: 'addr1', addressLine1: 'Updated' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.update('org1', 'sup1', 'addr1', { addressLine1: 'Updated' } as any, 'user1');

      expect(result.addressLine1).toBe('Updated');
    });

    it('should unset other defaults when setting isDefault', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.findFirst.mockResolvedValue({ id: 'addr1', supplierId: 'sup1' });
      mockPrismaService.supplierAddress.update.mockResolvedValue({ id: 'addr1', isDefault: true });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.update('org1', 'sup1', 'addr1', { isDefault: true } as any, 'user1');

      expect(mockPrismaService.supplierAddress.updateMany).toHaveBeenCalledWith({
        where: { supplierId: 'sup1', id: { not: 'addr1' } },
        data: { isDefault: false },
      });
    });

    it('should create audit log on update', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.findFirst.mockResolvedValue({ id: 'addr1', supplierId: 'sup1' });
      mockPrismaService.supplierAddress.update.mockResolvedValue({ id: 'addr1' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.update('org1', 'sup1', 'addr1', { city: 'Dhaka' } as any, 'user1');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'SUPPLIER_ADDRESS_UPDATED', entity: 'SupplierAddress', entityId: 'addr1' }),
      });
    });
  });

  describe('remove', () => {
    it('should delete address successfully', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.findFirst.mockResolvedValue({ id: 'addr1', supplierId: 'sup1' });
      mockPrismaService.supplierAddress.delete.mockResolvedValue({ id: 'addr1' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.remove('org1', 'sup1', 'addr1', 'user1');

      expect(result.id).toBe('addr1');
    });

    it('should throw NotFoundException if address not found', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.findFirst.mockResolvedValue(null);

      await expect(service.remove('org1', 'sup1', 'nonexistent', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('should create audit log on remove', async () => {
      mockSupplierService.findOne.mockResolvedValue({ id: 'sup1' });
      mockPrismaService.supplierAddress.findFirst.mockResolvedValue({ id: 'addr1', supplierId: 'sup1' });
      mockPrismaService.supplierAddress.delete.mockResolvedValue({ id: 'addr1' });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.remove('org1', 'sup1', 'addr1', 'user1');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'SUPPLIER_ADDRESS_DELETED', entity: 'SupplierAddress', entityId: 'addr1' }),
      });
    });
  });
});
