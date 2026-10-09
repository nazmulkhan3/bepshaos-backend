import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import { PasswordService } from './password.service.js';

@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwordService: PasswordService,
  ) {}

  async createSession(userId: string, refreshToken: string, expiresAt: Date, deviceInfo?: string, ipAddress?: string) {
    const refreshTokenHash = await this.passwordService.hash(refreshToken);
    
    return this.db.session.create({
      data: {
        userId,
        refreshTokenHash,
        expiresAt,
        deviceInfo,
        ipAddress,
      },
    });
  }

  async verifySession(sessionId: string, refreshToken: string) {
    const session = await this.db.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return null;
    }

    const isValid = await this.passwordService.verify(session.refreshTokenHash, refreshToken);
    if (!isValid) {
      // Refresh token reuse detected or invalid token
      await this.revokeAllSessions(session.userId);
      return null;
    }

    return session;
  }

  async revokeSession(sessionId: string) {
    return this.db.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string) {
    return this.db.session.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async rotateSession(sessionId: string, newRefreshToken: string, newExpiresAt: Date, deviceInfo?: string, ipAddress?: string) {
    const oldSession = await this.db.session.findUnique({ where: { id: sessionId }});
    if (!oldSession) {
      throw new Error('Session not found');
    }

    // Revoke old session
    await this.revokeSession(sessionId);

    // Create new session
    return this.createSession(oldSession.userId, newRefreshToken, newExpiresAt, deviceInfo, ipAddress);
  }
}
