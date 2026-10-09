import { Injectable, ConflictException, NotFoundException, ForbiddenException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { MemberStatus, OrganizationStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { LedgerService } from '../ledger/ledger.service.js';
import { SubscriptionLimitService } from '../subscription/services/subscription-limit.service.js';
import { QuotaResourceType } from '../subscription/interfaces/plan-limits.interface.js';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly ledgerService: LedgerService,
    private readonly subscriptionLimitService: SubscriptionLimitService,
  ) {}

  private generateSlug(name: string): string {
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    const suffix = randomBytes(3).toString('hex');
    return `${baseSlug}-${suffix}`;
  }

  async createOrganization(userId: string, dto: CreateOrganizationDto) {
    const slug = this.generateSlug(dto.name);

    try {
      return await this.prisma.$transaction(async (tx: any) => {
        // 1. Create Organization
        const organization = await tx.organization.create({
          data: {
            ...dto,
            slug,
          },
        });

        // 2. Ensure OWNER role exists for this organization
        // (Using an organization-specific OWNER role as it allows per-org customization later)
        let ownerRole = await tx.role.findFirst({
          where: {
            organizationId: organization.id,
            name: 'OWNER',
          },
        });

        if (!ownerRole) {
          ownerRole = await tx.role.create({
            data: {
              organizationId: organization.id,
              name: 'OWNER',
            },
          });
        }

        // 3. Create OrganizationMember
        const member = await tx.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId,
            roleId: ownerRole.id,
            status: MemberStatus.ACTIVE,
          },
        });

        // 4. Provision system chart-of-accounts (Phase 15)
        await this.ledgerService.provisionSystemAccounts(organization.id, tx);

        // 5. Provision canonical Free SaaS Subscription (Phase 20)
        const freePlan = await tx.plan.findUnique({
          where: { code: 'FREE' },
        });

        if (freePlan) {
          const now = new Date();
          const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
          const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

          await tx.subscription.create({
            data: {
              organizationId: organization.id,
              planId: freePlan.id,
              status: 'ACTIVE',
              billingCycle: 'MONTHLY',
              currentPeriodStart: start,
              currentPeriodEnd: end,
              provider: 'INTERNAL_SYSTEM',
            },
          });
        }

        return organization;
      });
    } catch (error: any) {
      console.error('Prisma Error in createOrganization:', error);
      if (error.code === 'P2002' && error.meta?.target?.includes('slug')) {
        throw new ConflictException('An organization with a similar name already exists, please try again');
      }
      throw new InternalServerErrorException('Failed to create organization');
    }
  }

  async findMyOrganizations(userId: string) {
    return this.prisma.organization.findMany({
      where: {
        members: {
          some: {
            userId,
            status: MemberStatus.ACTIVE,
          },
        },
        status: OrganizationStatus.ACTIVE,
      },
      include: {
        members: {
          where: { userId },
          select: { role: true, status: true, joinedAt: true },
        },
      },
    });
  }

  async findOrganizationById(userId: string, organizationId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        id: organizationId,
        members: {
          some: {
            userId,
            status: MemberStatus.ACTIVE,
          },
        },
        status: OrganizationStatus.ACTIVE,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found or access denied');
    }

    return organization;
  }

  async updateOrganization(organizationId: string, dto: UpdateOrganizationDto) {

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return this.prisma.organization.update({
      where: { id: organizationId },
      data: dto,
    });
  }

  async findOrganizationMembers(organizationId: string) {

    return this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, avatar: true },
        },
        role: true,
      },
    });
  }

  async assignRole(organizationId: string, memberId: string, roleId: string) {
    // 1. Check if the target member exists in this organization
    const member = await this.prisma.organizationMember.findUnique({
      where: { id: memberId },
      include: { role: true },
    });

    if (!member || member.organizationId !== organizationId) {
      throw new NotFoundException('Member not found in this organization');
    }

    // 2. Check if the target role exists and belongs to this organization (or is a system role)
    const newRole = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        OR: [{ organizationId: null }, { organizationId }],
      },
    });

    if (!newRole) {
      throw new BadRequestException('Invalid role specified');
    }

    if (member.roleId === roleId) {
      return member; // No change needed
    }

    // 3. Owner Protection: If the member is currently an OWNER, and we are changing their role,
    // we must ensure there is at least one other OWNER left.
    if (member.role.name === 'OWNER') {
      const ownerCount = await this.prisma.organizationMember.count({
        where: {
          organizationId,
          role: { name: 'OWNER' },
          status: MemberStatus.ACTIVE,
        },
      });

      if (ownerCount <= 1) {
        throw new ForbiddenException('Cannot change the role of the last active owner of the organization');
      }
    }

    // 4. Update the role
    return this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { roleId },
      include: {
        role: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async addMember(organizationId: string, userId: string, roleId: string) {
    return this.prisma.$transaction(async (tx: any) => {
      // 1. Enforce SaaS Staff limit under Level-1 Organization row lock
      await this.subscriptionLimitService.enforceQuota(
        organizationId,
        QuotaResourceType.STAFF,
        tx,
      );

      // 2. Check if user already exists in organization
      const existing = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
      });

      if (existing) {
        if (existing.status === MemberStatus.ACTIVE) {
          throw new ConflictException('User is already an active member of this organization');
        }
        // Reactivate inactive member
        return tx.organizationMember.update({
          where: { id: existing.id },
          data: { status: MemberStatus.ACTIVE, roleId },
          include: { role: true, user: { select: { id: true, name: true, email: true } } },
        });
      }

      // 3. Verify target role exists
      const role = await tx.role.findFirst({
        where: {
          id: roleId,
          OR: [{ organizationId: null }, { organizationId }],
        },
      });

      if (!role) {
        throw new BadRequestException('Invalid role specified');
      }

      return tx.organizationMember.create({
        data: {
          organizationId,
          userId,
          roleId,
          status: MemberStatus.ACTIVE,
        },
        include: {
          role: true,
          user: { select: { id: true, name: true, email: true } },
        },
      });
    });
  }
}
