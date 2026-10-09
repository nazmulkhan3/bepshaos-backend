import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    
    if (!user) return null;
    
    if (data) {
      if (data === 'id' && user.sub) {
        return user.sub;
      }
      return user[data];
    }
    
    return user;
  },
);
