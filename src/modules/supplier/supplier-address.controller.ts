import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SupplierAddressService } from './supplier-address.service.js';
import { CreateSupplierAddressDto } from './dto/create-supplier-address.dto.js';
import { UpdateSupplierAddressDto } from './dto/update-supplier-address.dto.js';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Supplier Addresses')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId/suppliers/:supplierId/addresses', version: '1' })
export class SupplierAddressController {
  constructor(private readonly supplierAddressService: SupplierAddressService) {}

  @Post()
  @RequirePermissions('supplier:create')
  @ApiOperation({ summary: 'Add an address to a supplier' })
  @ApiResponse({ status: 201, description: 'The address has been successfully created.' })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('supplierId') supplierId: string,
    @Body() createSupplierAddressDto: CreateSupplierAddressDto,
  ) {
    const data = await this.supplierAddressService.create(ctx.organizationId, supplierId, createSupplierAddressDto, ctx.userId);
    return { success: true, data };
  }

  @Get()
  @RequirePermissions('supplier:read')
  @ApiOperation({ summary: 'Get all addresses for a supplier' })
  @ApiResponse({ status: 200, description: 'Return all addresses for the supplier.' })
  async findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('supplierId') supplierId: string,
  ) {
    const data = await this.supplierAddressService.findAll(ctx.organizationId, supplierId);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermissions('supplier:read')
  @ApiOperation({ summary: 'Get a specific address for a supplier' })
  @ApiResponse({ status: 200, description: 'Return the address.' })
  @ApiResponse({ status: 404, description: 'Address not found.' })
  async findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
  ) {
    const data = await this.supplierAddressService.findOne(ctx.organizationId, supplierId, id);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermissions('supplier:update')
  @ApiOperation({ summary: 'Update a supplier address' })
  @ApiResponse({ status: 200, description: 'The address has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Address not found.' })
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @Body() updateSupplierAddressDto: UpdateSupplierAddressDto,
  ) {
    const data = await this.supplierAddressService.update(ctx.organizationId, supplierId, id, updateSupplierAddressDto, ctx.userId);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermissions('supplier:update')
  @ApiOperation({ summary: 'Delete a supplier address' })
  @ApiResponse({ status: 200, description: 'The address has been successfully deleted.' })
  @ApiResponse({ status: 404, description: 'Address not found.' })
  async remove(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
  ) {
    const data = await this.supplierAddressService.remove(ctx.organizationId, supplierId, id, ctx.userId);
    return { success: true, data };
  }
}
