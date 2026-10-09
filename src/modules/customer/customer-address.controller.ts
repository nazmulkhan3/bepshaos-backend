import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomerAddressService } from './customer-address.service.js';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto.js';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Customer Addresses')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId/customers/:customerId/addresses', version: '1' })
export class CustomerAddressController {
  constructor(private readonly customerAddressService: CustomerAddressService) {}

  @Post()
  @RequirePermissions('customer:update')
  @ApiOperation({ summary: 'Add a new address for a customer' })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('customerId') customerId: string,
    @Body() createCustomerAddressDto: CreateCustomerAddressDto,
  ) {
    const data = await this.customerAddressService.create(
      ctx.organizationId,
      customerId,
      createCustomerAddressDto,
      ctx.userId
    );
    return { success: true, data };
  }

  @Get()
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: 'List all addresses for a customer' })
  async findAll(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('customerId') customerId: string,
  ) {
    const data = await this.customerAddressService.findAll(ctx.organizationId, customerId);
    return { success: true, data };
  }

  @Patch(':addressId')
  @RequirePermissions('customer:update')
  @ApiOperation({ summary: 'Update a customer address' })
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('customerId') customerId: string,
    @Param('addressId') addressId: string,
    @Body() updateCustomerAddressDto: UpdateCustomerAddressDto,
  ) {
    const data = await this.customerAddressService.update(
      ctx.organizationId,
      customerId,
      addressId,
      updateCustomerAddressDto,
      ctx.userId
    );
    return { success: true, data };
  }

  @Delete(':addressId')
  @RequirePermissions('customer:update')
  @ApiOperation({ summary: 'Delete a customer address' })
  async remove(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('customerId') customerId: string,
    @Param('addressId') addressId: string,
  ) {
    const data = await this.customerAddressService.remove(
      ctx.organizationId,
      customerId,
      addressId,
      ctx.userId
    );
    return { success: true, data };
  }
}
