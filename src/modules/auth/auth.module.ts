import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { PasswordService } from './services/password.service.js';
import { OtpService } from './services/otp.service.js';
import { EmailService } from './services/email.service.js';
import { TokenService } from './services/token.service.js';
import { SessionService } from './services/session.service.js';
import { EMAIL_PROVIDER } from './providers/email.provider.js';
import { ConsoleEmailProvider } from './providers/console-email.provider.js';
import { SmtpEmailProvider } from './providers/smtp-email.provider.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.accessSecret'),
        signOptions: {
          expiresIn: (configService.get<string>('jwt.accessExpiresIn') || '15m') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    OtpService,
    EmailService,
    TokenService,
    SessionService,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('email.provider');
        return provider === 'smtp'
          ? new SmtpEmailProvider(configService)
          : new ConsoleEmailProvider(configService);
      },
      inject: [ConfigService],
    },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
