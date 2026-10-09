import { Controller, Post, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ReceiptService } from './receipt.service.js';
import { CreateReceiptDto } from './dto/create-receipt.dto.js';
import { UpdateReceiptDto } from './dto/update-receipt.dto.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@Controller('v1/organizations/:organizationId/receipts')
@UseGuards(TenantGuard, PermissionGuard)
export class ReceiptController {
  constructor(private readonly receiptService: ReceiptService) {}

  @Post()
  @RequirePermissions('receipt:create')
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: CreateReceiptDto,
  ) {
    const data = await this.receiptService.create(ctx.organizationId, ctx.userId, dto);
    return { success: true, data };
  }

  @Get()
  @RequirePermissions('receipt:read')
  async findAll(@CurrentOrganization() ctx: OrganizationContext) {
    const data = await this.receiptService.findAll(ctx.organizationId);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermissions('receipt:read')
  async findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    const data = await this.receiptService.findOne(ctx.organizationId, id);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermissions('receipt:update')
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
    @Body() dto: UpdateReceiptDto,
  ) {
    const data = await this.receiptService.update(ctx.organizationId, ctx.userId, id, dto);
    return { success: true, data };
  }
}
