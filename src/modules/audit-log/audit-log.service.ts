import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { Prisma } from '@prisma/client';

export interface AuditLogQueryDto {
  organizationId?: string;
  userId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: DatabaseService) {}

  private static readonly SENSITIVE_KEYS = new Set([
    'password',
    'passwordhash',
    'refreshtoken',
    'refreshtokenhash',
    'otp',
    'hashedotp',
    'secret',
    'jwtsecret',
    'jwtaccesssecret',
    'jwtrefreshsecret',
    'token',
    'accesstoken',
    'cardnumber',
    'cvv',
    'authorization',
  ]);

  /**
   * Recursively sanitize sensitive keys in payloads to prevent leaking secrets in audit trails
   */
  redactSensitiveData(val: any): any {
    if (val === null || val === undefined) return val;
    if (typeof val !== 'object') return val;

    if (Array.isArray(val)) {
      return val.map((item) => this.redactSensitiveData(item));
    }

    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      const normalizedKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (AuditLogService.SENSITIVE_KEYS.has(normalizedKey)) {
        sanitized[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null) {
        sanitized[k] = this.redactSensitiveData(v);
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  /**
   * Record a platform or tenant administrative action in the AuditLog table
   */
  async logAction(data: {
    action: string;
    entity: string;
    entityId: string;
    organizationId?: string | null;
    userId?: string | null;
    oldData?: any;
    newData?: any;
    ipAddress?: string;
    userAgent?: string;
  }, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;

    try {
      const sanitizedOld = this.redactSensitiveData(data.oldData);
      const sanitizedNew = this.redactSensitiveData(data.newData);

      return await client.auditLog.create({
        data: {
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          organizationId: data.organizationId || null,
          userId: data.userId || null,
          oldData: sanitizedOld !== undefined ? (sanitizedOld as Prisma.InputJsonValue) : Prisma.JsonNull,
          newData: sanitizedNew !== undefined ? (sanitizedNew as Prisma.InputJsonValue) : Prisma.JsonNull,
          ipAddress: data.ipAddress || null,
          userAgent: data.userAgent || null,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to record audit log: ${err.message}`, err.stack);
      // Non-blocking fallback unless in a strict transaction
    }
  }

  /**
   * Platform Admin: Query audit logs with multi-tenant filtering
   */
  async queryLogs(query: AuditLogQueryDto) {
    const limit = Math.min(query.limit || 50, 100);
    const offset = query.offset || 0;

    const where: Prisma.AuditLogWhereInput = {
      ...(query.organizationId && { organizationId: query.organizationId }),
      ...(query.userId && { userId: query.userId }),
      ...(query.action && { action: query.action }),
      ...(query.entity && { entity: query.entity }),
      ...(query.entityId && { entityId: query.entityId }),
    };

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      data: logs,
    };
  }
}
