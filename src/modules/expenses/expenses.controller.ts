import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ExpensesService } from './expenses.service.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { QueryExpenseDto } from './dto/query-expense.dto.js';
import { CreateExpenseCategoryDto } from './dto/create-category.dto.js';
import { UpdateExpenseCategoryDto } from './dto/update-category.dto.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@Controller({ path: 'organizations/:organizationId/expenses', version: '1' })
@UseGuards(TenantGuard, PermissionGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CATEGORIES
  // ─────────────────────────────────────────────────────────────────────────

  @Post('categories')
  @RequirePermissions('expense-category:create')
  async createCategory(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() createCategoryDto: CreateExpenseCategoryDto,
  ) {
    return this.expensesService.createCategory(ctx.organizationId, createCategoryDto);
  }

  @Get('categories')
  @RequirePermissions('expense-category:read')
  async findAllCategories(@CurrentOrganization() ctx: OrganizationContext) {
    return this.expensesService.findAllCategories(ctx.organizationId);
  }

  @Get('categories/:id')
  @RequirePermissions('expense-category:read')
  async getCategoryById(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.expensesService.getCategoryById(ctx.organizationId, id);
  }

  @Patch('categories/:id')
  @RequirePermissions('expense-category:update')
  async updateCategory(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateExpenseCategoryDto,
  ) {
    return this.expensesService.updateCategory(ctx.organizationId, id, updateCategoryDto);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPENSES
  // ─────────────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('expense:create')
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() createExpenseDto: CreateExpenseDto,
  ) {
    return this.expensesService.createExpense(ctx.organizationId, ctx.userId, createExpenseDto);
  }

  @Get()
  @RequirePermissions('expense:read')
  async findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() queryDto: QueryExpenseDto,
  ) {
    return this.expensesService.findAllExpenses(ctx.organizationId, queryDto);
  }

  @Get(':id')
  @RequirePermissions('expense:read')
  async findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.expensesService.getExpenseById(ctx.organizationId, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('expense:cancel')
  async cancel(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') id: string,
  ) {
    return this.expensesService.cancelExpense(ctx.organizationId, id, ctx.userId);
  }
}
