import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditLogService } from './audit-log.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
