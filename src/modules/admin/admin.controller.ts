import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import {
  AdminOrganizationQueryDto,
  AdminUpdateOrganizationDto,
  AdminOverrideSubscriptionDto,
  AdminAuditLogQueryDto,
} from './dto/admin.dto.js';
import { CreatePlanDto, UpdatePlanDto } from '../subscription/dto/plan.dto.js';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard.js';

@ApiTags('Platform Admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
@UseGuards(PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ==================== ORGANIZATIONS ====================

  @Get('organizations')
  @ApiOperation({ summary: 'List all organizations across the platform (Platform Admin only)' })
  @ApiResponse({ status: 200, description: 'List of organizations with metrics' })
  async listOrganizations(@Query() query: AdminOrganizationQueryDto) {
    const result = await this.adminService.listOrganizations(query);
    return {
      success: true,
      ...result,
    };
  }

  @Get('organizations/:organizationId')
  @ApiOperation({ summary: 'Get full details of an organization (Platform Admin only)' })
  @ApiResponse({ status: 200, description: 'Organization details' })
  async getOrganizationDetails(@Param('organizationId') organizationId: string) {
    const org = await this.adminService.getOrganizationDetails(organizationId);
    return {
      success: true,
      data: org,
    };
  }

  @Patch('organizations/:organizationId')
  @ApiOperation({ summary: 'Update organization status or details (Platform Admin only)' })
  @ApiResponse({ status: 200, description: 'Organization updated' })
  async updateOrganization(
    @Param('organizationId') organizationId: string,
    @Body() dto: AdminUpdateOrganizationDto,
    @Req() req: any,
  ) {
    const adminUserId = req.user?.sub;
    const org = await this.adminService.updateOrganization(organizationId, dto, adminUserId);
    return {
      success: true,
      data: org,
    };
  }

  // ==================== SUBSCRIPTIONS ====================

  @Patch('organizations/:organizationId/subscription/override')
  @ApiOperation({ summary: 'Override an organization subscription plan or status (Platform Admin only)' })
  @ApiResponse({ status: 200, description: 'Subscription updated' })
  async overrideSubscription(
    @Param('organizationId') organizationId: string,
    @Body() dto: AdminOverrideSubscriptionDto,
    @Req() req: any,
  ) {
    const adminUserId = req.user?.sub;
    const sub = await this.adminService.overrideSubscription(organizationId, dto, adminUserId);
    return {
      success: true,
      data: sub,
    };
  }

  // ==================== PLANS ====================

  @Get('plans')
  @ApiOperation({ summary: 'List all plans including unpublished (Platform Admin only)' })
  @ApiResponse({ status: 200, description: 'List of plans' })
  async getAllPlans() {
    const plans = await this.adminService.getAllPlans();
    return {
      success: true,
      data: plans,
    };
  }

  @Post('plans')
  @ApiOperation({ summary: 'Create a new subscription plan (Platform Admin only)' })
  @ApiResponse({ status: 201, description: 'Plan created' })
  async createPlan(@Body() dto: CreatePlanDto, @Req() req: any) {
    const adminUserId = req.user?.sub;
    const plan = await this.adminService.createPlan(dto, adminUserId);
    return {
      success: true,
      data: plan,
    };
  }

  @Patch('plans/:planId')
  @ApiOperation({ summary: 'Update an existing subscription plan (Platform Admin only)' })
  @ApiResponse({ status: 200, description: 'Plan updated' })
  async updatePlan(
    @Param('planId') planId: string,
    @Body() dto: UpdatePlanDto,
    @Req() req: any,
  ) {
    const adminUserId = req.user?.sub;
    const plan = await this.adminService.updatePlan(planId, dto, adminUserId);
    return {
      success: true,
      data: plan,
    };
  }

  // ==================== AUDIT LOGS ====================

  @Get('audit-logs')
  @ApiOperation({ summary: 'Query system-wide audit logs (Platform Admin only)' })
  @ApiResponse({ status: 200, description: 'List of audit logs' })
  async queryAuditLogs(@Query() query: AdminAuditLogQueryDto) {
    const result = await this.auditLogService.queryLogs(query);
    return {
      success: true,
      ...result,
    };
  }
}
