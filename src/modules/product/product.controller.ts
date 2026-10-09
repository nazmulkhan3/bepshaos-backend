import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductService } from './product.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductQueryDto } from './dto/product-query.dto.js';

import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller('v1/products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @RequirePermissions('product:create')
  @ApiOperation({ summary: 'Create a new product' })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() createProductDto: CreateProductDto,
  ) {
    return this.productService.create(ctx.organizationId, createProductDto, ctx.userId);
  }

  @Get()
  @RequirePermissions('product:read')
  @ApiOperation({ summary: 'Get all products' })
  async findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() query: ProductQueryDto,
  ) {
    return this.productService.findAll(ctx.organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('product:read')
  @ApiOperation({ summary: 'Get a single product by ID' })
  async findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.productService.findOne(ctx.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('product:update')
  @ApiOperation({ summary: 'Update a product' })
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productService.update(ctx.organizationId, id, updateProductDto, ctx.userId);
  }

  @Delete(':id/archive')
  @RequirePermissions('product:archive')
  @ApiOperation({ summary: 'Archive a product' })
  async archive(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.productService.archive(ctx.organizationId, id, ctx.userId);
  }

  @Post(':id/restore')
  @RequirePermissions('product:update')
  @ApiOperation({ summary: 'Restore an archived product' })
  async restore(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.productService.restore(ctx.organizationId, id, ctx.userId);
  }
}
