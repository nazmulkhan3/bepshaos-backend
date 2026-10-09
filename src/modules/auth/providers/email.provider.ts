export interface SendEmailOptions {
  to: string;
  subject: string;
  template: string;
  context?: Record<string, any>;
}

export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<void>;
}
