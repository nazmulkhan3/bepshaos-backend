import { Controller, Get, Query, UseGuards, Param, ValidationPipe } from '@nestjs/common';
import { ReportService } from './report.service.js';
import { GetReportQueryDto } from './dto/get-report-query.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@Controller({ version: '1', path: 'organizations/:organizationId/reports' })
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@RequirePermissions('REPORT_VIEW')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('sales')
  async getSalesSummary(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ValidationPipe({ transform: true })) query: GetReportQueryDto,
  ) {
    const data = await this.reportService.getSalesSummary(ctx.organizationId, query);
    return { success: true, data };
  }

  @Get('purchases')
  async getPurchasesSummary(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ValidationPipe({ transform: true })) query: GetReportQueryDto,
  ) {
    const data = await this.reportService.getPurchasesSummary(ctx.organizationId, query);
    return { success: true, data };
  }

  @Get('payments')
  async getPaymentsSummary(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ValidationPipe({ transform: true })) query: GetReportQueryDto,
  ) {
    const data = await this.reportService.getPaymentsSummary(ctx.organizationId, query);
    return { success: true, data };
  }

  @Get('expenses')
  async getExpensesSummary(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ValidationPipe({ transform: true })) query: GetReportQueryDto,
  ) {
    const data = await this.reportService.getExpensesSummary(ctx.organizationId, query);
    return { success: true, data };
  }

  @Get('inventory')
  async getInventorySummary(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ValidationPipe({ transform: true })) query: GetReportQueryDto,
  ) {
    const data = await this.reportService.getInventorySummary(ctx.organizationId, query);
    return { success: true, data };
  }

  @Get('outstanding')
  async getOutstandingSummary(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ValidationPipe({ transform: true })) query: GetReportQueryDto,
  ) {
    const data = await this.reportService.getOutstandingSummary(ctx.organizationId, query);
    return { success: true, data };
  }

  @Get('profit-loss')
  async getProfitAndLoss(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ValidationPipe({ transform: true })) query: GetReportQueryDto,
  ) {
    const data = await this.reportService.getProfitAndLoss(ctx.organizationId, query);
    return { success: true, data };
  }

  @Get('dashboard')
  async getDashboard(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ValidationPipe({ transform: true })) query: GetReportQueryDto,
  ) {
    const data = await this.reportService.getDashboard(ctx.organizationId, query);
    return { success: true, data };
  }
}
