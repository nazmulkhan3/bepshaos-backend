import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { CreatePaymentDto, PaymentQueryDto } from './dto/index.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@Controller('v1/organizations/:organizationId/payments')
@UseGuards(TenantGuard, PermissionGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @RequirePermissions('payment:create')
  async createPayment(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.createPayment(ctx.organizationId, ctx.userId, dto);
  }

  @Get()
  @RequirePermissions('payment:read')
  async getPayments(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() query: PaymentQueryDto,
  ) {
    return this.paymentsService.getPayments(ctx.organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('payment:read')
  async getPaymentById(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') paymentId: string,
  ) {
    return this.paymentsService.getPaymentById(ctx.organizationId, paymentId);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payment:void')
  async voidPayment(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('id') paymentId: string,
  ) {
    return this.paymentsService.voidPayment(ctx.organizationId, ctx.userId, paymentId);
  }
}
