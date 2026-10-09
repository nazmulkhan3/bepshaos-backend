import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BranchService } from './branch.service.js';
import { CreateBranchDto } from './dto/create-branch.dto.js';
import { UpdateBranchDto } from './dto/update-branch.dto.js';
import { PageOptionsDto } from '../../common/dtos/pagination.dto.js';
// removed JwtAuthGuard
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Branches')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId/branches', version: '1' })
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post()
  @RequirePermissions('branch:create')
  @ApiOperation({ summary: 'Create a new branch' })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() createBranchDto: CreateBranchDto,
  ) {
    const data = await this.branchService.create(ctx.organizationId, createBranchDto);
    return { success: true, data };
  }

  @Get()
  @RequirePermissions('branch:read')
  @ApiOperation({ summary: 'List branches' })
  async findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() pageOptionsDto: PageOptionsDto,
  ) {
    const data = await this.branchService.findAll(ctx.organizationId, pageOptionsDto);
    return { success: true, ...data };
  }

  @Get(':branchId')
  @RequirePermissions('branch:read')
  @ApiOperation({ summary: 'Get branch details' })
  async findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('branchId') branchId: string,
  ) {
    const data = await this.branchService.findOne(ctx.organizationId, branchId);
    return { success: true, data };
  }

  @Patch(':branchId')
  @RequirePermissions('branch:update')
  @ApiOperation({ summary: 'Update branch details' })
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('branchId') branchId: string,
    @Body() updateBranchDto: UpdateBranchDto,
  ) {
    const data = await this.branchService.update(ctx.organizationId, branchId, updateBranchDto);
    return { success: true, data };
  }

  @Delete(':branchId')
  @RequirePermissions('branch:archive')
  @ApiOperation({ summary: 'Archive a branch' })
  async archive(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('branchId') branchId: string,
  ) {
    const data = await this.branchService.archive(ctx.organizationId, branchId);
    return { success: true, data };
  }
}
