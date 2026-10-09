import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { DatabaseService } from '../../../database/database.service.js';
import { PasswordService } from './password.service.js';
import { OtpService } from './otp.service.js';
import { EmailService } from './email.service.js';
import { TokenService } from './token.service.js';
import { SessionService } from './session.service.js';
import { ConflictException, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

describe('AuthService', () => {
  let service: AuthService;
  let mockDb: any;
  let mockPasswordService: any;
  let mockOtpService: any;
  let mockEmailService: any;
  let mockTokenService: any;
  let mockSessionService: any;

  beforeEach(async () => {
    mockDb = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => {
        return cb(mockDb);
      }),
      session: {
        updateMany: vi.fn(),
      },
    };

    mockPasswordService = {
      hash: vi.fn().mockResolvedValue('hashed-password'),
      verify: vi.fn(),
    };

    mockOtpService = {
      generateOtp: vi.fn().mockResolvedValue({ otp: '123456', cooldown: 60 }),
      verifyOtp: vi.fn(),
      invalidateOtp: vi.fn(),
    };

    mockEmailService = {
      sendVerificationOtp: vi.fn(),
      sendPasswordResetOtp: vi.fn(),
    };

    mockTokenService = {
      generateAuthTokens: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
      rotateTokens: vi.fn(),
      generateResetToken: vi.fn().mockResolvedValue('reset-token'),
      verifyResetToken: vi.fn(),
    };

    mockSessionService = {
      revokeSession: vi.fn(),
      revokeAllSessions: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: OtpService, useValue: mockOtpService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: TokenService, useValue: mockTokenService },
        { provide: SessionService, useValue: mockSessionService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should throw ConflictException if user exists', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.register({ name: 'test', email: 'test@example.com', password: 'password123' }))
        .rejects.toThrow(ConflictException);
    });

    it('should create user, hash password, and send OTP', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);
      mockDb.user.create.mockResolvedValue({ id: 'user-id', email: 'test@example.com' });
      
      const res = await service.register({ name: 'test', email: 'test@example.com', password: 'password123' });
      
      expect(mockPasswordService.hash).toHaveBeenCalledWith('password123');
      expect(mockDb.user.create).toHaveBeenCalled();
      expect(mockOtpService.generateOtp).toHaveBeenCalledWith('user-id', 'email-verification');
      expect(mockEmailService.sendVerificationOtp).toHaveBeenCalledWith('test@example.com', '123456');
      expect(res.userId).toBe('user-id');
    });
  });

  describe('login', () => {
    it('should throw Unauthorized if user not found', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'x@x.com', password: '123' })).rejects.toThrow(UnauthorizedException);
    });

    it('should throw Unauthorized if password invalid', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1', password: 'hashed' });
      mockPasswordService.verify.mockResolvedValue(false);
      await expect(service.login({ email: 'x@x.com', password: '123' })).rejects.toThrow(UnauthorizedException);
    });

    it('should throw Unauthorized if not verified', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1', password: 'hashed', status: 'ACTIVE', emailVerifiedAt: null });
      mockPasswordService.verify.mockResolvedValue(true);
      await expect(service.login({ email: 'x@x.com', password: '123' })).rejects.toThrow(UnauthorizedException);
    });

    it('should return tokens if valid', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1', password: 'hashed', status: 'ACTIVE', emailVerifiedAt: new Date() });
      mockPasswordService.verify.mockResolvedValue(true);
      
      const res = await service.login({ email: 'x@x.com', password: '123' });
      expect(res.accessToken).toBe('access');
      expect(res.refreshToken).toBe('refresh');
    });
  });

  describe('password reset', () => {
    it('requestPasswordReset should always return success message', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);
      const res = await service.requestPasswordReset('nonexistent@example.com');
      expect(res.message).toMatch(/password reset code/);
      expect(mockOtpService.generateOtp).not.toHaveBeenCalled();

      mockDb.user.findUnique.mockResolvedValue({ id: 'u1', email: 'real@example.com' });
      const res2 = await service.requestPasswordReset('real@example.com');
      expect(res2.message).toMatch(/password reset code/);
      expect(mockOtpService.generateOtp).toHaveBeenCalled();
    });

    it('confirmPasswordReset should revoke existing sessions and update password', async () => {
      mockTokenService.verifyResetToken.mockResolvedValue({ sub: 'u1', resetAuth: true });
      await service.confirmPasswordReset('token', 'newpass');
      expect(mockPasswordService.hash).toHaveBeenCalledWith('newpass');
      expect(mockDb.user.update).toHaveBeenCalled();
      expect(mockDb.session.updateMany).toHaveBeenCalled();
    });

    it('confirmPasswordReset should reject normal tokens', async () => {
      mockTokenService.verifyResetToken.mockResolvedValue({ sub: 'u1', resetAuth: false });
      await expect(service.confirmPasswordReset('token', 'newpass')).rejects.toThrow(BadRequestException);
    });
  });
});
