import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { PlanService } from '../subscription/services/plan.service.js';
import {
  AdminOrganizationQueryDto,
  AdminUpdateOrganizationDto,
  AdminOverrideSubscriptionDto,
} from './dto/admin.dto.js';
import { CreatePlanDto, UpdatePlanDto } from '../subscription/dto/plan.dto.js';
import { Prisma, OrganizationStatus, SubscriptionStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly auditLogService: AuditLogService,
    private readonly planService: PlanService,
  ) {}

  /**
   * Platform Admin: List organizations across the platform with metrics
   */
  async listOrganizations(query: AdminOrganizationQueryDto) {
    const limit = Math.min(query.limit || 50, 100);
    const offset = query.offset || 0;

    const where: Prisma.OrganizationWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { slug: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, organizations] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          business: {
            select: { name: true, phone: true, email: true },
          },
          subscriptions: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: { plan: true },
          },
          _count: {
            select: {
              members: true,
              branches: true,
              products: true,
              sales: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      data: organizations.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        hasUsedTrial: org.hasUsedTrial,
        createdAt: org.createdAt,
        business: org.business,
        currentSubscription: org.subscriptions[0] || null,
        counts: org._count,
      })),
    };
  }

  /**
   * Platform Admin: Get organization full details
   */
  async getOrganizationDetails(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        business: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          include: { plan: true },
        },
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true } },
            role: true,
          },
        },
        branches: true,
        _count: {
          select: {
            products: true,
            sales: true,
            invoices: true,
          },
        },
      },
    });

    if (!org) {
      throw new NotFoundException(`Organization '${organizationId}' not found`);
    }

    return org;
  }

  /**
   * Platform Admin: Update organization status or name (with Audit Logging)
   */
  async updateOrganization(
    organizationId: string,
    dto: AdminUpdateOrganizationDto,
    adminUserId: string,
  ) {
    const current = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!current) {
      throw new NotFoundException(`Organization '${organizationId}' not found`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.organization.update({
        where: { id: organizationId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.status !== undefined && { status: dto.status }),
        },
      });

      await this.auditLogService.logAction(
        {
          action: 'ADMIN_UPDATE_ORGANIZATION',
          entity: 'Organization',
          entityId: organizationId,
          organizationId,
          userId: adminUserId,
          oldData: { name: current.name, status: current.status },
          newData: { name: res.name, status: res.status },
        },
        tx,
      );

      return res;
    });

    return updated;
  }

  /**
   * Platform Admin: Override tenant subscription plan, status, or validity period
   */
  async overrideSubscription(
    organizationId: string,
    dto: AdminOverrideSubscriptionDto,
    adminUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Lock organization row
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM "Organization" WHERE id = ${organizationId} FOR UPDATE
      `;

      if (!rows || rows.length === 0) {
        throw new NotFoundException(`Organization '${organizationId}' not found`);
      }

      // 2. Fetch current subscription
      const currentSub = await tx.subscription.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      });

      if (!currentSub) {
        throw new NotFoundException(`No subscription found for organization '${organizationId}'`);
      }

      let newPlanId = currentSub.planId;
      if (dto.planCode) {
        const targetPlan = await tx.plan.findUnique({
          where: { code: dto.planCode.toUpperCase() },
        });
        if (!targetPlan) {
          throw new NotFoundException(`Plan with code '${dto.planCode}' not found`);
        }
        newPlanId = targetPlan.id;
      }

      const updateData: Prisma.SubscriptionUpdateInput = {
        ...(dto.planCode && { plan: { connect: { id: newPlanId } } }),
        ...(dto.status && { status: dto.status }),
        ...(dto.currentPeriodEnd && { currentPeriodEnd: new Date(dto.currentPeriodEnd) }),
      };

      const updated = await tx.subscription.update({
        where: { id: currentSub.id },
        data: updateData,
        include: { plan: true },
      });

      // 3. Record Audit Log
      await this.auditLogService.logAction(
        {
          action: 'ADMIN_OVERRIDE_SUBSCRIPTION',
          entity: 'Subscription',
          entityId: currentSub.id,
          organizationId,
          userId: adminUserId,
          oldData: {
            planCode: currentSub.plan.code,
            status: currentSub.status,
            currentPeriodEnd: currentSub.currentPeriodEnd,
          },
          newData: {
            planCode: updated.plan.code,
            status: updated.status,
            currentPeriodEnd: updated.currentPeriodEnd,
            reason: dto.reason || null,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Platform Admin: Manage Plans (Create, Update, List)
   */
  async createPlan(dto: CreatePlanDto, adminUserId: string) {
    const plan = await this.planService.createPlan(dto);

    await this.auditLogService.logAction({
      action: 'ADMIN_CREATE_PLAN',
      entity: 'Plan',
      entityId: plan.id,
      userId: adminUserId,
      newData: dto,
    });

    return plan;
  }

  async updatePlan(id: string, dto: UpdatePlanDto, adminUserId: string) {
    const existing = await this.planService.getPlanById(id);
    if (!existing) {
      throw new NotFoundException(`Plan '${id}' not found`);
    }

    const updated = await this.planService.updatePlan(id, dto);

    await this.auditLogService.logAction({
      action: 'ADMIN_UPDATE_PLAN',
      entity: 'Plan',
      entityId: id,
      userId: adminUserId,
      oldData: existing,
      newData: updated,
    });

    return updated;
  }

  async getAllPlans() {
    return this.planService.getAllPlans();
  }
}
