import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader, ApiResponse } from '@nestjs/swagger';
import { RoleService } from './role.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';

@ApiTags('Roles')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@ApiHeader({ name: 'x-organization-id', description: 'Organization ID', required: true })
@Controller({ path: 'organizations/:organizationId/roles', version: '1' })
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequirePermissions('role:read')
  @ApiOperation({ summary: 'List all roles (system + custom) for the organization' })
  @ApiResponse({ status: 200, description: 'List of roles returned successfully' })
  async findAll(@Param('organizationId') organizationId: string) {
    const roles = await this.roleService.findAll(organizationId);
    return {
      success: true,
      data: roles,
    };
  }

  @Get(':roleId')
  @RequirePermissions('role:read')
  @ApiOperation({ summary: 'Get a specific role' })
  async findOne(
    @Param('organizationId') organizationId: string,
    @Param('roleId') roleId: string,
  ) {
    const role = await this.roleService.findOne(organizationId, roleId);
    return {
      success: true,
      data: role,
    };
  }

  @Post()
  @RequirePermissions('role:create')
  @ApiOperation({ summary: 'Create a custom role' })
  async createRole(
    @Param('organizationId') organizationId: string,
    @Body() createRoleDto: CreateRoleDto,
  ) {
    const role = await this.roleService.createRole(organizationId, createRoleDto);
    return {
      success: true,
      data: role,
    };
  }

  @Patch(':roleId')
  @RequirePermissions('role:update')
  @ApiOperation({ summary: 'Update a custom role' })
  async updateRole(
    @Param('organizationId') organizationId: string,
    @Param('roleId') roleId: string,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    const role = await this.roleService.updateRole(organizationId, roleId, updateRoleDto);
    return {
      success: true,
      data: role,
    };
  }

  @Delete(':roleId')
  @RequirePermissions('role:delete')
  @ApiOperation({ summary: 'Delete a custom role' })
  async deleteRole(
    @Param('organizationId') organizationId: string,
    @Param('roleId') roleId: string,
  ) {
    await this.roleService.deleteRole(organizationId, roleId);
    return {
      success: true,
      data: null,
    };
  }
}
