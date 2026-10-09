import { Test, TestingModule } from '@nestjs/testing';
import { CategoryService } from './category.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { vi } from 'vitest';

describe('CategoryService', () => {
  let service: CategoryService;
  let dbService: DatabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        {
          provide: DatabaseService,
          useValue: {
            $transaction: vi.fn(),
            category: {
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

    service = module.get<CategoryService>(CategoryService);
    dbService = module.get<DatabaseService>(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
