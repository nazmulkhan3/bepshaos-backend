import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import { Prisma } from '@prisma/client';

describe('InventoryService', () => {
  let service: InventoryService;
  let db: DatabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: DatabaseService,
          useValue: {
            $transaction: vi.fn(),
            inventory: {
              findMany: vi.fn(),
              count: vi.fn(),
              findUnique: vi.fn(),
              findFirst: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
            inventoryMovement: {
              findMany: vi.fn(),
              count: vi.fn(),
              findUnique: vi.fn(),
              create: vi.fn(),
            },
            $queryRaw: vi.fn(),
            auditLog: {
              create: vi.fn(),
            },
            product: {
              findUnique: vi.fn(),
            },
            branch: {
              findUnique: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    db = module.get<DatabaseService>(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated inventory data', async () => {
      const mockData = [{ id: 'inv-1', quantity: 10 }];
      vi.spyOn(db.inventory, 'findMany').mockResolvedValue(mockData as any);
      vi.spyOn(db.inventory, 'count').mockResolvedValue(1);

      const result = await service.findAll('org-1', { page: 1, limit: 10 } as any);
      expect(result.data).toEqual(mockData);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findAllMovements', () => {
    it('should return paginated movement data', async () => {
      const mockData = [{ id: 'mov-1', quantity: 10 }];
      vi.spyOn(db.inventoryMovement, 'findMany').mockResolvedValue(mockData as any);
      vi.spyOn(db.inventoryMovement, 'count').mockResolvedValue(1);

      const result = await service.findAllMovements('org-1', { page: 1, limit: 10 } as any);
      expect(result.data).toEqual(mockData);
    });
  });

  // Note: Detailed unit testing for transaction blocks usually relies on E2E 
  // because mocking nested transaction callbacks is brittle.
  // E2E handles concurrency and idempotency testing better.
});
