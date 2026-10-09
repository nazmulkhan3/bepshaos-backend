import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { TenantGuard } from './tenant.guard.js';
import { MemberStatus, OrganizationStatus } from '@prisma/client';

describe('TenantGuard (IDOR & Tenant Isolation)', () => {
  let guard: TenantGuard;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      organizationMember: {
        findUnique: vi.fn(),
      },
    };

    guard = new TenantGuard(prisma);
  });

  const createMockContext = (req: {
    user?: any;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  }) => {
    const request: any = {
      user: req.user,
      headers: req.headers || {},
      params: req.params || {},
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  it('should throw UnauthorizedException if user is missing', async () => {
    const ctx = createMockContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw BadRequestException if organization ID is missing in headers and params', async () => {
    const ctx = createMockContext({ user: { sub: 'usr-1' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
  });

  it('IDOR Protection: should reject if header and param organization IDs mismatch', async () => {
    const ctx = createMockContext({
      user: { sub: 'usr-1' },
      headers: { 'x-organization-id': 'org-tenant-a' },
      params: { organizationId: 'org-tenant-b' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Organization ID mismatch between x-organization-id header and request path parameters',
    );
  });

  it('should reject if user is not a member of the organization (IDOR attempt across orgs)', async () => {
    const ctx = createMockContext({
      user: { sub: 'usr-attacker' },
      params: { organizationId: 'org-victim' },
    });

    prisma.organizationMember.findUnique.mockResolvedValueOnce(null);

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'You are not a member of this organization',
    );
  });

  it('should reject if member is INACTIVE', async () => {
    const ctx = createMockContext({
      user: { sub: 'usr-1' },
      params: { organizationId: 'org-1' },
    });

    prisma.organizationMember.findUnique.mockResolvedValueOnce({
      status: MemberStatus.INACTIVE,
      organization: { status: OrganizationStatus.ACTIVE },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Your membership in this organization is not active',
    );
  });

  it('should reject if organization is not ACTIVE', async () => {
    const ctx = createMockContext({
      user: { sub: 'usr-1' },
      params: { organizationId: 'org-1' },
    });

    prisma.organizationMember.findUnique.mockResolvedValueOnce({
      status: MemberStatus.ACTIVE,
      organization: { status: OrganizationStatus.SUSPENDED },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'This organization is not active',
    );
  });

  it('should populate organizationContext and return true for valid member', async () => {
    const ctx = createMockContext({
      user: { sub: 'usr-1' },
      params: { organizationId: 'org-1' },
    });

    prisma.organizationMember.findUnique.mockResolvedValueOnce({
      id: 'mem-1',
      organizationId: 'org-1',
      userId: 'usr-1',
      roleId: 'role-1',
      role: { name: 'ADMIN' },
      status: MemberStatus.ACTIVE,
      organization: { status: OrganizationStatus.ACTIVE },
    });

    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);

    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.organizationContext).toEqual({
      organizationId: 'org-1',
      userId: 'usr-1',
      membershipId: 'mem-1',
      roleId: 'role-1',
      roleName: 'ADMIN',
      status: MemberStatus.ACTIVE,
      organizationStatus: OrganizationStatus.ACTIVE,
    });
  });
});
