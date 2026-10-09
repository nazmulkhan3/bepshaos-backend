import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProvider, SendEmailOptions } from './email.provider.js';

@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const exposeOtp = this.configService.get<boolean>('email.devExposeOtp') ?? false;

    this.logger.log(`[DEV EMAIL]`);
    this.logger.log(`To: ${options.to}`);
    this.logger.log(`Template: ${options.template}`);
    
    if (exposeOtp && options.context?.otp) {
      this.logger.log(`OTP: ${options.context.otp}`);
    } else {
      this.logger.log(`OTP: [HIDDEN]`);
    }
  }
}
