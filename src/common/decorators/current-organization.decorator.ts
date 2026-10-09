import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { OrganizationContext } from '../interfaces/organization-context.interface.js';

export const CurrentOrganization = createParamDecorator(
  (data: keyof OrganizationContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const organizationContext = request.organizationContext as OrganizationContext;

    if (!organizationContext) {
      return null;
    }

    return data ? organizationContext[data] : organizationContext;
  },
);
