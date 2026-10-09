import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';

export interface OtpState {
  hash: string;
  attempts: number;
  createdAt: string;
}

@Injectable()
export class OtpService {
  private readonly length: number;
  private readonly expiresInSeconds: number;
  private readonly maxAttempts: number;
  private readonly resendCooldownSeconds: number;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.length = this.configService.get<number>('otp.length') || 6;
    this.expiresInSeconds = this.configService.get<number>('otp.expiresInSeconds') || 300;
    this.maxAttempts = this.configService.get<number>('otp.maxAttempts') || 5;
    this.resendCooldownSeconds = this.configService.get<number>('otp.resendCooldownSeconds') || 60;
  }

  private getKey(userId: string, type: 'email-verification' | 'password-reset'): string {
    return `bebshaos:otp:${type}:${userId}`;
  }

  private hashOtp(otp: string): string {
    const secret = this.configService.get<string>('OTP_HASH_SECRET');
    if (!secret) {
      throw new Error('OTP_HASH_SECRET is not configured');
    }
    return crypto.createHmac('sha256', secret).update(otp).digest('hex');
  }

  async generateOtp(userId: string, type: 'email-verification' | 'password-reset'): Promise<{ otp: string; cooldown: number }> {
    const key = this.getKey(userId, type);
    const existing = await this.redis.get(key);

    if (existing) {
      const state: OtpState = JSON.parse(existing);
      const elapsed = (Date.now() - new Date(state.createdAt).getTime()) / 1000;
      if (elapsed < this.resendCooldownSeconds) {
        throw new Error(`Please wait ${Math.ceil(this.resendCooldownSeconds - elapsed)} seconds before requesting a new OTP.`);
      }
    }

    const min = Math.pow(10, this.length - 1);
    const max = Math.pow(10, this.length) - 1;
    const otp = crypto.randomInt(min, max + 1).toString();

    const state: OtpState = {
      hash: this.hashOtp(otp),
      attempts: 0,
      createdAt: new Date().toISOString(),
    };

    await this.redis.set(key, JSON.stringify(state), 'EX', this.expiresInSeconds);

    return { otp, cooldown: this.resendCooldownSeconds };
  }

  async verifyOtp(userId: string, type: 'email-verification' | 'password-reset', submittedOtp: string): Promise<boolean> {
    const key = this.getKey(userId, type);
    const existing = await this.redis.get(key);

    if (!existing) {
      return false;
    }

    const state: OtpState = JSON.parse(existing);

    if (state.attempts >= this.maxAttempts) {
      await this.redis.del(key);
      return false;
    }

    state.attempts += 1;
    
    if (this.hashOtp(submittedOtp) === state.hash) {
      await this.redis.del(key);
      return true;
    } else {
      const ttl = await this.redis.ttl(key);
      if (ttl > 0) {
        await this.redis.set(key, JSON.stringify(state), 'EX', ttl);
      }
      return false;
    }
  }

  async invalidateOtp(userId: string, type: 'email-verification' | 'password-reset'): Promise<void> {
    await this.redis.del(this.getKey(userId, type));
  }
}
