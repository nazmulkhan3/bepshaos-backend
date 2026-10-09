import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { InventoryService } from './inventory.service.js';
import { InventoryQueryDto, MovementQueryDto, StockInDto, StockOutDto, StockAdjustDto } from './dto/inventory.dto.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import { UseGuards } from '@nestjs/common';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'List inventory' })
  findAll(@CurrentOrganization() ctx: OrganizationContext, @Query() query: InventoryQueryDto) {
    return this.inventoryService.findAll(ctx.organizationId, query);
  }

  @Get('movements')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'List stock movements' })
  findAllMovements(@CurrentOrganization() ctx: OrganizationContext, @Query() query: MovementQueryDto) {
    return this.inventoryService.findAllMovements(ctx.organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'Get inventory by ID' })
  findOne(@CurrentOrganization() ctx: OrganizationContext, @Param('id') id: string) {
    return this.inventoryService.findOne(ctx.organizationId, id);
  }

  @Post('stock-in')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('inventory:stock-in')
  @ApiOperation({ summary: 'Stock in inventory' })
  stockIn(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: StockInDto,
  ) {
    return this.inventoryService.stockIn(ctx.organizationId, ctx.userId, dto);
  }

  @Post('stock-out')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('inventory:stock-out')
  @ApiOperation({ summary: 'Stock out inventory' })
  stockOut(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: StockOutDto,
  ) {
    return this.inventoryService.stockOut(ctx.organizationId, ctx.userId, dto);
  }

  @Post('adjust')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('inventory:adjust')
  @ApiOperation({ summary: 'Adjust inventory' })
  adjust(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: StockAdjustDto,
  ) {
    return this.inventoryService.adjust(ctx.organizationId, ctx.userId, dto);
  }
}
