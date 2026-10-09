import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { vi } from 'vitest';

describe('ProductService', () => {
  let service: ProductService;
  let dbService: DatabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        {
          provide: DatabaseService,
          useValue: {
            $transaction: vi.fn(),
            product: {
              create: vi.fn(),
              findMany: vi.fn(),
              findUnique: vi.fn(),
              findFirst: vi.fn(),
              update: vi.fn(),
              count: vi.fn(),
            },
            auditLog: {
              create: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
    dbService = module.get<DatabaseService>(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
