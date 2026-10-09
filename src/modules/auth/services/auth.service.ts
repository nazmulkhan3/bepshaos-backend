import { Injectable, ConflictException, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import { PasswordService } from './password.service.js';
import { OtpService } from './otp.service.js';
import { EmailService } from './email.service.js';
import { TokenService } from './token.service.js';
import { SessionService } from './session.service.js';
import { RegisterDto } from '../dto/register.dto.js';
import { LoginDto } from '../dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwordService: PasswordService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.db.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    const hashedPassword = await this.passwordService.hash(dto.password);

    const user = await this.db.user.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        status: 'ACTIVE',
      },
    });

    const { otp } = await this.otpService.generateOtp(user.id, 'email-verification');
    await this.emailService.sendVerificationOtp(user.email!, otp);

    return {
      message: 'Registration successful. Please verify your email.',
      userId: user.id,
    };
  }

  async verifyEmailOtp(userId: string, otp: string) {
    const isValid = await this.otpService.verifyOtp(userId, 'email-verification', otp);
    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP.');
    }

    await this.db.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });

    return { message: 'Email verified successfully.' };
  }

  async resendEmailOtp(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email is already verified.');
    }

    await this.otpService.invalidateOtp(user.id, 'email-verification');
    const { otp } = await this.otpService.generateOtp(user.id, 'email-verification');
    await this.emailService.sendVerificationOtp(user.email!, otp);

    return { message: 'Verification OTP resent.' };
  }

  async login(dto: LoginDto, deviceInfo?: string, ipAddress?: string) {
    const user = await this.db.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isValidPassword = await this.passwordService.verify(user.password!, dto.password);
    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active.');
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Please verify your email before logging in.', { cause: { userId: user.id }});
    }

    const tokens = await this.tokenService.generateAuthTokens(user.id, deviceInfo, ipAddress);

    return {
      message: 'Login successful.',
      ...tokens,
    };
  }

  async refreshTokens(sessionId: string, refreshToken: string, deviceInfo?: string, ipAddress?: string) {
    return this.tokenService.rotateTokens(sessionId, refreshToken, deviceInfo, ipAddress);
  }

  async logout(sessionId: string) {
    await this.sessionService.revokeSession(sessionId);
    return { message: 'Logged out successfully.' };
  }

  async logoutAll(userId: string) {
    await this.sessionService.revokeAllSessions(userId);
    return { message: 'Logged out of all sessions successfully.' };
  }

  async requestPasswordReset(email: string) {
    const user = await this.db.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (user) {
      const { otp } = await this.otpService.generateOtp(user.id, 'password-reset');
      await this.emailService.sendPasswordResetOtp(user.email!, otp);
    }
    
    // Always return success to prevent user enumeration
    return { message: 'If an account with that email exists, we have sent a password reset code.' };
  }

  async verifyPasswordResetOtp(email: string, otp: string) {
    const user = await this.db.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired OTP.');
    }

    const isValid = await this.otpService.verifyOtp(user.id, 'password-reset', otp);
    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP.');
    }

    // Generate a temporary reset authorization token using OTP service
    // For simplicity, we can use a small payload or just store a special key in redis
    // But since the requirements say "temporary reset authorization", we can generate a short-lived token
    const token = await this.tokenService.generateResetToken(user.id);

    return { 
      message: 'OTP verified successfully.',
      resetToken: token,
    };
  }

  async confirmPasswordReset(resetToken: string, newPassword: string) {
    let payload;
    try {
      payload = await this.tokenService.verifyResetToken(resetToken);
    } catch {
      throw new BadRequestException('Invalid or expired reset token.');
    }

    if (!payload.resetAuth) {
      throw new BadRequestException('Invalid reset token.');
    }

    const hashedPassword = await this.passwordService.hash(newPassword);

    await this.db.$transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: payload.sub },
        data: { password: hashedPassword },
      });

      // Revoke existing sessions
      await tx.session.updateMany({
        where: { userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return { message: 'Password reset successfully. All existing sessions have been revoked.' };
  }
}
