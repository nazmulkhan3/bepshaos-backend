import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomerService } from './customer.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { CustomerQueryDto } from './dto/customer-query.dto.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId/customers', version: '1' })
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  @RequirePermissions('customer:create')
  @ApiOperation({ summary: 'Create a new customer' })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() createCustomerDto: CreateCustomerDto,
  ) {
    const data = await this.customerService.create(ctx.organizationId, createCustomerDto, ctx.userId);
    return { success: true, data };
  }

  @Get()
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: 'List and search customers' })
  async findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() queryDto: CustomerQueryDto,
  ) {
    const data = await this.customerService.findAll(ctx.organizationId, queryDto);
    return { success: true, ...data };
  }

  @Get(':customerId')
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: 'Get customer details' })
  async findOne(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('customerId') customerId: string,
  ) {
    const data = await this.customerService.findOne(ctx.organizationId, customerId);
    return { success: true, data };
  }

  @Patch(':customerId')
  @RequirePermissions('customer:update')
  @ApiOperation({ summary: 'Update customer details' })
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('customerId') customerId: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    const data = await this.customerService.update(
      ctx.organizationId,
      customerId,
      updateCustomerDto,
      ctx.userId
    );
    return { success: true, data };
  }

  @Delete(':customerId')
  @RequirePermissions('customer:archive')
  @ApiOperation({ summary: 'Archive a customer' })
  async archive(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('customerId') customerId: string,
  ) {
    const data = await this.customerService.archive(ctx.organizationId, customerId, ctx.userId);
    return { success: true, data };
  }
}
