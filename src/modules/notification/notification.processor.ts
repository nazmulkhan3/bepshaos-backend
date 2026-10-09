import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DatabaseService } from '../../database/database.service.js';
import { Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';

export interface NotificationJobData {
  userId: string;
  organizationId?: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

@Processor('notification')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly prisma: DatabaseService) {
    super();
  }

  async process(job: Job<NotificationJobData, any, string>): Promise<any> {
    this.logger.log(`Processing notification job ${job.id}`);
    const { userId, organizationId, type, title, message, entityType, entityId } = job.data;

    try {
      // Create notification in DB
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          organizationId,
          type,
          title,
          message,
          entityType,
          entityId,
        },
      });

      this.logger.log(`Created notification ${notification.id} for user ${userId}`);
      return notification;
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(`Failed to create notification: ${error.message}`, error.stack);
      throw error;
    }
  }
}
