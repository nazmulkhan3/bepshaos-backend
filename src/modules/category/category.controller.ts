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
import { CategoryService } from './category.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { CategoryQueryDto } from './dto/category-query.dto.js';

import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Categories')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller('v1/categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  @RequirePermissions('category:create')
  @ApiOperation({ summary: 'Create a new category' })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoryService.create(ctx.organizationId, createCategoryDto, ctx.userId);
  }

  @Get()
  @RequirePermissions('category:read')
  @ApiOperation({ summary: 'Get all categories' })
  async findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() query: CategoryQueryDto,
  ) {
    return this.categoryService.findAll(ctx.organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('category:read')
  @ApiOperation({ summary: 'Get a single category by ID' })
  async findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.categoryService.findOne(ctx.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('category:update')
  @ApiOperation({ summary: 'Update a category' })
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoryService.update(ctx.organizationId, id, updateCategoryDto, ctx.userId);
  }

  @Delete(':id/archive')
  @RequirePermissions('category:archive')
  @ApiOperation({ summary: 'Archive a category' })
  async archive(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.categoryService.archive(ctx.organizationId, id, ctx.userId);
  }

  @Post(':id/restore')
  @RequirePermissions('category:update')
  @ApiOperation({ summary: 'Restore an archived category' })
  async restore(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.categoryService.restore(ctx.organizationId, id, ctx.userId);
  }
}
