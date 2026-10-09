import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service.js';
import { UserStatus } from '@prisma/client';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Set by JwtAuthGuard

    if (!user || !user.sub) {
      throw new UnauthorizedException('Authentication required');
    }

    // 1. Fetch user from DB to verify active status and credentials
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
      },
    });

    if (!dbUser || dbUser.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('User is not active or not found');
    }

    // 2. Platform Admin authorization check
    // Strategy: Verify against configured PLATFORM_ADMIN_EMAILS or PLATFORM_ADMIN_USER_IDS
    const adminEmailsRaw = this.configService.get<string>('platformAdmin.emails') ||
      process.env.PLATFORM_ADMIN_EMAILS ||
      '';
    const adminIdsRaw = this.configService.get<string>('platformAdmin.userIds') ||
      process.env.PLATFORM_ADMIN_USER_IDS ||
      '';

    const allowedEmails = adminEmailsRaw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const allowedIds = adminIdsRaw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    const userEmail = dbUser.email?.toLowerCase();
    const isEmailAllowed = userEmail && allowedEmails.includes(userEmail);
    const isIdAllowed = allowedIds.includes(dbUser.id);

    if (!isEmailAllowed && !isIdAllowed) {
      throw new ForbiddenException(
        'Access denied: platform administration privileges required. Tenant roles do not grant platform access.',
      );
    }

    // Attach admin context to request
    request['isPlatformAdmin'] = true;
    request['platformAdminUser'] = dbUser;

    return true;
  }
}
