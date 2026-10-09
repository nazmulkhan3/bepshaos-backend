import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreatePaymentDto, PaymentQueryDto, PaymentSortBy } from './dto/index.js';
import { Prisma, PaymentDirection, PaymentStatus } from '@prisma/client';
import crypto from 'crypto';
import { Decimal } from 'decimal.js';
import { LedgerService } from '../ledger/ledger.service.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly ledgerService: LedgerService,
  ) {}

  private generateRequestHash(dto: CreatePaymentDto): string {
    const normalized = {
      branchId: dto.branchId,
      direction: dto.direction,
      customerId: dto.customerId || null,
      supplierId: dto.supplierId || null,
      amount: Number(dto.amount),
      method: dto.method,
      reference: dto.reference || null,
      note: dto.note || null,
      allocations: dto.allocations
        .map((a) => ({
          saleId: a.saleId || null,
          purchaseId: a.purchaseId || null,
          amount: Number(a.amount),
        }))
        .sort((a, b) => {
          const idA = a.saleId || a.purchaseId || '';
          const idB = b.saleId || b.purchaseId || '';
          return idA.localeCompare(idB);
        }),
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private async generatePaymentNumber(organizationId: string, tx: Prisma.TransactionClient): Promise<string> {
    const lastPayment = await tx.payment.findFirst({
      where: { organizationId },
      orderBy: { paymentNumber: 'desc' },
      select: { paymentNumber: true },
    });

    if (!lastPayment || !lastPayment.paymentNumber) {
      return 'PAY-000001';
    }

    const match = lastPayment.paymentNumber.match(/PAY-(\d+)/);
    if (!match) return 'PAY-000001';

    const lastNumber = parseInt(match[1], 10);
    return `PAY-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  async createPayment(organizationId: string, userId: string, dto: CreatePaymentDto) {
    // 10. PAYMENT PARTY RULES
    if (dto.customerId && dto.supplierId) {
      throw new BadRequestException('Payment cannot have both customer and supplier');
    }
    if (!dto.customerId && !dto.supplierId) {
      throw new BadRequestException('Payment must have either a customer or a supplier');
    }
    if (dto.direction === PaymentDirection.RECEIVED && dto.supplierId) {
      throw new BadRequestException('RECEIVED payment cannot have a supplier');
    }
    if (dto.direction === PaymentDirection.PAID && dto.customerId) {
      throw new BadRequestException('PAID payment cannot have a customer');
    }

    // Money rules
    const paymentAmount = new Decimal(dto.amount);
    if (paymentAmount.lte(0) || paymentAmount.isNaN()) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    let totalAllocationAmount = new Decimal(0);
    for (const alloc of dto.allocations) {
      const allocAmount = new Decimal(alloc.amount);
      if (allocAmount.lte(0) || allocAmount.isNaN()) {
        throw new BadRequestException('Allocation amount must be greater than 0');
      }
      totalAllocationAmount = totalAllocationAmount.plus(allocAmount);

      if (dto.direction === PaymentDirection.RECEIVED && alloc.purchaseId) {
        throw new BadRequestException('RECEIVED payment allocation must reference a Sale');
      }
      if (dto.direction === PaymentDirection.PAID && alloc.saleId) {
        throw new BadRequestException('PAID payment allocation must reference a Purchase');
      }
    }

    if (!totalAllocationAmount.equals(paymentAmount)) {
      throw new BadRequestException('Sum of allocation amounts must exactly equal the payment amount');
    }

    const requestHash = this.generateRequestHash(dto);
    if (dto.idempotencyKey) {
      const existingPayment = await this.prisma.payment.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        include: {
          allocations: true,
          branch: { select: { id: true, name: true, code: true } },
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
        },
      });

      if (existingPayment) {
        if (existingPayment.requestHash && existingPayment.requestHash !== requestHash) {
          throw new ConflictException('Idempotency key has already been used with a different request payload');
        }
        return existingPayment;
      }
    }

    // Sort allocations for deterministic locking
    const sortedAllocations = [...dto.allocations].sort((a, b) => {
      const idA = a.saleId || a.purchaseId || '';
      const idB = b.saleId || b.purchaseId || '';
      return idA.localeCompare(idB);
    });

    const uniqueSaleIds = new Set(dto.allocations.filter((a) => a.saleId).map((a) => a.saleId));
    const uniquePurchaseIds = new Set(dto.allocations.filter((a) => a.purchaseId).map((a) => a.purchaseId));

    if (uniqueSaleIds.size + uniquePurchaseIds.size !== dto.allocations.length) {
      throw new BadRequestException('Duplicate transaction references in allocations are not allowed');
    }

    let retries = 0;
    const maxRetries = 50;

    while (retries < maxRetries) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // Idempotency check inside transaction
            if (dto.idempotencyKey) {
              const concurrentPayment = await tx.payment.findUnique({
                where: {
                  organizationId_idempotencyKey: {
                    organizationId,
                    idempotencyKey: dto.idempotencyKey,
                  },
                },
                include: {
                  allocations: true,
                  branch: { select: { id: true, name: true, code: true } },
                  customer: { select: { id: true, name: true } },
                  supplier: { select: { id: true, name: true } },
                },
              });

              if (concurrentPayment) {
                if (concurrentPayment.requestHash && concurrentPayment.requestHash !== requestHash) {
                  throw new ConflictException('Idempotency key has already been used with a different request payload');
                }
                return concurrentPayment;
              }
            }

            // Verify branch
            const branch = await tx.branch.findFirst({
              where: { id: dto.branchId, organizationId },
            });
            if (!branch) {
              throw new NotFoundException('Branch not found in this organization');
            }

            // Verify customer/supplier
            if (dto.customerId) {
              const customer = await tx.customer.findFirst({
                where: { id: dto.customerId, organizationId },
              });
              if (!customer) throw new NotFoundException('Customer not found in this organization');
            }
            if (dto.supplierId) {
              const supplier = await tx.supplier.findFirst({
                where: { id: dto.supplierId, organizationId },
              });
              if (!supplier) throw new NotFoundException('Supplier not found in this organization');
            }

            // Lock and validate targets
            for (const alloc of sortedAllocations) {
              if (alloc.saleId) {
                // Lock the sale row
                const lockedSales = await tx.$queryRaw<any[]>`SELECT id FROM "Sale" WHERE id = ${alloc.saleId} FOR UPDATE`;
                if (!lockedSales.length) throw new NotFoundException(`Sale ${alloc.saleId} not found`);
                
                const sale = await tx.sale.findFirst({
                  where: { id: alloc.saleId, organizationId },
                  include: { paymentAllocations: { include: { payment: true } } },
                });
                
                if (!sale) throw new NotFoundException(`Sale ${alloc.saleId} not found in this organization`);
                if (sale.branchId !== dto.branchId) {
                  throw new BadRequestException(`Sale ${alloc.saleId} does not belong to the payment branch`);
                }
                if (sale.customerId !== dto.customerId) {
                  throw new BadRequestException(`Sale ${alloc.saleId} does not belong to the payment customer`);
                }

                // Calculate outstanding
                let totalCompletedAllocations = new Decimal(0);
                for (const existingAlloc of sale.paymentAllocations) {
                  if (existingAlloc.payment.status === PaymentStatus.COMPLETED) {
                    totalCompletedAllocations = totalCompletedAllocations.plus(existingAlloc.amount);
                  }
                }
                const outstanding = new Decimal(sale.totalAmount).minus(totalCompletedAllocations);
                const allocAmount = new Decimal(alloc.amount);
                if (allocAmount.gt(outstanding)) {
                  throw new ConflictException(`Allocation amount ${alloc.amount} exceeds outstanding amount ${outstanding.toString()} for sale ${alloc.saleId}`);
                }
              }

              if (alloc.purchaseId) {
                // Lock the purchase row
                const lockedPurchases = await tx.$queryRaw<any[]>`SELECT id FROM "Purchase" WHERE id = ${alloc.purchaseId} FOR UPDATE`;
                if (!lockedPurchases.length) throw new NotFoundException(`Purchase ${alloc.purchaseId} not found`);

                const purchase = await tx.purchase.findFirst({
                  where: { id: alloc.purchaseId, organizationId },
                  include: { paymentAllocations: { include: { payment: true } } },
                });

                if (!purchase) throw new NotFoundException(`Purchase ${alloc.purchaseId} not found in this organization`);
                if (purchase.branchId !== dto.branchId) {
                  throw new BadRequestException(`Purchase ${alloc.purchaseId} does not belong to the payment branch`);
                }
                if (purchase.supplierId !== dto.supplierId) {
                  throw new BadRequestException(`Purchase ${alloc.purchaseId} does not belong to the payment supplier`);
                }

                // Calculate outstanding
                let totalCompletedAllocations = new Decimal(0);
                for (const existingAlloc of purchase.paymentAllocations) {
                  if (existingAlloc.payment.status === PaymentStatus.COMPLETED) {
                    totalCompletedAllocations = totalCompletedAllocations.plus(existingAlloc.amount);
                  }
                }
                const outstanding = new Decimal(purchase.total).minus(totalCompletedAllocations);
                const allocAmount = new Decimal(alloc.amount);
                if (allocAmount.gt(outstanding)) {
                  throw new ConflictException(`Allocation amount ${alloc.amount} exceeds outstanding amount ${outstanding.toString()} for purchase ${alloc.purchaseId}`);
                }
              }
            }

            const paymentNumber = await this.generatePaymentNumber(organizationId, tx);

            const payment = await tx.payment.create({
              data: {
                organizationId,
                branchId: dto.branchId,
                customerId: dto.customerId || null,
                supplierId: dto.supplierId || null,
                direction: dto.direction,
                paymentNumber,
                amount: dto.amount,
                method: dto.method,
                reference: dto.reference || null,
                note: dto.note || null,
                idempotencyKey: dto.idempotencyKey,
                requestHash,
                createdBy: userId,
                status: PaymentStatus.COMPLETED,
                allocations: {
                  create: dto.allocations.map((a) => ({
                    saleId: a.saleId || null,
                    purchaseId: a.purchaseId || null,
                    amount: a.amount,
                  })),
                },
              },
              include: {
                allocations: true,
                branch: { select: { id: true, name: true, code: true } },
                customer: { select: { id: true, name: true } },
                supplier: { select: { id: true, name: true } },
              },
            });

            await tx.auditLog.create({
              data: {
                organizationId,
                action: 'PAYMENT_CREATED',
                entity: 'PAYMENT',
                entityId: payment.id,
                userId,
                newData: {
                  paymentNumber,
                  amount: dto.amount,
                  method: dto.method,
                  direction: dto.direction,
                },
              },
            });

            // Post payment journal (double-entry ledger)
            await this.ledgerService.postPaymentJournal(
              organizationId,
              {
                id: payment.id,
                branchId: payment.branchId,
                amount: payment.amount,
                direction: payment.direction,
                method: payment.method,
                customerId: payment.customerId,
                supplierId: payment.supplierId,
                createdBy: userId,
              },
              tx,
            );

            return payment;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          }
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          error.meta?.target &&
          (error.meta.target as string[]).includes('paymentNumber')
        ) {
          retries++;
          const jitter = Math.floor(Math.random() * 50);
          await new Promise((resolve) => setTimeout(resolve, 10 + jitter));
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Unable to generate a unique payment number after multiple attempts. Please try again.');
  }

  async voidPayment(organizationId: string, userId: string, paymentId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        // Lock payment
        const lockedPayments = await tx.$queryRaw<any[]>`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
        if (!lockedPayments.length) throw new NotFoundException('Payment not found');

        const payment = await tx.payment.findFirst({
          where: { id: paymentId, organizationId },
          include: { allocations: true },
        });

        if (!payment) {
          throw new NotFoundException('Payment not found in this organization');
        }

        if (payment.status === PaymentStatus.VOIDED) {
          return payment;
        }

        // Lock affected Sales/Purchases for consistency (avoid race condition with outstanding calc during concurrent payments)
        // Sort IDs deterministically
        const saleIds = Array.from(new Set(payment.allocations.filter((a) => a.saleId).map((a) => a.saleId as string))).sort((a, b) => a.localeCompare(b));
        const purchaseIds = Array.from(new Set(payment.allocations.filter((a) => a.purchaseId).map((a) => a.purchaseId as string))).sort((a, b) => a.localeCompare(b));

        for (const saleId of saleIds) {
          await tx.$queryRaw<any[]>`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`;
        }
        for (const purchaseId of purchaseIds) {
          await tx.$queryRaw<any[]>`SELECT id FROM "Purchase" WHERE id = ${purchaseId} FOR UPDATE`;
        }

        const updatedPayment = await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.VOIDED,
            voidedAt: new Date(),
            voidedBy: userId,
          },
          include: {
            allocations: true,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            action: 'PAYMENT_VOIDED',
            entity: 'PAYMENT',
            entityId: paymentId,
            userId,
            newData: {
              paymentNumber: payment.paymentNumber,
            },
          },
        });

        // Reverse payment journal (ledger)
        await this.ledgerService.reversePaymentJournal(
          organizationId,
          paymentId,
          userId,
          tx,
          payment.direction,
        );

        return updatedPayment;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      }
    );
  }

  async getPayments(organizationId: string, query: PaymentQueryDto) {
    const {
      page = 1,
      limit = 10,
      sortBy = PaymentSortBy.CREATED_AT,
      sortOrder = 'desc',
      branchId,
      customerId,
      supplierId,
      direction,
      status,
      method,
      startDate,
      endDate,
      search,
    } = query;

    const where: Prisma.PaymentWhereInput = { organizationId };

    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (supplierId) where.supplierId = supplierId;
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (method) where.method = method;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (search) {
      where.OR = [
        { paymentNumber: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          branch: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true, phone: true } },
          supplier: { select: { id: true, name: true, phone: true } },
        },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPaymentById(organizationId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organizationId },
      include: {
        allocations: {
          include: {
            sale: { select: { saleNumber: true } },
            purchase: { select: { purchaseNumber: true } },
          },
        },
        branch: { select: { id: true, name: true, code: true } },
        customer: { select: { id: true, name: true, phone: true } },
        supplier: { select: { id: true, name: true, phone: true } },
        creator: { select: { id: true, name: true, email: true } },
        voider: { select: { id: true, name: true, email: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }
}
