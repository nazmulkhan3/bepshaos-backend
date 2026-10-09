import { Test, TestingModule } from '@nestjs/testing';
import { TokenService } from './token.service.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionService } from './session.service.js';
import { vi } from 'vitest';

describe('TokenService', () => {
  let service: TokenService;
  let mockJwtService: any;
  let mockConfigService: any;
  let mockSessionService: any;

  beforeEach(async () => {
    mockJwtService = {
      signAsync: vi.fn().mockResolvedValue('test-access-token'),
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-id', resetAuth: true }),
    };

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'jwt.accessSecret') return 'access-secret';
        if (key === 'jwt.accessExpiresIn') return '15m';
        if (key === 'jwt.refreshExpiresIn') return '7d';
        return null;
      }),
    };

    mockSessionService = {
      createSession: vi.fn().mockResolvedValue({ id: 'session-id' }),
      verifySession: vi.fn().mockResolvedValue({ id: 'session-id', userId: 'user-id' }),
      rotateSession: vi.fn().mockResolvedValue({ id: 'new-session-id', userId: 'user-id' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SessionService, useValue: mockSessionService },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
  });

  it('should generate auth tokens', async () => {
    const { accessToken, refreshToken } = await service.generateAuthTokens('user-id');
    expect(accessToken).toBe('test-access-token');
    expect(refreshToken).toHaveLength(64);
    expect(mockSessionService.createSession).toHaveBeenCalled();
    expect(mockJwtService.signAsync).toHaveBeenCalled();
  });

  it('should rotate tokens successfully', async () => {
    const { accessToken, refreshToken } = await service.rotateTokens('session-id', 'old-refresh');
    expect(accessToken).toBe('test-access-token');
    expect(refreshToken).toHaveLength(64);
    expect(mockSessionService.verifySession).toHaveBeenCalledWith('session-id', 'old-refresh');
    expect(mockSessionService.rotateSession).toHaveBeenCalled();
  });

  it('should throw error if rotation fails validation', async () => {
    mockSessionService.verifySession.mockResolvedValue(null);
    await expect(service.rotateTokens('session-id', 'bad-refresh')).rejects.toThrow('Invalid or expired refresh token');
  });

  it('should generate a reset token', async () => {
    const token = await service.generateResetToken('user-id');
    expect(token).toBe('test-access-token');
    expect(mockJwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-id', resetAuth: true }),
      expect.any(Object)
    );
  });

  it('should verify reset token', async () => {
    const result = await service.verifyResetToken('test');
    expect(result.resetAuth).toBe(true);
    expect(mockJwtService.verifyAsync).toHaveBeenCalled();
  });
});
