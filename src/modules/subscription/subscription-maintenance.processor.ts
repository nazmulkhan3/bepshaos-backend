import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionService } from './services/subscription.service.js';
import { SubscriptionWebhookService } from './services/subscription-webhook.service.js';

export interface SubscriptionMaintenanceJobData {
  action: 'PROCESS_LIFECYCLE' | 'RECOVER_WEBHOOKS' | 'FULL_MAINTENANCE';
  batchSize?: number;
}

@Processor('subscription-maintenance')
@Injectable()
export class SubscriptionMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(SubscriptionMaintenanceProcessor.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly webhookService: SubscriptionWebhookService,
  ) {
    super();
  }

  async process(job: Job<SubscriptionMaintenanceJobData, any, string>): Promise<any> {
    const action = job.data?.action || 'FULL_MAINTENANCE';
    const batchSize = job.data?.batchSize || 50;

    this.logger.log(`Processing subscription maintenance job ${job.id}: action=${action}`);

    const result: Record<string, any> = {};

    try {
      if (action === 'PROCESS_LIFECYCLE' || action === 'FULL_MAINTENANCE') {
        const lifecycleRes = await this.subscriptionService.processSubscriptionLifecycle(batchSize);
        result.lifecycle = lifecycleRes;
        this.logger.log(
          `Processed lifecycle: expiredTrials=${lifecycleRes.expiredTrials}, cancelledSubs=${lifecycleRes.cancelledSubs}, pastDueSubs=${lifecycleRes.pastDueSubs}`,
        );
      }

      if (action === 'RECOVER_WEBHOOKS' || action === 'FULL_MAINTENANCE') {
        const recoveredCount = await this.webhookService.recoverExpiredLeasesAndRetries(5, batchSize);
        result.recoveredWebhooks = recoveredCount;
        this.logger.log(`Recovered and reprocessed ${recoveredCount} webhook events`);
      }

      return result;
    } catch (err: any) {
      this.logger.error(`Subscription maintenance job ${job.id} failed: ${err.message}`, err.stack);
      throw err;
    }
  }
}
