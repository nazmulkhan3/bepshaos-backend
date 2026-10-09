import { Injectable, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: DatabaseService) {}

  /**
   * Evaluates if a user has all the required permissions within a specific organization.
   * Permissions are checked strictly through the user's assigned role in that organization.
   */
  async hasPermissions(
    organizationId: string,
    userId: string,
    permissionKeys: string[],
  ): Promise<boolean> {
    if (!permissionKeys || permissionKeys.length === 0) {
      return true;
    }

    // 1. Fetch the user's active membership and associated role in this organization
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      return false; // Not a member or not active
    }

    if (!membership.role) {
      return false; // Membership has no role assigned
    }

    // Owner role automatically has all permissions
    if (membership.role.name === 'OWNER') {
      return true;
    }

    // Extract exactly what this role is allowed to do
    const rolePermissions = membership.role.permissions.map(rp => rp.permission.action);
    const rolePermissionSet = new Set(rolePermissions);

    // 2. Ensure all required permissions are met
    return permissionKeys.every(key => rolePermissionSet.has(key));
  }

  /**
   * Enforces that a user has all required permissions within the organization.
   * Throws a ForbiddenException if not.
   */
  async requirePermissions(
    organizationId: string,
    userId: string,
    permissionKeys: string[],
  ): Promise<void> {
    const hasAccess = await this.hasPermissions(organizationId, userId, permissionKeys);
    
    if (!hasAccess) {
      throw new ForbiddenException(
        `You do not have the required permissions to perform this action in this organization.`,
      );
    }
  }

  /**
   * Retrieves all effective permissions for a user within a specific organization context.
   */
  async getEffectivePermissions(organizationId: string, userId: string): Promise<string[]> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!membership || membership.status !== 'ACTIVE' || !membership.role) {
      return [];
    }

    // If OWNER, they effectively have all permissions, but for UI display we can either
    // return a special wildcard ['*'] or fetch all permissions from the database.
    if (membership.role.name === 'OWNER') {
      const allPermissions = await this.prisma.permission.findMany();
      return allPermissions.map(p => p.action);
    }

    return membership.role.permissions.map(rp => rp.permission.action);
  }
}
