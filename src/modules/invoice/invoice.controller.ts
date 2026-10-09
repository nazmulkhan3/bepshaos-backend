import { Controller, Post, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { InvoiceService } from './invoice.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@Controller('v1/organizations/:organizationId/invoices')
@UseGuards(TenantGuard, PermissionGuard)
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  @RequirePermissions('invoice:create')
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: CreateInvoiceDto,
  ) {
    const data = await this.invoiceService.create(ctx.organizationId, ctx.userId, dto);
    return { success: true, data };
  }

  @Get()
  @RequirePermissions('invoice:read')
  async findAll(@CurrentOrganization() ctx: OrganizationContext) {
    const data = await this.invoiceService.findAll(ctx.organizationId);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermissions('invoice:read')
  async findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    const data = await this.invoiceService.findOne(ctx.organizationId, id);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermissions('invoice:update')
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    const data = await this.invoiceService.update(ctx.organizationId, ctx.userId, id, dto);
    return { success: true, data };
  }
}
