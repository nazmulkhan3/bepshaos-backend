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
    this.logger.log(`Processing notification job ${job.id} (attempt ${job.attemptsMade + 1})`);
    const { userId, organizationId, type, title, message, entityType, entityId } = job.data;

    try {
      // 1. Tenant Isolation Verification: If organizationId is specified, verify user belongs to organization
      if (organizationId) {
        const member = await this.prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId,
              userId,
            },
          },
        });

        if (!member) {
          this.logger.warn(
            `Tenant boundary violation in notification job ${job.id}: user ${userId} is not in org ${organizationId}. Skipping.`,
          );
          return { skipped: true, reason: 'TENANT_MEMBERSHIP_NOT_FOUND' };
        }
      }

      // 2. Idempotency Check: Prevent duplicate unread notifications for same entity and user
      if (entityType && entityId) {
        const existing = await this.prisma.notification.findFirst({
          where: {
            userId,
            organizationId: organizationId || null,
            type,
            entityType,
            entityId,
            isRead: false,
          },
        });

        if (existing) {
          this.logger.log(`Notification already exists for entity ${entityType}:${entityId}. Skipping duplicate.`);
          return existing;
        }
      }

      // 3. Create notification in DB
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          organizationId: organizationId || null,
          type,
          title,
          message,
          entityType: entityType || null,
          entityId: entityId || null,
        },
      });

      this.logger.log(`Created notification ${notification.id} for user ${userId}`);
      return notification;
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(`Notification job ${job.id} failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
