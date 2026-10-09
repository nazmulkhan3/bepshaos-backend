import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionService } from '../services/subscription.service.js';
import { SubscriptionLimitService } from '../services/subscription-limit.service.js';
import { ChangePlanDto, CancelSubscriptionDto, StartTrialDto } from '../dto/subscription.dto.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@Controller({ path: 'organizations/:organizationId/subscription', version: '1' })
@UseGuards(TenantGuard, PermissionGuard)
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly limitService: SubscriptionLimitService,
  ) {}

  @Get()
  @RequirePermissions('subscription:read')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Get current organization subscription details and limits' })
  @ApiResponse({ status: 200, description: 'Current subscription and usage details' })
  async getCurrentSubscription(@Param('organizationId') organizationId: string) {
    const data = await this.subscriptionService.getCurrentSubscription(organizationId);
    return {
      success: true,
      data,
    };
  }

  @Get('usage')
  @RequirePermissions('subscription:read')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Get current organization resource usage vs quotas' })
  @ApiResponse({ status: 200, description: 'Current usage metrics' })
  async getUsage(@Param('organizationId') organizationId: string) {
    const data = await this.limitService.getSubscriptionUsage(organizationId);
    return {
      success: true,
      data,
    };
  }

  @Post('trial')
  @RequirePermissions('subscription:update')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Activate a 14-day free trial on a premium plan' })
  @ApiResponse({ status: 201, description: 'Trial activated successfully' })
  async startTrial(
    @Param('organizationId') organizationId: string,
    @Body() dto: StartTrialDto,
  ) {
    const subscription = await this.subscriptionService.startTrial(organizationId, dto);
    return {
      success: true,
      data: subscription,
    };
  }

  @Post('change-plan')
  @RequirePermissions('subscription:update')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Upgrade, downgrade, or switch billing cycle of plan' })
  @ApiResponse({ status: 200, description: 'Plan change processed or invoice generated' })
  async changePlan(
    @Param('organizationId') organizationId: string,
    @Body() dto: ChangePlanDto,
  ) {
    const result = await this.subscriptionService.changePlan(organizationId, dto);
    return {
      success: true,
      data: result,
    };
  }

  @Post('cancel')
  @RequirePermissions('subscription:update')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Cancel current subscription (immediately or at period end)' })
  @ApiResponse({ status: 200, description: 'Subscription cancelled' })
  async cancelSubscription(
    @Param('organizationId') organizationId: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    const result = await this.subscriptionService.cancelSubscription(organizationId, dto);
    return {
      success: true,
      data: result,
    };
  }

  @Post('reactivate')
  @RequirePermissions('subscription:update')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Reactivate a subscription scheduled for period-end cancellation' })
  @ApiResponse({ status: 200, description: 'Subscription reactivated' })
  async reactivateSubscription(@Param('organizationId') organizationId: string) {
    const result = await this.subscriptionService.reactivateSubscription(organizationId);
    return {
      success: true,
      data: result,
    };
  }

  @Get('invoices')
  @RequirePermissions('subscription:read')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'List organization billing history and invoices' })
  @ApiResponse({ status: 200, description: 'List of billing records' })
  async getInvoices(@Param('organizationId') organizationId: string) {
    const invoices = await this.subscriptionService.getBillingHistory(organizationId);
    return {
      success: true,
      data: invoices,
    };
  }
}
