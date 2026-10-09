import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { CustomerService } from './customer.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { NotFoundException } from '@nestjs/common';
import { CustomerStatus } from '@prisma/client';

describe('CustomerService', () => {
  let service: CustomerService;
  let prisma: DatabaseService;

  const mockPrismaService = {
    customer: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(mockPrismaService)),
    auditLog: {
      create: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: DatabaseService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
    prisma = module.get<DatabaseService>(DatabaseService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a customer with initial sequence CUS-000001 if no customers exist', async () => {
      mockPrismaService.customer.findFirst.mockResolvedValue(null);
      mockPrismaService.customer.create.mockResolvedValue({ id: 'cus1', customerCode: 'CUS-000001' });

      const res = await service.create('org1', { name: 'Test' }, 'user1');
      expect(res.customerCode).toBe('CUS-000001');
      expect(mockPrismaService.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ customerCode: 'CUS-000001', name: 'Test' })
      });
    });

    it('should correctly increment the customer sequence', async () => {
      mockPrismaService.customer.findFirst.mockResolvedValue({ customerCode: 'CUS-000009' });
      mockPrismaService.customer.create.mockResolvedValue({ id: 'cus2', customerCode: 'CUS-000010' });

      const res = await service.create('org1', { name: 'Test 2' }, 'user1');
      expect(res.customerCode).toBe('CUS-000010');
    });

    it('should retry if unique constraint P2002 is hit', async () => {
      let tries = 0;
      mockPrismaService.customer.findFirst.mockResolvedValue({ customerCode: 'CUS-000001' });
      mockPrismaService.customer.create.mockImplementation(() => {
        tries++;
        if (tries === 1) {
          const error: any = new Error('Unique constraint');
          error.code = 'P2002';
          error.meta = { target: ['organizationId', 'customerCode'] };
          throw error;
        }
        return Promise.resolve({ id: 'cus3', customerCode: 'CUS-000002' });
      });

      const res = await service.create('org1', { name: 'Test Retry' }, 'user1');
      expect(res.customerCode).toBe('CUS-000002');
      expect(tries).toBe(2);
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if customer does not exist', async () => {
      mockPrismaService.customer.findFirst.mockResolvedValue(null);
      await expect(service.findOne('org1', 'cus1')).rejects.toThrow(NotFoundException);
    });

    it('should return customer if exists', async () => {
      const mockCust = { id: 'cus1', name: 'Found' };
      mockPrismaService.customer.findFirst.mockResolvedValue(mockCust);
      const res = await service.findOne('org1', 'cus1');
      expect(res.name).toBe('Found');
    });
  });

  describe('archive', () => {
    it('should set status to ARCHIVED', async () => {
      mockPrismaService.customer.findFirst.mockResolvedValue({ id: 'cus1' });
      mockPrismaService.customer.update.mockResolvedValue({ id: 'cus1', status: CustomerStatus.ARCHIVED });

      const res = await service.archive('org1', 'cus1', 'user1');
      expect(res.status).toBe(CustomerStatus.ARCHIVED);
      expect(mockPrismaService.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ARCHIVED' } })
      );
    });
  });
});
