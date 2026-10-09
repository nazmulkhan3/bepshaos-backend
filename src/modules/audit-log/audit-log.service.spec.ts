import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service.js';
import { DatabaseService } from '../../database/database.service.js';

describe('AuditLogService (Security Hardening & Redaction)', () => {
  let service: AuditLogService;
  let db: any;

  beforeEach(async () => {
    db = {
      auditLog: {
        create: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Sensitive Data Redaction', () => {
    it('should recursively redact sensitive credentials (passwords, tokens, OTPs, secrets)', () => {
      const rawPayload = {
        name: 'Admin User',
        email: 'admin@bebshaos.com',
        password: 'PlainSecretPassword123!',
        refreshToken: 'rt_abc123xyz',
        otp: '982341',
        hashedOtp: '$2b$10$hashed',
        meta: {
          jwtSecret: 'super-secret',
          accessToken: 'bearer_token_val',
          cardNumber: '4111222233334444',
          cvv: '123',
          nested: {
            authHeader: 'Bearer 123456',
            publicInfo: 'Safe Value',
          },
        },
      };

      const redacted = service.redactSensitiveData(rawPayload);

      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.refreshToken).toBe('[REDACTED]');
      expect(redacted.otp).toBe('[REDACTED]');
      expect(redacted.hashedOtp).toBe('[REDACTED]');
      expect(redacted.meta.jwtSecret).toBe('[REDACTED]');
      expect(redacted.meta.accessToken).toBe('[REDACTED]');
      expect(redacted.meta.cardNumber).toBe('[REDACTED]');
      expect(redacted.meta.cvv).toBe('[REDACTED]');
      expect(redacted.meta.nested.publicInfo).toBe('Safe Value');
      expect(redacted.name).toBe('Admin User');
      expect(redacted.email).toBe('admin@bebshaos.com');
    });

    it('should handle array items with sensitive data', () => {
      const list = [
        { id: '1', password: 'secret1', role: 'ADMIN' },
        { id: '2', token: 'secret2', role: 'USER' },
      ];

      const redacted = service.redactSensitiveData(list);
      expect(redacted[0].password).toBe('[REDACTED]');
      expect(redacted[0].role).toBe('ADMIN');
      expect(redacted[1].token).toBe('[REDACTED]');
    });

    it('should sanitize both oldData and newData before persisting audit log', async () => {
      const payload = {
        action: 'UPDATE_CREDENTIALS',
        entity: 'User',
        entityId: 'usr-1',
        organizationId: 'org-1',
        userId: 'usr-admin',
        oldData: { password: 'old-password-123' },
        newData: { password: 'new-password-456', status: 'ACTIVE' },
      };

      await service.logAction(payload);

      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE_CREDENTIALS',
          oldData: { password: '[REDACTED]' },
          newData: { password: '[REDACTED]', status: 'ACTIVE' },
        }),
      });
    });
  });
});
