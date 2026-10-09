import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard.js';

@Module({
  imports: [DatabaseModule, SubscriptionModule, AuditLogModule],
  controllers: [AdminController],
  providers: [AdminService, PlatformAdminGuard],
  exports: [AdminService, PlatformAdminGuard],
})
export class AdminModule {}
