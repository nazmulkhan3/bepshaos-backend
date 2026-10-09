import { Injectable, Inject } from '@nestjs/common';

import type { EmailProvider, SendEmailOptions } from '../providers/email.provider.js';
import { EMAIL_PROVIDER } from '../providers/email.provider.js';

@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async sendEmail(options: SendEmailOptions): Promise<void> {
    return this.emailProvider.sendEmail(options);
  }

  async sendVerificationOtp(email: string, otp: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Verify your email address - BebshaOS',
      template: 'EMAIL_VERIFICATION_OTP',
      context: { otp },
    });
  }

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Password Reset - BebshaOS',
      template: 'PASSWORD_RESET_OTP',
      context: { otp },
    });
  }
}
