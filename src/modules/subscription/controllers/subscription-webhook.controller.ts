import { Controller, Post, Body, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SubscriptionWebhookService } from '../services/subscription-webhook.service.js';

@ApiTags('Subscription Webhooks')
@Controller({ path: 'subscriptions/webhooks', version: '1' })
export class SubscriptionWebhookController {
  constructor(private readonly webhookService: SubscriptionWebhookService) {}

  @Post(':provider')
  @ApiOperation({ summary: 'Receive payment gateway webhooks (Public/Signature Verified)' })
  @ApiResponse({ status: 200, description: 'Webhook acknowledged and scheduled for execution' })
  async handleWebhook(
    @Param('provider') provider: string,
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
  ) {
    return this.webhookService.ingestWebhook(provider, payload, headers);
  }
}
