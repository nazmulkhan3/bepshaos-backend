import { Test, TestingModule } from '@nestjs/testing';
import { RoleService } from './role.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('RoleService', () => {
  let service: RoleService;
  let dbService: DatabaseService;

  const mockDbService = {
    role: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    permission: {
      findMany: vi.fn(),
    },
    rolePermission: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    organizationMember: {
      count: vi.fn(),
    },
    $transaction: vi.fn((cb) => cb(mockDbService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        {
          provide: DatabaseService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<RoleService>(RoleService);
    dbService = module.get<DatabaseService>(DatabaseService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return system and custom roles', async () => {
      const mockRoles = [{ id: '1', name: 'OWNER' }];
      mockDbService.role.findMany.mockResolvedValueOnce(mockRoles);
      
      const result = await service.findAll('org1');
      expect(result).toEqual(mockRoles);
    });
  });

  describe('createRole', () => {
    it('should throw if invalid permissions are requested', async () => {
      mockDbService.permission.findMany.mockResolvedValueOnce([]); // No permissions found
      
      await expect(service.createRole('org1', { name: 'Test', permissions: ['invalid'] }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw if role name already exists', async () => {
      mockDbService.permission.findMany.mockResolvedValueOnce([{ id: 'p1', action: 'valid' }]);
      mockDbService.role.findFirst.mockResolvedValueOnce({ id: 'r1', name: 'Test' }); // Role exists
      
      await expect(service.createRole('org1', { name: 'Test', permissions: ['valid'] }))
        .rejects.toThrow(BadRequestException);
    });

    it('should create a role successfully', async () => {
      mockDbService.permission.findMany.mockResolvedValueOnce([{ id: 'p1', action: 'valid' }]);
      mockDbService.role.findFirst.mockResolvedValueOnce(null);
      mockDbService.role.create.mockResolvedValueOnce({ id: 'r1', name: 'Test' });

      const result = await service.createRole('org1', { name: 'Test', permissions: ['valid'] });
      expect(result).toEqual({ id: 'r1', name: 'Test' });
    });
  });

  describe('deleteRole', () => {
    it('should throw NotFound if role does not exist or is system role', async () => {
      mockDbService.role.findFirst.mockResolvedValueOnce(null);
      
      await expect(service.deleteRole('org1', 'r1')).rejects.toThrow(NotFoundException);
    });

    it('should throw if role is assigned to members', async () => {
      mockDbService.role.findFirst.mockResolvedValueOnce({ id: 'r1', name: 'Test' });
      mockDbService.organizationMember.count.mockResolvedValueOnce(1); // 1 member has it
      
      await expect(service.deleteRole('org1', 'r1')).rejects.toThrow(BadRequestException);
    });

    it('should delete role successfully', async () => {
      mockDbService.role.findFirst.mockResolvedValueOnce({ id: 'r1', name: 'Test' });
      mockDbService.organizationMember.count.mockResolvedValueOnce(0);
      mockDbService.role.delete.mockResolvedValueOnce({ id: 'r1' });
      
      const result = await service.deleteRole('org1', 'r1');
      expect(result).toEqual({ success: true });
    });
  });
});
