import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';
import { AuthorizationService } from '../../modules/authorization/authorization.service.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    
    // The TenantGuard should have set the organizationContext and user
    const organizationContext = request.organizationContext;
    const user = request.user;

    if (!organizationContext || !user) {
      return false; // Authentication or Tenant guard was bypassed/failed
    }

    return await this.authorizationService.hasPermissions(
      organizationContext.organizationId,
      user.sub,
      requiredPermissions,
    );
  }
}
