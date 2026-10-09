import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/database.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import * as crypto from 'crypto';

@Injectable()
export class InvoiceService {
  constructor(private prisma: DatabaseService) {}

  private generateRequestHash(dto: any): string {
    const normalized = {
      saleId: dto.saleId,
      dueDate: dto.dueDate,
      note: dto.note,
      terms: dto.terms,
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private async generateInvoiceNumber(organizationId: string, tx: Prisma.TransactionClient): Promise<string> {
    const lastInvoice = await tx.invoice.findFirst({
      where: { organizationId },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });

    if (!lastInvoice || !lastInvoice.invoiceNumber) {
      return 'INV-000001';
    }

    const match = lastInvoice.invoiceNumber.match(/INV-(\d+)/);
    if (!match) return 'INV-000001';

    const lastNumber = parseInt(match[1], 10);
    return `INV-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  async create(organizationId: string, userId: string, dto: CreateInvoiceDto) {
    const requestHash = this.generateRequestHash(dto);
    if (dto.idempotencyKey) {
      const existing = await this.prisma.invoice.findUnique({
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
              const concurrent = await tx.invoice.findUnique({
                where: {
                  organizationId_idempotencyKey: {
                    organizationId,
                    idempotencyKey: dto.idempotencyKey,
                  },
                },
              });
              if (concurrent) return concurrent;
            }

            const sale = await tx.sale.findUnique({
              where: { id: dto.saleId },
            });
            if (!sale || sale.organizationId !== organizationId) {
              throw new NotFoundException('Sale not found');
            }

            const existingInvoice = await tx.invoice.findUnique({
              where: { saleId: dto.saleId },
            });
            if (existingInvoice) {
              throw new ConflictException('Invoice already exists for this sale');
            }

            const invoiceNumber = await this.generateInvoiceNumber(organizationId, tx);

            const invoice = await tx.invoice.create({
              data: {
                organizationId,
                saleId: dto.saleId,
                invoiceNumber,
                dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
                note: dto.note,
                terms: dto.terms,
                idempotencyKey: dto.idempotencyKey,
                createdBy: userId,
              },
            });

            await tx.sale.update({
              where: { id: sale.id },
              data: { invoiceNumber },
            });

            await tx.auditLog.create({
              data: {
                organizationId,
                userId,
                action: 'INVOICE_CREATED',
                entity: 'Invoice',
                entityId: invoice.id,
                newData: {
                  invoiceNumber: invoice.invoiceNumber,
                  saleId: invoice.saleId,
                },
              },
            });

            return invoice;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 20000,
            timeout: 30000,
          }
        );
      } catch (error: any) {
        const isUniqueCollision = error.code === 'P2002';
        if (isUniqueCollision && (error.meta?.target?.includes('invoiceNumber') || error.meta?.target?.includes('idempotencyKey'))) {
          retries++;
          const jitter = Math.floor(Math.random() * 20);
          await new Promise((resolve) => setTimeout(resolve, jitter));
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not generate unique invoice number after multiple attempts');
  }

  async findAll(organizationId: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { sale: true },
    });
  }

  async findOne(organizationId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: { sale: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async update(organizationId: string, userId: string, id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.findOne(organizationId, id);
    
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.invoice.update({
        where: { id },
        data: {
          status: dto.status,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          note: dto.note,
          terms: dto.terms,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'INVOICE_UPDATED',
          entity: 'Invoice',
          entityId: id,
          newData: dto as any,
        },
      });

      return updated;
    });
  }
}
