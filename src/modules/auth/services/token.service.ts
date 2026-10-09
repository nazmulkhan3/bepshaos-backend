import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { SessionService } from './session.service.js';

export interface TokenPayload {
  sub: string;
  sessionId: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
  ) {}

  async generateAuthTokens(userId: string, deviceInfo?: string, ipAddress?: string) {
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const refreshExpiresInStr = this.configService.get<string>('jwt.refreshExpiresIn') || '7d';
    
    // Parse '7d' etc to ms roughly for date, or just hardcode for simplicity.
    // Assuming 7 days:
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(refreshExpiresInStr.replace(/[^0-9]/g, '')) || 7);

    const session = await this.sessionService.createSession(userId, refreshToken, expiresAt, deviceInfo, ipAddress);

    const payload: TokenPayload = {
      sub: userId,
      sessionId: session.id,
    };

    const accessToken = await this.jwtService.signAsync(payload as any, {
      secret: this.configService.get<string>('jwt.accessSecret'),
      expiresIn: (this.configService.get<string>('jwt.accessExpiresIn') || '15m') as any,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async rotateTokens(sessionId: string, oldRefreshToken: string, deviceInfo?: string, ipAddress?: string) {
    const session = await this.sessionService.verifySession(sessionId, oldRefreshToken);
    if (!session) {
      throw new Error('Invalid or expired refresh token');
    }

    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const newSession = await this.sessionService.rotateSession(sessionId, newRefreshToken, expiresAt, deviceInfo, ipAddress);

    const payload: TokenPayload = {
      sub: newSession.userId,
      sessionId: newSession.id,
    };

    const accessToken = await this.jwtService.signAsync(payload as any, {
      secret: this.configService.get<string>('jwt.accessSecret'),
      expiresIn: (this.configService.get<string>('jwt.accessExpiresIn') || '15m') as any,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  async generateResetToken(userId: string) {
    return this.jwtService.signAsync(
      { sub: userId, resetAuth: true } as any,
      {
        secret: this.configService.get<string>('jwt.accessSecret'),
        expiresIn: '15m' as any,
      }
    );
  }

  async verifyResetToken(token: string) {
    return this.jwtService.verifyAsync(token, {
      secret: this.configService.get<string>('jwt.accessSecret'),
    });
  }
}
