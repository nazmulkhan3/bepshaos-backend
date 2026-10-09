import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import { UserStatus } from '@prisma/client';

describe('PlatformAdminGuard (Platform-Admin Authorization)', () => {
  let guard: PlatformAdminGuard;
  let configService: any;
  let prisma: any;

  beforeEach(() => {
    configService = {
      get: vi.fn((key: string) => {
        if (key === 'platformAdmin.emails') return 'admin@bebshaos.com,superadmin@bebshaos.com';
        if (key === 'platformAdmin.userIds') return 'usr-admin-123';
        return '';
      }),
    };

    prisma = {
      user: {
        findUnique: vi.fn(),
      },
    };

    guard = new PlatformAdminGuard(configService, prisma);
  });

  const createMockContext = (userPayload: any) => {
    const request: any = { user: userPayload };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  it('should throw UnauthorizedException if user is not authenticated', async () => {
    const ctx = createMockContext(null);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw ForbiddenException if user does not exist in DB or is INACTIVE', async () => {
    const ctx = createMockContext({ sub: 'user-inactive' });
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'user-inactive',
      email: 'admin@bebshaos.com',
      status: UserStatus.INACTIVE,
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should reject standard tenant user (even with tenant OWNER/ADMIN role)', async () => {
    const ctx = createMockContext({ sub: 'tenant-owner' });
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'tenant-owner',
      email: 'owner@tenantstore.com',
      status: UserStatus.ACTIVE,
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Access denied: platform administration privileges required. Tenant roles do not grant platform access.',
    );
  });

  it('should allow access if user email matches configured platform admin emails', async () => {
    const ctx = createMockContext({ sub: 'platform-admin-1' });
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'platform-admin-1',
      email: 'Admin@BebshaOS.com', // test case insensitivity
      status: UserStatus.ACTIVE,
    });

    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);

    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.isPlatformAdmin).toBe(true);
    expect(req.platformAdminUser).toBeDefined();
  });

  it('should allow access if user ID matches configured platform admin user IDs', async () => {
    const ctx = createMockContext({ sub: 'usr-admin-123' });
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'usr-admin-123',
      email: 'custom@domain.com',
      status: UserStatus.ACTIVE,
    });

    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);
  });
});
