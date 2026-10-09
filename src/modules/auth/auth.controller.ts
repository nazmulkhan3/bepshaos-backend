import { Controller, Post, Get, Body, Req, UseGuards, HttpCode, HttpStatus, Ip } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './services/auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto.js';
import { ResendEmailOtpDto } from './dto/resend-email-otp.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto.js';
import { PasswordResetVerifyDto } from './dto/password-reset-verify.dto.js';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { DatabaseService } from '../../database/database.service.js';

@ApiTags('Authentication')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly db: DatabaseService, // For /me endpoint
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('verify-email-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email with OTP' })
  async verifyEmailOtp(@Body() dto: VerifyEmailOtpDto) {
    return this.authService.verifyEmailOtp(dto.userId, dto.otp);
  }

  @Public()
  @Post('resend-email-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification OTP' })
  async resendEmailOtp(@Body() dto: ResendEmailOtpDto) {
    return this.authService.resendEmailOtp(dto.userId);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto, @Req() req: any, @Ip() ipAddress: string) {
    const deviceInfo = req.headers['user-agent'];
    return this.authService.login(dto, deviceInfo, ipAddress);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: any, @Ip() ipAddress: string) {
    const deviceInfo = req.headers['user-agent'];
    return this.authService.refreshTokens(dto.sessionId, dto.refreshToken, deviceInfo, ipAddress);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout current session' })
  async logout(@CurrentUser() user: any) {
    return this.authService.logout(user.sessionId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout all sessions' })
  async logoutAll(@CurrentUser() user: any) {
    return this.authService.logoutAll(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get current user' })
  async getMe(@CurrentUser() user: any) {
    const dbUser = await this.db.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerifiedAt: true,
        status: true,
      },
    });
    return dbUser;
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset OTP' })
  async requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password-reset/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify password reset OTP' })
  async verifyPasswordResetOtp(@Body() dto: PasswordResetVerifyDto) {
    return this.authService.verifyPasswordResetOtp(dto.email, dto.otp);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm password reset' })
  async confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    return this.authService.confirmPasswordReset(dto.resetToken, dto.newPassword);
  }
}
