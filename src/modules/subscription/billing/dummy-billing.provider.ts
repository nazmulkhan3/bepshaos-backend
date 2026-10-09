import { Injectable, BadRequestException } from '@nestjs/common';
import { IBillingProvider, WebhookVerificationResult } from '../interfaces/billing-provider.interface.js';

@Injectable()
export class DummyBillingProvider implements IBillingProvider {
  readonly providerName = 'MANUAL';

  async verifyWebhook(payload: any, headers: Record<string, string>): Promise<WebhookVerificationResult> {
    if (!payload || !payload.eventId) {
      throw new BadRequestException('Invalid webhook payload: missing eventId');
    }

    return {
      isValid: true,
      providerEventId: String(payload.eventId),
      eventType: payload.eventType || 'PAYMENT_SUCCESS',
      providerTxnId: payload.transactionId ? String(payload.transactionId) : undefined,
      amount: payload.amount !== undefined ? Number(payload.amount) : undefined,
      currency: payload.currency || 'BDT',
      organizationId: payload.organizationId,
      subscriptionId: payload.subscriptionId,
      billingRecordId: payload.billingRecordId,
      status: payload.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
      rawPayload: payload,
    };
  }

  async verifyTransaction(transactionId: string): Promise<{
    isPaid: boolean;
    amount: number;
    currency: string;
    paidAt?: Date;
    rawResponse: any;
  }> {
    return {
      isPaid: true,
      amount: 0,
      currency: 'BDT',
      paidAt: new Date(),
      rawResponse: { simulated: true, transactionId },
    };
  }
}
