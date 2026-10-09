import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BusinessService } from './business.service.js';
import { CreateBusinessDto } from './dto/create-business.dto.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';
// removed JwtAuthGuard
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Business')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId/business', version: '1' })
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Post()
  @RequirePermissions('business:create')
  @ApiOperation({ summary: 'Create business profile' })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() createBusinessDto: CreateBusinessDto,
  ) {
    const data = await this.businessService.create(ctx.organizationId, createBusinessDto);
    return { success: true, data };
  }

  @Get()
  @RequirePermissions('business:read')
  @ApiOperation({ summary: 'Get business profile' })
  async findOne(@CurrentOrganization() ctx: OrganizationContext) {
    const data = await this.businessService.findOne(ctx.organizationId);
    return { success: true, data };
  }

  @Patch()
  @RequirePermissions('business:update')
  @ApiOperation({ summary: 'Update business profile' })
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() updateBusinessDto: UpdateBusinessDto,
  ) {
    const data = await this.businessService.update(ctx.organizationId, updateBusinessDto);
    return { success: true, data };
  }
}
