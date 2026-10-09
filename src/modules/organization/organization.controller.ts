import { Controller, Post, Body, Get, Param, Patch, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader, ApiResponse } from '@nestjs/swagger';
import { OrganizationService } from './organization.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller({ path: 'organizations', version: '1' })
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: 201, description: 'Organization created successfully' })
  async createOrganization(@Req() req: Request & { user?: any }, @Body() createOrganizationDto: CreateOrganizationDto) {
    const organization = await this.organizationService.createOrganization(req.user.sub, createOrganizationDto);
    return {
      success: true,
      data: organization,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List my organizations' })
  @ApiResponse({ status: 200, description: 'List of organizations you belong to' })
  async findMyOrganizations(@Req() req: Request & { user?: any }) {
    const organizations = await this.organizationService.findMyOrganizations(req.user.sub);
    return {
      success: true,
      data: organizations,
    };
  }

  @Get(':organizationId')
  @UseGuards(TenantGuard, PermissionGuard)
  @RequirePermissions('organization:read')
  @ApiHeader({
    name: 'x-organization-id',
    description: 'Organization ID',
    required: false,
  })
  @ApiOperation({ summary: 'Get an organization by ID' })
  @ApiResponse({ status: 200, description: 'Organization details' })
  async findOrganizationById(
    @Req() req: Request & { user?: any },
    @Param('organizationId') organizationId: string,
  ) {
    const organization = await this.organizationService.findOrganizationById(req.user.sub, organizationId);
    return {
      success: true,
      data: organization,
    };
  }

  @Patch(':organizationId')
  @UseGuards(TenantGuard, PermissionGuard)
  @RequirePermissions('organization:update')
  @ApiHeader({
    name: 'x-organization-id',
    description: 'Organization ID',
    required: false,
  })
  @ApiOperation({ summary: 'Update an organization' })
  @ApiResponse({ status: 200, description: 'Organization updated successfully' })
  async updateOrganization(
    @Param('organizationId') organizationId: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    const organization = await this.organizationService.updateOrganization(
      organizationId,
      updateOrganizationDto,
    );
    return {
      success: true,
      data: organization,
    };
  }

  @Get(':organizationId/members')
  @UseGuards(TenantGuard, PermissionGuard)
  @RequirePermissions('member:read')
  @ApiHeader({
    name: 'x-organization-id',
    description: 'Organization ID',
    required: false,
  })
  @ApiOperation({ summary: 'List organization members' })
  @ApiResponse({ status: 200, description: 'List of members' })
  async findOrganizationMembers(
    @Param('organizationId') organizationId: string,
  ) {
    const members = await this.organizationService.findOrganizationMembers(
      organizationId,
    );
    return {
      success: true,
      data: members,
    };
  }

  @Post(':organizationId/members')
  @UseGuards(TenantGuard, PermissionGuard)
  @RequirePermissions('member:invite')
  @ApiHeader({
    name: 'x-organization-id',
    description: 'Organization ID',
    required: false,
  })
  @ApiOperation({ summary: 'Add a new member to an organization' })
  @ApiResponse({ status: 201, description: 'Member added successfully' })
  async addMember(
    @Param('organizationId') organizationId: string,
    @Body() dto: AddMemberDto,
  ) {
    const member = await this.organizationService.addMember(
      organizationId,
      dto.userId,
      dto.roleId,
    );
    return {
      success: true,
      data: member,
    };
  }

  @Patch(':organizationId/members/:memberId/role')
  @UseGuards(TenantGuard, PermissionGuard)
  @RequirePermissions('member:update')
  @ApiHeader({
    name: 'x-organization-id',
    description: 'Organization ID',
    required: false,
  })
  @ApiOperation({ summary: 'Assign a role to an organization member' })
  @ApiResponse({ status: 200, description: 'Role assigned successfully' })
  async assignRole(
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
    @Body('roleId') roleId: string,
  ) {
    const member = await this.organizationService.assignRole(
      organizationId,
      memberId,
      roleId,
    );
    return {
      success: true,
      data: member,
    };
  }
}
