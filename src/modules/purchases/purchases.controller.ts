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
import { PurchasesService } from './purchases.service.js';
import { CreatePurchaseDto, PurchaseQueryDto, CancelPurchaseDto } from './dto/index.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Purchases')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId/purchases', version: '1' })
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('purchase:create')
  @ApiOperation({ summary: 'Create a new purchase' })
  @ApiResponse({ status: 201, description: 'Purchase successfully created.' })
  @ApiResponse({ status: 400, description: 'Invalid input.' })
  @ApiResponse({ status: 409, description: 'Conflict on idempotency key or purchase number.' })
  create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() createPurchaseDto: CreatePurchaseDto,
  ) {
    return this.purchasesService.create(ctx, createPurchaseDto);
  }

  @Get()
  @RequirePermissions('purchase:read')
  @ApiOperation({ summary: 'List all purchases' })
  @ApiResponse({ status: 200, description: 'Return paginated purchases.' })
  findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() queryDto: PurchaseQueryDto,
  ) {
    return this.purchasesService.findAll(ctx, queryDto);
  }

  @Get(':id')
  @RequirePermissions('purchase:read')
  @ApiOperation({ summary: 'Get purchase details' })
  @ApiResponse({ status: 200, description: 'Return purchase details.' })
  @ApiResponse({ status: 404, description: 'Purchase not found.' })
  findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.purchasesService.findOne(ctx, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase:cancel')
  @ApiOperation({ summary: 'Cancel a purchase' })
  @ApiResponse({ status: 200, description: 'Purchase successfully cancelled (or already cancelled).' })
  @ApiResponse({ status: 400, description: 'Cannot cancel purchase.' })
  @ApiResponse({ status: 404, description: 'Purchase not found.' })
  cancel(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
    @Body() cancelPurchaseDto: CancelPurchaseDto,
  ) {
    return this.purchasesService.cancel(ctx, id, cancelPurchaseDto);
  }
}
