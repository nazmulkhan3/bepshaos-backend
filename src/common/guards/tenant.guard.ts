import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { MemberStatus, OrganizationStatus } from '@prisma/client';
import { OrganizationContext } from '../interfaces/organization-context.interface.js';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('User is not authenticated');
    }

    // Try to get organization ID from headers or params
    const organizationId = request.headers['x-organization-id'] || request.params.organizationId;

    if (!organizationId) {
      throw new BadRequestException('Organization ID is required in headers or params');
    }

    // Lookup organization membership
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: user.sub,
        },
      },
      include: {
        organization: true,
        role: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    if (membership.status !== MemberStatus.ACTIVE) {
      throw new ForbiddenException('Your membership in this organization is not active');
    }

    if (membership.organization.status !== OrganizationStatus.ACTIVE) {
      throw new ForbiddenException('This organization is not active');
    }

    // Create the organization context
    const orgContext: OrganizationContext = {
      organizationId: membership.organizationId,
      userId: membership.userId,
      membershipId: membership.id,
      roleId: membership.roleId,
      roleName: membership.role?.name || '',
      status: membership.status,
      organizationStatus: membership.organization.status,
    };

    // Inject into request
    request.organizationContext = orgContext;

    return true;
  }
}
