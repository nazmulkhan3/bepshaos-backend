import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { SupplierService } from './supplier.service.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { SupplierQueryDto } from './dto/supplier-query.dto.js';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Suppliers')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId/suppliers', version: '1' })
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  @RequirePermissions('supplier:create')
  @ApiOperation({ summary: 'Create a new supplier' })
  @ApiResponse({ status: 201, description: 'The supplier has been successfully created.' })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() createSupplierDto: CreateSupplierDto,
  ) {
    const data = await this.supplierService.create(ctx.organizationId, createSupplierDto, ctx.userId);
    return { success: true, data };
  }

  @Get()
  @RequirePermissions('supplier:read')
  @ApiOperation({ summary: 'Get all suppliers' })
  @ApiResponse({ status: 200, description: 'Return all suppliers.' })
  async findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() query: SupplierQueryDto,
  ) {
    const result = await this.supplierService.findAll(ctx.organizationId, query);
    return { success: true, ...result };
  }

  @Get(':id')
  @RequirePermissions('supplier:read')
  @ApiOperation({ summary: 'Get a supplier by id' })
  @ApiResponse({ status: 200, description: 'Return the supplier.' })
  @ApiResponse({ status: 404, description: 'Supplier not found.' })
  async findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    const data = await this.supplierService.findOne(ctx.organizationId, id);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermissions('supplier:update')
  @ApiOperation({ summary: 'Update a supplier' })
  @ApiResponse({ status: 200, description: 'The supplier has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Supplier not found.' })
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
  ) {
    const data = await this.supplierService.update(ctx.organizationId, id, updateSupplierDto, ctx.userId);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermissions('supplier:archive')
  @ApiOperation({ summary: 'Archive a supplier' })
  @ApiResponse({ status: 200, description: 'The supplier has been successfully archived.' })
  @ApiResponse({ status: 404, description: 'Supplier not found.' })
  async archive(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    const data = await this.supplierService.archive(ctx.organizationId, id, ctx.userId);
    return { success: true, data };
  }

  @Post(':id/restore')
  @RequirePermissions('supplier:update')
  @ApiOperation({ summary: 'Restore an archived supplier' })
  @ApiResponse({ status: 200, description: 'The supplier has been successfully restored.' })
  @ApiResponse({ status: 404, description: 'Supplier not found.' })
  @ApiResponse({ status: 409, description: 'Supplier is not archived.' })
  async restore(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    const data = await this.supplierService.restore(ctx.organizationId, id, ctx.userId);
    return { success: true, data };
  }
}
