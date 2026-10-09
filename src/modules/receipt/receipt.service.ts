import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/database.service.js';
import { CreateReceiptDto } from './dto/create-receipt.dto.js';
import { UpdateReceiptDto } from './dto/update-receipt.dto.js';
import * as crypto from 'crypto';

@Injectable()
export class ReceiptService {
  constructor(private prisma: DatabaseService) {}

  private generateRequestHash(dto: any): string {
    const normalized = {
      paymentId: dto.paymentId,
      note: dto.note,
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private async generateReceiptNumber(organizationId: string, tx: Prisma.TransactionClient): Promise<string> {
    const lastReceipt = await tx.receipt.findFirst({
      where: { organizationId },
      orderBy: { receiptNumber: 'desc' },
      select: { receiptNumber: true },
    });

    if (!lastReceipt || !lastReceipt.receiptNumber) {
      return 'RCT-000001';
    }

    const match = lastReceipt.receiptNumber.match(/RCT-(\d+)/);
    if (!match) return 'RCT-000001';

    const lastNumber = parseInt(match[1], 10);
    return `RCT-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  async create(organizationId: string, userId: string, dto: CreateReceiptDto) {
    const requestHash = this.generateRequestHash(dto);
    if (dto.idempotencyKey) {
      const existing = await this.prisma.receipt.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });
      if (existing) {
        return existing;
      }
    }

    let retries = 0;
    const maxRetries = 50;

    while (retries < maxRetries) {
      try {
        return await this.prisma.$transaction(
          async (tx: Prisma.TransactionClient) => {
            if (dto.idempotencyKey) {
              const concurrent = await tx.receipt.findUnique({
                where: {
                  organizationId_idempotencyKey: {
                    organizationId,
                    idempotencyKey: dto.idempotencyKey,
                  },
                },
              });
              if (concurrent) return concurrent;
            }

            const payment = await tx.payment.findUnique({
              where: { id: dto.paymentId },
            });
            if (!payment || payment.organizationId !== organizationId) {
              throw new NotFoundException('Payment not found');
            }

            const existingReceipt = await tx.receipt.findUnique({
              where: { paymentId: dto.paymentId },
            });
            if (existingReceipt) {
              throw new ConflictException('Receipt already exists for this payment');
            }

            const receiptNumber = await this.generateReceiptNumber(organizationId, tx);

            const receipt = await tx.receipt.create({
              data: {
                organizationId,
                paymentId: dto.paymentId,
                receiptNumber,
                note: dto.note,
                idempotencyKey: dto.idempotencyKey,
                createdBy: userId,
              },
            });

            await tx.auditLog.create({
              data: {
                organizationId,
                userId,
                action: 'RECEIPT_CREATED',
                entity: 'Receipt',
                entityId: receipt.id,
                newData: {
                  receiptNumber: receipt.receiptNumber,
                  paymentId: receipt.paymentId,
                },
              },
            });

            return receipt;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 20000,
            timeout: 30000,
          }
        );
      } catch (error: any) {
        const isUniqueCollision = error.code === 'P2002';
        if (isUniqueCollision && (error.meta?.target?.includes('receiptNumber') || error.meta?.target?.includes('idempotencyKey'))) {
          retries++;
          const jitter = Math.floor(Math.random() * 20);
          await new Promise((resolve) => setTimeout(resolve, jitter));
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not generate unique receipt number after multiple attempts');
  }

  async findAll(organizationId: string) {
    return this.prisma.receipt.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { payment: true },
    });
  }

  async findOne(organizationId: string, id: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { id, organizationId },
      include: { payment: true },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  async update(organizationId: string, userId: string, id: string, dto: UpdateReceiptDto) {
    const receipt = await this.findOne(organizationId, id);
    
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.receipt.update({
        where: { id },
        data: {
          status: dto.status,
          note: dto.note,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'RECEIPT_UPDATED',
          entity: 'Receipt',
          entityId: id,
          newData: dto as any,
        },
      });

      return updated;
    });
  }
}
