import { NotificationQueueService } from '../notification/notification.queue.service.js';
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateSaleDto, SaleQueryDto, CancelSaleDto } from './dto/index.js';
import {
  Prisma,
  SaleStatus,
  InventoryMovementType,
  BranchStatus,
  CustomerStatus,
  ProductStatus,
} from '@prisma/client';
import crypto from 'crypto';
import { LedgerService } from '../ledger/ledger.service.js';


@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(private readonly prisma: DatabaseService,
    private readonly ledgerService: LedgerService,private readonly notificationQueue: NotificationQueueService) {}

  /**
   * Helper to generate a deterministic hash of the creation payload
   */
  private generateRequestHash(dto: CreateSaleDto): string {
    const normalized = {
      branchId: dto.branchId,
      customerId: dto.customerId || null,
      items: dto.items
        .map((i) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice !== undefined ? Number(i.unitPrice) : null,
          discountAmount: Number(i.discountAmount || 0),
          taxAmount: Number(i.taxAmount || 0),
        }))
        .sort((a, b) => a.productId.localeCompare(b.productId)),
      discountAmount: Number(dto.discountAmount || 0),
      taxAmount: Number(dto.taxAmount || 0),
      note: dto.note || null,
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  /**
   * Generates next organization-scoped sale number (e.g. SALE-000001)
   */
  private async generateSaleNumber(organizationId: string, tx: Prisma.TransactionClient): Promise<string> {
    const lastSale = await tx.sale.findFirst({
      where: { organizationId },
      orderBy: { saleNumber: 'desc' },
      select: { saleNumber: true },
    });

    if (!lastSale || !lastSale.saleNumber) {
      return 'SALE-000001';
    }

    const match = lastSale.saleNumber.match(/SALE-(\d+)/);
    if (!match) return 'SALE-000001';

    const lastNumber = parseInt(match[1], 10);
    return `SALE-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  /**
   * Atomically creates a Sale, locks inventory, checks stock, deducts stock,
   * creates InventoryMovements and AuditLog in ONE transaction.
   */
  async create(organizationId: string, userId: string, dto: CreateSaleDto) {
    // 1. Validate items
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Sale must contain at least one item');
    }

    const productIds = dto.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Duplicate products in sale items are not allowed. Combine quantities instead.'
      );
    }

    for (const item of dto.items) {
      if (item.quantity <= 0) {
        throw new BadRequestException(`Quantity must be greater than 0 for product ${item.productId}`);
      }
      if (item.unitPrice !== undefined && item.unitPrice < 0) {
        throw new BadRequestException(`Unit price cannot be negative for product ${item.productId}`);
      }
    }

    // 2. Idempotency pre-check
    const requestHash = this.generateRequestHash(dto);
    if (dto.idempotencyKey) {
      const existingSale = await this.prisma.sale.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true, unit: true } },
            },
          },
          branch: { select: { id: true, name: true, code: true } },
          customer: { select: { id: true, name: true, phone: true, customerCode: true } },
        },
      });

      if (existingSale) {
        if (existingSale.requestHash && existingSale.requestHash !== requestHash) {
          throw new ConflictException('Idempotency key has already been used with a different request payload');
        }
        return existingSale;
      }
    }

    // 3. Execution with retry on unique collision (e.g. saleNumber concurrency)
    let retries = 0;
    const maxRetries = 50;

    while (retries < maxRetries) {
      try {
        const sale = await this.prisma.$transaction(
          async (tx) => {
            // Concurrent idempotency check inside transaction
            if (dto.idempotencyKey) {
              const concurrentSale = await tx.sale.findUnique({
                where: {
                  organizationId_idempotencyKey: {
                    organizationId,
                    idempotencyKey: dto.idempotencyKey,
                  },
                },
                include: {
                  items: {
                    include: {
                      product: { select: { id: true, name: true, sku: true, unit: true } },
                    },
                  },
                  branch: { select: { id: true, name: true, code: true } },
                  customer: { select: { id: true, name: true, phone: true, customerCode: true } },
                },
              });

              if (concurrentSale) {
                if (concurrentSale.requestHash && concurrentSale.requestHash !== requestHash) {
                  throw new ConflictException(
                    'Idempotency key has already been used with a different request payload'
                  );
                }
                return concurrentSale;
              }
            }

            // Validate branch
            const branch = await tx.branch.findUnique({
              where: { id: dto.branchId },
            });
            if (!branch || branch.organizationId !== organizationId) {
              throw new NotFoundException('Branch not found');
            }
            if (branch.status !== BranchStatus.ACTIVE) {
              throw new ConflictException('Cannot create sale for inactive branch');
            }

            // Validate customer if provided
            if (dto.customerId) {
              const customer = await tx.customer.findUnique({
                where: { id: dto.customerId },
              });
              if (!customer || customer.organizationId !== organizationId || customer.deletedAt) {
                throw new NotFoundException('Customer not found');
              }
              if (customer.status !== CustomerStatus.ACTIVE) {
                throw new ConflictException('Cannot create sale for inactive or archived customer');
              }
            }

            // Validate products
            const products = await tx.product.findMany({
              where: {
                id: { in: productIds },
                organizationId,
                deletedAt: null,
              },
            });

            if (products.length !== productIds.length) {
              throw new NotFoundException('One or more products not found');
            }

            const productMap = new Map(products.map((p) => [p.id, p]));
            for (const p of products) {
              if (p.status === ProductStatus.DISCONTINUED || p.status === ProductStatus.INACTIVE) {
                throw new ConflictException(
                  `Cannot create sale for inactive or discontinued product: ${p.name}`
                );
              }
            }

            // Deterministic row locking (lexicographical by productId to prevent deadlocks)
            const sortedItems = [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId));
            const lockedInventories: Record<string, { id: string; quantity: Prisma.Decimal }> = {};

            for (const item of sortedItems) {
              let inventory = await tx.inventory.findFirst({
                where: {
                  organizationId,
                  branchId: dto.branchId,
                  productId: item.productId,
                },
              });

              if (!inventory) {
                try {
                  inventory = await tx.inventory.create({
                    data: {
                      organizationId,
                      branchId: dto.branchId,
                      productId: item.productId,
                      quantity: 0,
                    },
                  });
                } catch (err: any) {
                  if (err.code === 'P2002') {
                    inventory = await tx.inventory.findFirst({
                      where: {
                        organizationId,
                        branchId: dto.branchId,
                        productId: item.productId,
                      },
                    });
                  } else {
                    throw err;
                  }
                }
              }

              if (!inventory) {
                throw new NotFoundException(`Inventory record could not be found or created for product ${item.productId}`);
              }

              // Lock row exclusively
              const lockedRows = await tx.$queryRaw<{ id: string; quantity: any }[]>`
                SELECT id, quantity 
                FROM "Inventory" 
                WHERE id = ${inventory.id} 
                FOR UPDATE
              `;

              if (!lockedRows || lockedRows.length === 0) {
                throw new NotFoundException(`Inventory record could not be locked`);
              }

              const locked = lockedRows[0];
              const currentQty = new Prisma.Decimal(locked.quantity);
              const requestedQty = new Prisma.Decimal(item.quantity);

              if (currentQty.lt(requestedQty)) {
                const prod = productMap.get(item.productId);
                throw new ConflictException(
                  `Insufficient stock for product ${prod?.name || item.productId}. Current: ${currentQty.toString()}, Requested: ${requestedQty.toString()}`
                );
              }

              lockedInventories[item.productId] = {
                id: locked.id,
                quantity: currentQty,
              };
            }

            // Generate sale number
            const saleNumber = await this.generateSaleNumber(organizationId, tx);

            // Money Calculations using Prisma.Decimal
            let calculatedSubtotal = new Prisma.Decimal(0);
            let calculatedItemDiscount = new Prisma.Decimal(0);
            let calculatedItemTax = new Prisma.Decimal(0);

            const preparedItems = sortedItems.map((item) => {
              const product = productMap.get(item.productId)!;
              const unitPrice =
                item.unitPrice !== undefined
                  ? new Prisma.Decimal(item.unitPrice)
                  : new Prisma.Decimal(product.sellingPrice);
              const qty = new Prisma.Decimal(item.quantity);
              const itemDiscount = new Prisma.Decimal(item.discountAmount ?? 0);
              const itemTax = new Prisma.Decimal(item.taxAmount ?? 0);

              const itemSubtotal = qty.mul(unitPrice);
              const lineTotal = itemSubtotal.minus(itemDiscount).plus(itemTax);

              if (lineTotal.isNegative()) {
                throw new BadRequestException(`Line total cannot be negative for product ${product.name}`);
              }

              calculatedSubtotal = calculatedSubtotal.plus(itemSubtotal);
              calculatedItemDiscount = calculatedItemDiscount.plus(itemDiscount);
              calculatedItemTax = calculatedItemTax.plus(itemTax);

              return {
                productId: item.productId,
                quantity: qty,
                unitPrice,
                discountAmount: itemDiscount,
                taxAmount: itemTax,
                lineTotal,
              };
            });

            const overallDiscount = new Prisma.Decimal(dto.discountAmount ?? 0);
            const overallTax = new Prisma.Decimal(dto.taxAmount ?? 0);

            const totalDiscount = calculatedItemDiscount.plus(overallDiscount);
            const totalTax = calculatedItemTax.plus(overallTax);
            const totalAmount = calculatedSubtotal.minus(totalDiscount).plus(totalTax);

            if (totalAmount.isNegative()) {
              throw new BadRequestException('Total sale amount cannot be negative');
            }

            // Create Sale and SaleItems
            const sale = await tx.sale.create({
              data: {
                organizationId,
                branchId: dto.branchId,
                customerId: dto.customerId || null,
                saleNumber,
                invoiceNumber: saleNumber,
                status: SaleStatus.COMPLETED,
                subtotal: calculatedSubtotal,
                discountAmount: totalDiscount,
                taxAmount: totalTax,
                totalAmount,
                paidAmount: totalAmount,
                note: dto.note || null,
                idempotencyKey: dto.idempotencyKey || null,
                requestHash,
                createdBy: userId,
                items: {
                  create: preparedItems.map((pi) => ({
                    productId: pi.productId,
                    quantity: pi.quantity,
                    unitPrice: pi.unitPrice,
                    discountAmount: pi.discountAmount,
                    taxAmount: pi.taxAmount,
                    lineTotal: pi.lineTotal,
                  })),
                },
              },
              include: {
                items: {
                  include: {
                    product: { select: { id: true, name: true, sku: true, unit: true } },
                  },
                },
                branch: { select: { id: true, name: true, code: true } },
                customer: { select: { id: true, name: true, phone: true, customerCode: true } },
              },
            });

            // Deduct stock and write InventoryMovements
            for (const pi of preparedItems) {
              const locked = lockedInventories[pi.productId];
              const newQty = locked.quantity.minus(pi.quantity);

              await tx.inventory.update({
                where: { id: locked.id },
                data: { quantity: newQty.toNumber() },
              });

              await tx.inventoryMovement.create({
                data: {
                  organizationId,
                  branchId: dto.branchId,
                  productId: pi.productId,
                  movementType: InventoryMovementType.STOCK_OUT,
                  referenceType: 'SALE',
                  referenceId: sale.id,
                  quantity: pi.quantity.toNumber(),
                  beforeQuantity: locked.quantity.toNumber(),
                  afterQuantity: newQty.toNumber(),
                  note: `Sale ${saleNumber}`,
                  createdBy: userId,
                },
              });
            }

            // Audit log
            await tx.auditLog.create({
              data: {
                organizationId,
                userId,
                action: 'SALE_CREATED',
                entity: 'Sale',
                entityId: sale.id,
                newData: {
                  saleNumber: sale.saleNumber,
                  branchId: sale.branchId,
                  customerId: sale.customerId,
                  totalAmount: sale.totalAmount.toNumber(),
                  itemCount: sale.items.length,
                },
              },
            });

            // Post sale journal (double-entry ledger)
            await this.ledgerService.postSaleJournal(
              organizationId,
              {
                id: sale.id,
                branchId: sale.branchId,
                totalAmount: sale.totalAmount,
                customerId: sale.customerId,
                createdBy: userId,
              },
              tx,
            );

            return sale;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 20000,
            timeout: 30000,
          }
        );

        await this.notificationQueue.enqueue({
          userId,
          organizationId,
          type: 'SALE_COMPLETED',
          title: 'Sale Completed',
          message: `Sale ${sale.saleNumber} has been successfully completed.`,
          entityType: 'Sale',
          entityId: sale.id,
        });

        return sale;
      } catch (error: any) {
        const isSaleNumberCollision =
          error.code === 'P2002' &&
          (JSON.stringify(error.meta || {}).includes('saleNumber') ||
            error.message?.includes('saleNumber'));

        const isIdempotencyCollision =
          error.code === 'P2002' &&
          (JSON.stringify(error.meta || {}).includes('idempotencyKey') ||
            error.message?.includes('idempotencyKey'));

        if (isIdempotencyCollision && dto.idempotencyKey) {
          // A concurrent request finished first with this key
          const existingSale = await this.prisma.sale.findUnique({
            where: {
              organizationId_idempotencyKey: {
                organizationId,
                idempotencyKey: dto.idempotencyKey,
              },
            },
            include: {
              items: {
                include: {
                  product: { select: { id: true, name: true, sku: true, unit: true } },
                },
              },
              branch: { select: { id: true, name: true, code: true } },
              customer: { select: { id: true, name: true, phone: true, customerCode: true } },
            },
          });
          if (existingSale) {
            if (existingSale.requestHash && existingSale.requestHash !== requestHash) {
              throw new ConflictException(
                'Idempotency key has already been used with a different request payload'
              );
            }
            return existingSale;
          }
        }

        if (isSaleNumberCollision) {
          retries++;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.floor(Math.random() * 50 * retries + 20))
          );
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException('Failed to generate a unique sale number after multiple attempts. Please retry.');
  }

  /**
   * Find a sale by ID ensuring strict tenant isolation
   */
  async findOne(organizationId: string, id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true } },
          },
        },
        branch: { select: { id: true, name: true, code: true } },
        customer: { select: { id: true, name: true, phone: true, customerCode: true } },
        creator: { select: { id: true, name: true, email: true } },
        canceller: { select: { id: true, name: true, email: true } },
      },
    });

    if (!sale || sale.organizationId !== organizationId) {
      throw new NotFoundException('Sale not found');
    }

    return sale;
  }

  /**
   * List sales with pagination, search, branch, customer, status, date filtering
   */
  async findAll(organizationId: string, query: SaleQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      branchId,
      customerId,
      status,
      dateFrom,
      dateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query as any;

    const skip = (page - 1) * limit;
    const where: Prisma.SaleWhereInput = { organizationId };

    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const orderBy: Prisma.SaleOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true, unit: true } },
            },
          },
          branch: { select: { id: true, name: true, code: true } },
          customer: { select: { id: true, name: true, phone: true, customerCode: true } },
        },
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.sale.count({ where }),
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

  /**
   * Atomically cancels a COMPLETED sale, restores inventory stock,
   * creates compensating InventoryMovements and AuditLog.
   */
  async cancel(organizationId: string, saleId: string, userId: string, dto?: CancelSaleDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        items: true,
      },
    });

    if (!sale || sale.organizationId !== organizationId) {
      throw new NotFoundException('Sale not found');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Lock the sale row first to prevent concurrent cancellation races
        const lockedRows = await tx.$queryRaw<{ status: string }[]>`
          SELECT status 
          FROM "Sale" 
          WHERE id = ${sale.id} 
          FOR UPDATE
        `;

        if (!lockedRows || lockedRows.length === 0) {
          throw new NotFoundException('Sale not found');
        }

        const currentStatus = lockedRows[0].status;

        if (currentStatus === SaleStatus.CANCELLED) {
          // Idempotent success if already cancelled
          return this.findOne(organizationId, saleId);
        }

        if (currentStatus !== SaleStatus.COMPLETED) {
          throw new ConflictException(`Cannot cancel sale with status ${currentStatus}`);
        }
        // Deterministic row locking (lexicographical by productId to prevent deadlocks)
        const sortedItems = [...sale.items].sort((a, b) => a.productId.localeCompare(b.productId));

        for (const item of sortedItems) {
          let inventory = await tx.inventory.findFirst({
            where: {
              organizationId,
              branchId: sale.branchId,
              productId: item.productId,
            },
          });

          if (!inventory) {
            try {
              inventory = await tx.inventory.create({
                data: {
                  organizationId,
                  branchId: sale.branchId,
                  productId: item.productId,
                  quantity: 0,
                },
              });
            } catch (err: any) {
              if (err.code === 'P2002') {
                inventory = await tx.inventory.findFirst({
                  where: {
                    organizationId,
                    branchId: sale.branchId,
                    productId: item.productId,
                  },
                });
              } else {
                throw err;
              }
            }
          }

          if (!inventory) {
            throw new NotFoundException(`Inventory record could not be found or created for product ${item.productId}`);
          }

          const lockedRows = await tx.$queryRaw<{ id: string; quantity: any }[]>`
            SELECT id, quantity 
            FROM "Inventory" 
            WHERE id = ${inventory.id} 
            FOR UPDATE
          `;

          if (!lockedRows || lockedRows.length === 0) {
            throw new NotFoundException(`Inventory record could not be locked`);
          }

          const currentQty = new Prisma.Decimal(lockedRows[0].quantity);
          const restoreQty = new Prisma.Decimal(item.quantity);
          const newQty = currentQty.plus(restoreQty);

          await tx.inventory.update({
            where: { id: inventory.id },
            data: { quantity: newQty.toNumber() },
          });

          await tx.inventoryMovement.create({
            data: {
              organizationId,
              branchId: sale.branchId,
              productId: item.productId,
              movementType: InventoryMovementType.STOCK_IN,
              referenceType: 'SALE_CANCEL',
              referenceId: sale.id,
              quantity: restoreQty.toNumber(),
              beforeQuantity: currentQty.toNumber(),
              afterQuantity: newQty.toNumber(),
              note: dto?.reason ? `Sale cancelled: ${dto.reason}` : `Sale cancelled: ${sale.saleNumber}`,
              createdBy: userId,
            },
          });
        }

        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: {
            status: SaleStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledBy: userId,
          },
          include: {
            items: {
              include: {
                product: { select: { id: true, name: true, sku: true, unit: true } },
              },
            },
            branch: { select: { id: true, name: true, code: true } },
            customer: { select: { id: true, name: true, phone: true, customerCode: true } },
            creator: { select: { id: true, name: true, email: true } },
            canceller: { select: { id: true, name: true, email: true } },
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            userId,
            action: 'SALE_CANCELLED',
            entity: 'Sale',
            entityId: sale.id,
            newData: {
              saleNumber: sale.saleNumber,
              reason: dto?.reason || null,
              status: SaleStatus.CANCELLED,
            },
          },
        });

        // Reverse the sale journal entry (ledger)
        await this.ledgerService.reverseSaleJournal(organizationId, sale.id, userId, tx);

        return updatedSale;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 20000,
        timeout: 30000,
      }
    );
  }
}
