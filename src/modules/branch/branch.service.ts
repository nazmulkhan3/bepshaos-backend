import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import type { Prisma } from '@prisma/client';
import { CreateBranchDto } from './dto/create-branch.dto.js';
import { UpdateBranchDto } from './dto/update-branch.dto.js';
import { PageOptionsDto, PageMetaDto, PageDto } from '../../common/dtos/pagination.dto.js';
import { BranchStatus } from '@prisma/client';
import { SubscriptionLimitService } from '../subscription/services/subscription-limit.service.js';
import { QuotaResourceType } from '../subscription/interfaces/plan-limits.interface.js';

@Injectable()
export class BranchService {
  constructor(
    private prisma: DatabaseService,
    private readonly subscriptionLimitService: SubscriptionLimitService,
  ) {}

  async create(organizationId: string, createBranchDto: CreateBranchDto) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Enforce SaaS Branch limit under Level-1 Organization row lock
      await this.subscriptionLimitService.enforceQuota(
        organizationId,
        QuotaResourceType.BRANCH,
        tx,
      );

      const existing = await tx.branch.findUnique({
        where: {
          organizationId_code: {
            organizationId,
            code: createBranchDto.code,
          },
        },
      });

      if (existing) {
        throw new ConflictException(`Branch code ${createBranchDto.code} already exists in this organization`);
      }

      // Check if it's the first branch, if so make it default
      const count = await tx.branch.count({ where: { organizationId } });
      if (count === 0) {
        createBranchDto.isDefault = true;
      }

      if (createBranchDto.isDefault) {
        await tx.branch.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.branch.create({
        data: {
          organizationId,
          ...createBranchDto,
        },
      });
    });
  }

  async findAll(organizationId: string, pageOptionsDto: PageOptionsDto) {
    const skip = pageOptionsDto.skip;
    const take = pageOptionsDto.limit;

    const [items, itemCount] = await Promise.all([
      this.prisma.branch.findMany({
        where: { organizationId },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.branch.count({
        where: { organizationId },
      }),
    ]);

    const pageMetaDto = new PageMetaDto({ itemCount, pageOptionsDto });
    return new PageDto(items, pageMetaDto);
  }

  async findOne(organizationId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  async update(organizationId: string, branchId: string, updateBranchDto: UpdateBranchDto) {
    const branch = await this.findOne(organizationId, branchId);

    if (updateBranchDto.code && updateBranchDto.code !== branch.code) {
      const existing = await this.prisma.branch.findUnique({
        where: {
          organizationId_code: {
            organizationId,
            code: updateBranchDto.code,
          },
        },
      });

      if (existing) {
        throw new ConflictException(`Branch code ${updateBranchDto.code} already exists in this organization`);
      }
    }

    if (updateBranchDto.isDefault && !branch.isDefault) {
      // Using transaction to set this branch as the ONLY default
      return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.branch.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });

        return tx.branch.update({
          where: { id: branchId },
          data: updateBranchDto,
        });
      });
    }

    if (updateBranchDto.isDefault === false && branch.isDefault) {
      throw new BadRequestException('Cannot unset the default branch directly. Set another branch as default instead.');
    }

    return this.prisma.branch.update({
      where: { id: branchId },
      data: updateBranchDto,
    });
  }

  async archive(organizationId: string, branchId: string) {
    const branch = await this.findOne(organizationId, branchId);

    if (branch.isDefault) {
      throw new BadRequestException('Cannot archive the default branch. Set another branch as default first.');
    }

    return this.prisma.branch.update({
      where: { id: branchId },
      data: { status: BranchStatus.INACTIVE },
    });
  }
}
