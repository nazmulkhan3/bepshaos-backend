import { Test, TestingModule } from '@nestjs/testing';
import { OtpService, OtpState } from './otp.service.js';
import { ConfigService } from '@nestjs/config';

import { vi } from 'vitest';

describe('OtpService', () => {
  let service: OtpService;
  let mockRedis: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      ttl: vi.fn(),
    };

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'otp.length') return 6;
        if (key === 'otp.expiresInSeconds') return 300;
        if (key === 'otp.maxAttempts') return 5;
        if (key === 'otp.resendCooldownSeconds') return 60;
        if (key === 'OTP_HASH_SECRET') return 'test-secret';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateOtp', () => {
    it('should generate a 6 digit OTP and hash it', async () => {
      mockRedis.get.mockResolvedValue(null);
      
      const { otp, cooldown } = await service.generateOtp('user1', 'email-verification');
      
      expect(otp).toMatch(/^\d{6}$/);
      expect(cooldown).toBe(60);
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should throw an error if requested within cooldown period', async () => {
      const state: OtpState = {
        hash: 'somehash',
        attempts: 0,
        createdAt: new Date().toISOString(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(state));
      
      await expect(service.generateOtp('user1', 'email-verification')).rejects.toThrow(/Please wait/);
    });

    it('should generate a new OTP if cooldown has passed', async () => {
      const pastDate = new Date(Date.now() - 61 * 1000).toISOString();
      const state: OtpState = {
        hash: 'somehash',
        attempts: 0,
        createdAt: pastDate,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(state));
      
      const { otp } = await service.generateOtp('user1', 'email-verification');
      
      expect(otp).toMatch(/^\d{6}$/);
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('should return false if OTP does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await service.verifyOtp('user1', 'email-verification', '123456');
      expect(result).toBe(false);
    });

    it('should return false and delete if max attempts reached', async () => {
      const state: OtpState = {
        hash: 'somehash',
        attempts: 5,
        createdAt: new Date().toISOString(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(state));
      
      const result = await service.verifyOtp('user1', 'email-verification', '123456');
      
      expect(result).toBe(false);
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should return false, increment attempt and update TTL if OTP is incorrect', async () => {
      // First we need to generate an OTP to know its plain value, or just mock the hash output.
      // Wait, we can't easily mock crypto.createHmac inside verifyOtp because it's synchronous inside the class.
      // Instead, we will pass an explicitly wrong string.
      const state: OtpState = {
        hash: 'some_real_hash',
        attempts: 0,
        createdAt: new Date().toISOString(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(state));
      mockRedis.ttl.mockResolvedValue(200);
      
      const result = await service.verifyOtp('user1', 'email-verification', '000000');
      
      expect(result).toBe(false);
      expect(mockRedis.set).toHaveBeenCalled();
      const setArgs = mockRedis.set.mock.calls[0];
      const savedState = JSON.parse(setArgs[1]);
      expect(savedState.attempts).toBe(1);
    });

    it('should return true and delete if OTP is correct', async () => {
      const crypto = require('crypto');
      const correctOtp = '123456';
      const hash = crypto.createHmac('sha256', 'test-secret').update(correctOtp).digest('hex');
      
      const state: OtpState = {
        hash: hash,
        attempts: 0,
        createdAt: new Date().toISOString(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(state));
      
      const result = await service.verifyOtp('user1', 'email-verification', correctOtp);
      
      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
