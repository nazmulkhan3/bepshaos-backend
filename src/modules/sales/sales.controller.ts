import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { SalesService } from './sales.service.js';
import { CreateSaleDto, SaleQueryDto, CancelSaleDto } from './dto/index.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Sales')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId/sales', version: '1' })
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('sale:create')
  @ApiOperation({ summary: 'Create a new sale (POS transaction)' })
  @ApiResponse({ status: 201, description: 'Sale created successfully and stock deducted' })
  @ApiResponse({ status: 409, description: 'Insufficient stock or idempotency conflict' })
  create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: CreateSaleDto,
  ) {
    return this.salesService.create(ctx.organizationId, ctx.userId, dto);
  }

  @Get()
  @RequirePermissions('sale:read')
  @ApiOperation({ summary: 'List sales with search, filters, and pagination' })
  findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() query: SaleQueryDto,
  ) {
    return this.salesService.findAll(ctx.organizationId, query);
  }

  @Get(':saleId')
  @RequirePermissions('sale:read')
  @ApiOperation({ summary: 'Get sale details by ID' })
  @ApiResponse({ status: 200, description: 'Sale details retrieved' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('saleId') saleId: string,
  ) {
    return this.salesService.findOne(ctx.organizationId, saleId);
  }

  @Post(':saleId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sale:cancel')
  @ApiOperation({ summary: 'Cancel a completed sale and restore stock' })
  @ApiResponse({ status: 200, description: 'Sale cancelled and stock restored' })
  @ApiResponse({ status: 409, description: 'Sale cannot be cancelled' })
  cancel(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('saleId') saleId: string,
    @Body() dto?: CancelSaleDto,
  ) {
    return this.salesService.cancel(ctx.organizationId, saleId, ctx.userId, dto);
  }
}
