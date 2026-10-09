import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailProvider, SendEmailOptions } from './email.provider.js';
import { verificationOtpTemplate } from '../templates/verification-otp.template.js';
import { passwordResetOtpTemplate } from '../templates/password-reset-otp.template.js';

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('email.smtp.host'),
      port: this.configService.get<number>('email.smtp.port'),
      secure: this.configService.get<boolean>('email.smtp.secure'),
      auth: {
        user: this.configService.get<string>('email.smtp.user'),
        pass: this.configService.get<string>('email.smtp.password'),
      },
    });
  }

  private renderTemplate(templateName: string, context: Record<string, any> = {}): string {
    switch (templateName) {
      case 'EMAIL_VERIFICATION_OTP':
        return verificationOtpTemplate(context.otp);
      case 'PASSWORD_RESET_OTP':
        return passwordResetOtpTemplate(context.otp);
      default:
        return `Your code is ${context.otp}`;
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const fromName = this.configService.get<string>('email.fromName') || 'BebshaOS';
    const fromAddress = this.configService.get<string>('email.from') || 'noreply@bebshaos.com';

    try {
      await this.transporter.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to: options.to,
        subject: options.subject,
        text: this.renderTemplate(options.template, options.context),
      });
      this.logger.log(`Sent email to ${options.to}`);
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${options.to}`, error.stack);
      throw error;
    }
  }
}
