import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: DatabaseService) {}

  async findAll(organizationId: string) {
    return this.prisma.role.findMany({
      where: {
        OR: [
          { organizationId: null }, // System roles
          { organizationId },       // Custom roles for this org
        ],
      },
      include: {
        permissions: {
          include: {
            permission: true,
          }
        }
      },
      orderBy: [
        { organizationId: 'asc' },
        { name: 'asc' },
      ],
    });
  }

  async findOne(organizationId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        OR: [
          { organizationId: null },
          { organizationId },
        ],
      },
      include: {
        permissions: {
          include: {
            permission: true,
          }
        }
      }
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  async createRole(organizationId: string, createRoleDto: CreateRoleDto) {
    // 1. Verify all requested permissions actually exist
    const dbPermissions = await this.prisma.permission.findMany({
      where: { action: { in: createRoleDto.permissions } },
    });

    if (dbPermissions.length !== createRoleDto.permissions.length) {
      throw new BadRequestException('One or more requested permissions are invalid');
    }

    // 2. Check if role name already exists in this organization
    const existingRole = await this.prisma.role.findFirst({
      where: {
        organizationId,
        name: createRoleDto.name,
      },
    });

    if (existingRole) {
      throw new BadRequestException(`Role with name "${createRoleDto.name}" already exists in this organization`);
    }

    // 3. Create the role and its permissions
    return this.prisma.role.create({
      data: {
        name: createRoleDto.name,
        organizationId,
        permissions: {
          create: dbPermissions.map(p => ({
            permissionId: p.id,
          })),
        },
      },
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });
  }

  async updateRole(organizationId: string, roleId: string, updateRoleDto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        organizationId, // IMPORTANT: Prevents modifying system roles (organizationId = null)
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found or you do not have permission to modify it (system roles cannot be modified)');
    }

    // If updating name, check for duplicates
    if (updateRoleDto.name && updateRoleDto.name !== role.name) {
      const existingRole = await this.prisma.role.findFirst({
        where: {
          organizationId,
          name: updateRoleDto.name,
        },
      });

      if (existingRole) {
        throw new BadRequestException(`Role with name "${updateRoleDto.name}" already exists`);
      }
    }

    return await this.prisma.$transaction(async (tx: any) => {
      // If permissions are updated, we replace them
      if (updateRoleDto.permissions) {
        const dbPermissions = await tx.permission.findMany({
          where: { action: { in: updateRoleDto.permissions } },
        });

        if (dbPermissions.length !== updateRoleDto.permissions.length) {
          throw new BadRequestException('One or more requested permissions are invalid');
        }

        // Delete existing permissions for this role
        await tx.rolePermission.deleteMany({
          where: { roleId },
        });

        // Insert new ones
        if (dbPermissions.length > 0) {
          await tx.rolePermission.createMany({
            data: dbPermissions.map((p: any) => ({
              roleId,
              permissionId: p.id,
            })),
          });
        }
      }

      // Update basic fields
      const updatedRole = await tx.role.update({
        where: { id: roleId },
        data: {
          ...(updateRoleDto.name ? { name: updateRoleDto.name } : {}),
        },
        include: {
          permissions: {
            include: { permission: true }
          }
        }
      });

      return updatedRole;
    });
  }

  async deleteRole(organizationId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        organizationId, // IMPORTANT: Prevents deleting system roles
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found or you do not have permission to delete it (system roles cannot be deleted)');
    }

    // Check if role is currently in use
    const membersWithRole = await this.prisma.organizationMember.count({
      where: { roleId },
    });

    if (membersWithRole > 0) {
      throw new BadRequestException(`Cannot delete role because it is assigned to ${membersWithRole} member(s)`);
    }

    await this.prisma.role.delete({
      where: { id: roleId },
    });

    return { success: true };
  }
}
