import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationQueueService {
  constructor(
    @InjectQueue('notification') private readonly notificationQueue: Queue
  ) {}

  async enqueue(data: {
    userId: string;
    organizationId?: string;
    type: NotificationType;
    title: string;
    message: string;
    entityType?: string;
    entityId?: string;
  }) {
    await this.notificationQueue.add('send', data, {
      jobId: `${data.type}:${data.entityId || Date.now()}:${data.userId}`,
    });
  }
}
