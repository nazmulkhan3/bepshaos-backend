export interface WebhookVerificationResult {
  isValid: boolean;
  providerEventId: string;
  eventType: string;
  providerTxnId?: string;
  amount?: number;
  currency?: string;
  organizationId?: string;
  subscriptionId?: string;
  billingRecordId?: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  rawPayload: any;
}

export interface IBillingProvider {
  readonly providerName: string;

  /**
   * Verify and parse incoming webhook payload and headers
   */
  verifyWebhook(payload: any, headers: Record<string, string>): Promise<WebhookVerificationResult>;

  /**
   * Verify a transaction status directly with the provider
   */
  verifyTransaction(transactionId: string): Promise<{
    isPaid: boolean;
    amount: number;
    currency: string;
    paidAt?: Date;
    rawResponse: any;
  }>;
}
