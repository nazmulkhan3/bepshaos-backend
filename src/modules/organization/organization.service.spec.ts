import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationService } from './organization.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SubscriptionLimitService } from '../subscription/services/subscription-limit.service.js';
import { QuotaResourceType } from '../subscription/interfaces/plan-limits.interface.js';
import { MemberStatus, OrganizationStatus } from '@prisma/client';
import { ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';

describe('OrganizationService (Staff Quota Enforcement & Members)', () => {
  let service: OrganizationService;
  let db: any;
  let ledgerService: any;
  let subscriptionLimitService: any;

  beforeEach(async () => {
    db = {
      $transaction: vi.fn(async (cb) => cb(db)),
      organization: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      role: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      organizationMember: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      plan: {
        findUnique: vi.fn(),
      },
      subscription: {
        create: vi.fn(),
      },
    };

    ledgerService = {
      provisionSystemAccounts: vi.fn().mockResolvedValue([]),
    };

    subscriptionLimitService = {
      enforceQuota: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationService,
        { provide: DatabaseService, useValue: db },
        { provide: LedgerService, useValue: ledgerService },
        { provide: SubscriptionLimitService, useValue: subscriptionLimitService },
      ],
    }).compile();

    service = module.get<OrganizationService>(OrganizationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOrganization', () => {
    it('should provision organization, owner role, member, ledger accounts, and canonical FREE plan', async () => {
      const orgId = 'org-new-1';
      db.organization.create.mockResolvedValueOnce({
        id: orgId,
        name: 'My Store',
        slug: 'my-store-123456',
        status: OrganizationStatus.ACTIVE,
      });

      db.role.findFirst.mockResolvedValueOnce(null);
      db.role.create.mockResolvedValueOnce({ id: 'role-owner', name: 'OWNER' });
      db.organizationMember.create.mockResolvedValueOnce({ id: 'member-1' });
      db.plan.findUnique.mockResolvedValueOnce({ id: 'plan-free', code: 'FREE' });

      const result = await service.createOrganization('user-1', {
        name: 'My Store',
        email: 'store@example.com',
      } as any);

      expect(db.organization.create).toHaveBeenCalled();
      expect(ledgerService.provisionSystemAccounts).toHaveBeenCalledWith(orgId, db);
      expect(db.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: orgId,
            planId: 'plan-free',
            status: 'ACTIVE',
            billingCycle: 'MONTHLY',
          }),
        }),
      );
      expect(result.id).toBe(orgId);
    });
  });

  describe('addMember (Staff Quota Enforcement)', () => {
    const orgId = 'org-1';

    it('should enforce STAFF quota and add active member successfully', async () => {
      db.organizationMember.findUnique.mockResolvedValueOnce(null);
      db.role.findFirst.mockResolvedValueOnce({ id: 'role-staff', name: 'STAFF' });
      db.organizationMember.create.mockResolvedValueOnce({
        id: 'member-new',
        organizationId: orgId,
        userId: 'user-new',
        roleId: 'role-staff',
        status: MemberStatus.ACTIVE,
      });

      const member = await service.addMember(orgId, 'user-new', 'role-staff');

      expect(subscriptionLimitService.enforceQuota).toHaveBeenCalledWith(
        orgId,
        QuotaResourceType.STAFF,
        db,
      );
      expect(db.organizationMember.create).toHaveBeenCalled();
      expect(member.id).toBe('member-new');
    });

    it('should fail with ForbiddenException when STAFF quota is exceeded', async () => {
      subscriptionLimitService.enforceQuota.mockRejectedValueOnce(
        new ForbiddenException("Staff member limit reached (2/2) for plan 'Free Plan'"),
      );

      await expect(
        service.addMember(orgId, 'user-new', 'role-staff'),
      ).rejects.toThrow(ForbiddenException);

      expect(db.organizationMember.create).not.toHaveBeenCalled();
    });

    it('should reject if user is already an active member of the organization', async () => {
      db.organizationMember.findUnique.mockResolvedValueOnce({
        id: 'member-existing',
        status: MemberStatus.ACTIVE,
      });

      await expect(
        service.addMember(orgId, 'user-existing', 'role-staff'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
