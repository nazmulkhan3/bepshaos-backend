import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PlanService } from './services/plan.service.js';
import { SubscriptionService } from './services/subscription.service.js';
import { SubscriptionLimitService } from './services/subscription-limit.service.js';
import { SubscriptionWebhookService } from './services/subscription-webhook.service.js';
import { DummyBillingProvider } from './billing/dummy-billing.provider.js';
import { BillingProviderRegistry } from './billing/billing-provider.registry.js';
import { PlanController } from './controllers/plan.controller.js';
import { SubscriptionController } from './controllers/subscription.controller.js';
import { SubscriptionWebhookController } from './controllers/subscription-webhook.controller.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule],
  controllers: [
    PlanController,
    SubscriptionController,
    SubscriptionWebhookController,
  ],
  providers: [
    PlanService,
    SubscriptionLimitService,
    SubscriptionService,
    SubscriptionWebhookService,
    DummyBillingProvider,
    BillingProviderRegistry,
  ],
  exports: [
    PlanService,
    SubscriptionLimitService,
    SubscriptionService,
    SubscriptionWebhookService,
  ],
})
export class SubscriptionModule {}
