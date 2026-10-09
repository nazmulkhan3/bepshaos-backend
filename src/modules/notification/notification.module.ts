import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationService } from './notification.service.js';
import { NotificationController } from './notification.controller.js';
import { NotificationProcessor } from './notification.processor.js';
import { NotificationQueueService } from './notification.queue.service.js';
import { DatabaseModule } from '../../database/database.module.js';

import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    BullModule.registerQueue({
      name: 'notification',
    }),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationProcessor, NotificationQueueService],
  exports: [NotificationService, NotificationQueueService, BullModule],
})
export class NotificationModule {}
