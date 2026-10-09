import { Test, TestingModule } from '@nestjs/testing';
import { AuthorizationService } from './authorization.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { ForbiddenException } from '@nestjs/common';

describe('AuthorizationService', () => {
  let service: AuthorizationService;
  let dbService: DatabaseService;

  const mockDbService = {
    organizationMember: {
      findUnique: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        {
          provide: DatabaseService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<AuthorizationService>(AuthorizationService);
    dbService = module.get<DatabaseService>(DatabaseService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hasPermissions', () => {
    it('should return true if no permissions are requested', async () => {
      const result = await service.hasPermissions('org1', 'user1', []);
      expect(result).toBe(true);
    });

    it('should return false if member is not active or does not exist', async () => {
      mockDbService.organizationMember.findUnique.mockResolvedValueOnce(null);
      const result = await service.hasPermissions('org1', 'user1', ['product:read']);
      expect(result).toBe(false);
    });

    it('should return false if member has no role', async () => {
      mockDbService.organizationMember.findUnique.mockResolvedValueOnce({
        status: 'ACTIVE',
        role: null,
      });
      const result = await service.hasPermissions('org1', 'user1', ['product:read']);
      expect(result).toBe(false);
    });

    it('should return true if member has all requested permissions', async () => {
      mockDbService.organizationMember.findUnique.mockResolvedValueOnce({
        status: 'ACTIVE',
        role: {
          permissions: [
            { permission: { action: 'product:read' } },
            { permission: { action: 'product:create' } },
          ],
        },
      });
      const result = await service.hasPermissions('org1', 'user1', ['product:read', 'product:create']);
      expect(result).toBe(true);
    });

    it('should return false if member is missing a requested permission', async () => {
      mockDbService.organizationMember.findUnique.mockResolvedValueOnce({
        status: 'ACTIVE',
        role: {
          permissions: [
            { permission: { action: 'product:read' } },
          ],
        },
      });
      const result = await service.hasPermissions('org1', 'user1', ['product:read', 'product:create']);
      expect(result).toBe(false);
    });
  });

  describe('requirePermissions', () => {
    it('should not throw if user has permissions', async () => {
      vi.spyOn(service, 'hasPermissions').mockResolvedValueOnce(true);
      await expect(service.requirePermissions('org1', 'user1', ['product:read'])).resolves.not.toThrow();
    });

    it('should throw ForbiddenException if user lacks permissions', async () => {
      vi.spyOn(service, 'hasPermissions').mockResolvedValueOnce(false);
      await expect(service.requirePermissions('org1', 'user1', ['product:read'])).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getEffectivePermissions', () => {
    it('should return an empty array if not a member', async () => {
      mockDbService.organizationMember.findUnique.mockResolvedValueOnce(null);
      const result = await service.getEffectivePermissions('org1', 'user1');
      expect(result).toEqual([]);
    });

    it('should return a list of permissions if valid member', async () => {
      mockDbService.organizationMember.findUnique.mockResolvedValueOnce({
        status: 'ACTIVE',
        role: {
          permissions: [
            { permission: { action: 'product:read' } },
            { permission: { action: 'product:create' } },
          ],
        },
      });
      const result = await service.getEffectivePermissions('org1', 'user1');
      expect(result).toEqual(['product:read', 'product:create']);
    });
  });
});
