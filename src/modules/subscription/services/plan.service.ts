import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import { CreatePlanDto, UpdatePlanDto } from '../dto/plan.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(private readonly prisma: DatabaseService) {}

  /**
   * List all publicly visible and active plans (for pricing table / upgrade UI)
   */
  async getPublicPlans() {
    return this.prisma.plan.findMany({
      where: {
        isActive: true,
        isPublic: true,
      },
      orderBy: {
        sortOrder: 'asc',
      },
    });
  }

  /**
   * Get plan by code (e.g. 'FREE', 'STARTER', 'PRO')
   */
  async getPlanByCode(code: string) {
    return this.prisma.plan.findUnique({
      where: { code: code.toUpperCase() },
    });
  }

  /**
   * Get plan by ID
   */
  async getPlanById(id: string) {
    return this.prisma.plan.findUnique({
      where: { id },
    });
  }

  /**
   * Admin: List all plans including unpublished/inactive
   */
  async getAllPlans() {
    return this.prisma.plan.findMany({
      orderBy: {
        sortOrder: 'asc',
      },
    });
  }

  /**
   * Admin: Create a new plan
   */
  async createPlan(dto: CreatePlanDto) {
    const data: Prisma.PlanCreateInput = {
      code: dto.code.toUpperCase(),
      name: dto.name,
      description: dto.description,
      isActive: dto.isActive ?? true,
      isPublic: dto.isPublic ?? true,
      sortOrder: dto.sortOrder ?? 0,
      currency: dto.currency || 'BDT',
      price: new Prisma.Decimal(dto.priceMonthly), // preserve legacy price
      priceMonthly: new Prisma.Decimal(dto.priceMonthly),
      priceYearly: new Prisma.Decimal(dto.priceYearly),
      maxBranches: dto.maxBranches,
      maxStaff: dto.maxStaff,
      maxProducts: dto.maxProducts,
      maxTransactions: dto.maxTransactions,
      features: (dto.features as Prisma.InputJsonValue) || {},
    };

    return this.prisma.plan.create({ data });
  }

  /**
   * Admin: Update an existing plan
   */
  async updatePlan(id: string, dto: UpdatePlanDto) {
    const data: Prisma.PlanUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.priceMonthly !== undefined && {
        priceMonthly: new Prisma.Decimal(dto.priceMonthly),
        price: new Prisma.Decimal(dto.priceMonthly),
      }),
      ...(dto.priceYearly !== undefined && { priceYearly: new Prisma.Decimal(dto.priceYearly) }),
      ...(dto.maxBranches !== undefined && { maxBranches: dto.maxBranches }),
      ...(dto.maxStaff !== undefined && { maxStaff: dto.maxStaff }),
      ...(dto.maxProducts !== undefined && { maxProducts: dto.maxProducts }),
      ...(dto.maxTransactions !== undefined && { maxTransactions: dto.maxTransactions }),
      ...(dto.features !== undefined && { features: dto.features as Prisma.InputJsonValue }),
    };

    return this.prisma.plan.update({
      where: { id },
      data,
    });
  }
}
