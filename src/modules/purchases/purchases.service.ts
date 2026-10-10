import { NotificationQueueService } from '../notification/notification.queue.service.js';
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreatePurchaseDto, PurchaseQueryDto, CancelPurchaseDto } from './dto/index.js';
import {
  Prisma,
  PurchaseStatus,
  InventoryMovementType,
  BranchStatus,
  SupplierStatus,
  ProductStatus,
} from '@prisma/client';
import crypto from 'crypto';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';
import { LedgerService } from '../ledger/ledger.service.js';

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(private readonly prisma: DatabaseService,
    private readonly ledgerService: LedgerService,private readonly notificationQueue: NotificationQueueService) {}

  private generateRequestHash(dto: CreatePurchaseDto): string {
    const normalized = {
      branchId: dto.branchId,
      supplierId: dto.supplierId || null,
      items: dto.items
        .map((i) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unitCost: Number(i.unitCost),
          discount: Number(i.discount || 0),
          tax: Number(i.tax || 0),
        }))
        .sort((a, b) => a.productId.localeCompare(b.productId)),
      discount: Number(dto.discount || 0),
      tax: Number(dto.tax || 0),
      // Phase 2B: include landed costs in hash
      freight:         Number(dto.freight || 0),
      loading:         Number(dto.loading || 0),
      handling:        Number(dto.handling || 0),
      clearingCharges: Number(dto.clearingCharges || 0),
      otherCosts:      Number(dto.otherCosts || 0),
      linkedExpenseId: dto.linkedExpenseId || null,
      note: dto.note || null,
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private async generatePurchaseNumber(organizationId: string, tx: Prisma.TransactionClient): Promise<string> {
    const lastPurchase = await tx.purchase.findFirst({
      where: { organizationId },
      orderBy: { purchaseNumber: 'desc' },
      select: { purchaseNumber: true },
    });

    if (!lastPurchase || !lastPurchase.purchaseNumber) {
      return 'PUR-000001';
    }

    const match = lastPurchase.purchaseNumber.match(/PUR-(\d+)/);
    if (!match) return 'PUR-000001';

    const lastNumber = parseInt(match[1], 10);
    return `PUR-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  async create(ctx: OrganizationContext, dto: CreatePurchaseDto) {
    const organizationId = ctx.organizationId;
    const userId = ctx.userId;

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Purchase must contain at least one item');
    }

    const productIds = dto.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Duplicate products in purchase items are not allowed. Combine quantities instead.'
      );
    }

    for (const item of dto.items) {
      if (item.quantity <= 0) {
        throw new BadRequestException(`Quantity must be greater than 0 for product ${item.productId}`);
      }
      if (item.unitCost < 0) {
        throw new BadRequestException(`Unit cost cannot be negative for product ${item.productId}`);
      }
    }

    const requestHash = this.generateRequestHash(dto);
    if (dto.idempotencyKey) {
      const existingPurchase = await this.prisma.purchase.findUnique({
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
          supplier: { select: { id: true, name: true, phone: true } },
        },
      });

      if (existingPurchase) {
        if (existingPurchase.requestHash && existingPurchase.requestHash !== requestHash) {
          throw new ConflictException('Idempotency key has already been used with a different request payload');
        }
        return existingPurchase;
      }
    }

    let retries = 0;
    const maxRetries = 50;

    while (retries < maxRetries) {
      try {
        const purchase = await this.prisma.$transaction(
          async (tx) => {
            if (dto.idempotencyKey) {
              const concurrentPurchase = await tx.purchase.findUnique({
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
                  supplier: { select: { id: true, name: true, phone: true } },
                },
              });

              if (concurrentPurchase) {
                if (concurrentPurchase.requestHash && concurrentPurchase.requestHash !== requestHash) {
                  throw new ConflictException(
                    'Idempotency key has already been used with a different request payload'
                  );
                }
                return concurrentPurchase;
              }
            }

            const branch = await tx.branch.findUnique({
              where: { id: dto.branchId },
            });
            if (!branch || branch.organizationId !== organizationId) {
              throw new NotFoundException('Branch not found');
            }
            if (branch.status !== BranchStatus.ACTIVE) {
              throw new ConflictException('Cannot create purchase for inactive branch');
            }

            if (dto.supplierId) {
              const supplier = await tx.supplier.findUnique({
                where: { id: dto.supplierId },
              });
              if (!supplier || supplier.organizationId !== organizationId || supplier.deletedAt) {
                throw new NotFoundException('Supplier not found');
              }
              if (supplier.status !== SupplierStatus.ACTIVE) {
                throw new ConflictException('Cannot create purchase for inactive or archived supplier');
              }
            }

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
                  `Cannot create purchase for inactive or discontinued product: ${p.name}`
                );
              }
            }

            const sortedItems = [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId));
            const lockedInventories: Record<string, { id: string; quantity: Prisma.Decimal; averageCost: Prisma.Decimal }> = {};

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

              const lockedRows = await tx.$queryRaw<{ id: string; quantity: any; averageCost: any }[]>`
                SELECT id, quantity, "averageCost" 
                FROM "Inventory" 
                WHERE id = ${inventory.id} 
                FOR UPDATE
              `;

              if (!lockedRows || lockedRows.length === 0) {
                throw new NotFoundException(`Inventory record could not be locked`);
              }

              const locked = lockedRows[0];
              const currentQty = new Prisma.Decimal(locked.quantity);
              const currentAverageCost = new Prisma.Decimal(locked.averageCost || 0);

              lockedInventories[item.productId] = {
                id: locked.id,
                quantity: currentQty,
                averageCost: currentAverageCost,
              };
            }

            const purchaseNumber = await this.generatePurchaseNumber(organizationId, tx);

            // ── Validate linked expense if supplied ────────────────────────────
            let linkedExpenseAccountId: string | null = null;
            if (dto.linkedExpenseId) {
              const linkedExpense = await tx.expense.findFirst({
                where: { id: dto.linkedExpenseId, organizationId },
                include: { category: true },
              });
              if (!linkedExpense) {
                throw new NotFoundException(`Linked expense ${dto.linkedExpenseId} not found`);
              }
              if (linkedExpense.status !== 'COMPLETED') {
                throw new ConflictException('Linked expense must have COMPLETED status to be capitalized');
              }
              linkedExpenseAccountId = linkedExpense.category.expenseAccountId;
            }

            // ── Step 1: Calculate raw line items and merchandise subtotals ─────
            let calculatedSubtotal = new Prisma.Decimal(0);
            let calculatedItemDiscount = new Prisma.Decimal(0);
            let calculatedItemTax = new Prisma.Decimal(0);

            const rawItems = sortedItems.map((item) => {
              const product = productMap.get(item.productId)!;
              const unitCost = new Prisma.Decimal(item.unitCost);
              const qty = new Prisma.Decimal(item.quantity);
              const itemDiscount = new Prisma.Decimal(item.discount ?? 0);
              const itemTax = new Prisma.Decimal(item.tax ?? 0);

              const itemSubtotal = qty.mul(unitCost);
              const rawLineTotal = itemSubtotal.minus(itemDiscount).plus(itemTax);

              if (rawLineTotal.isNegative()) {
                throw new BadRequestException(`Line total cannot be negative for product ${product.name}`);
              }

              calculatedSubtotal = calculatedSubtotal.plus(itemSubtotal);
              calculatedItemDiscount = calculatedItemDiscount.plus(itemDiscount);
              calculatedItemTax = calculatedItemTax.plus(itemTax);

              return {
                productId: item.productId,
                quantity: qty,
                unitCost,
                itemSubtotal,
                rawDiscount: itemDiscount,
                rawTax: itemTax,
                rawLineTotal,
              };
            });

            const overallDiscount = new Prisma.Decimal(dto.discount ?? 0);
            const overallTax = new Prisma.Decimal(dto.tax ?? 0);

            const totalDiscount = calculatedItemDiscount.plus(overallDiscount);
            const totalTax = calculatedItemTax.plus(overallTax);
            // total = merchandise total owed to the supplier
            const totalAmount = calculatedSubtotal.minus(totalDiscount).plus(totalTax);

            if (totalAmount.isNegative()) {
              throw new BadRequestException('Total purchase amount cannot be negative');
            }

            // ── Step 2: Allocate header discount and header tax across items ────
            // Ensures sum(lineTotal) == totalAmount exactly so stock valuation reconciles with AP
            const sumRawLineTotals = rawItems.reduce((acc, pi) => acc.plus(pi.rawLineTotal), new Prisma.Decimal(0));
            const sumRawQuantities = rawItems.reduce((acc, pi) => acc.plus(pi.quantity), new Prisma.Decimal(0));

            const itemsWithAdjustedTotals = rawItems.map((item) => {
              let lineDiscount = item.rawDiscount;
              let lineTax = item.rawTax;

              if (sumRawLineTotals.gt(0)) {
                if (overallDiscount.gt(0)) {
                  const share = overallDiscount.mul(item.rawLineTotal).dividedBy(sumRawLineTotals).toDecimalPlaces(4);
                  lineDiscount = lineDiscount.plus(share);
                }
                if (overallTax.gt(0)) {
                  const share = overallTax.mul(item.rawLineTotal).dividedBy(sumRawLineTotals).toDecimalPlaces(4);
                  lineTax = lineTax.plus(share);
                }
              } else if (sumRawQuantities.gt(0)) {
                if (overallDiscount.gt(0)) {
                  const share = overallDiscount.mul(item.quantity).dividedBy(sumRawQuantities).toDecimalPlaces(4);
                  lineDiscount = lineDiscount.plus(share);
                }
                if (overallTax.gt(0)) {
                  const share = overallTax.mul(item.quantity).dividedBy(sumRawQuantities).toDecimalPlaces(4);
                  lineTax = lineTax.plus(share);
                }
              }

              const lineTotal = item.itemSubtotal.minus(lineDiscount).plus(lineTax);
              return {
                ...item,
                discount: lineDiscount,
                tax: lineTax,
                lineTotal,
              };
            });

            // Adjust any rounding residual on lineTotal to match totalAmount exactly
            if (itemsWithAdjustedTotals.length > 0) {
              const sumLineTotals = itemsWithAdjustedTotals.reduce((acc, pi) => acc.plus(pi.lineTotal), new Prisma.Decimal(0));
              const residual = totalAmount.minus(sumLineTotals);
              itemsWithAdjustedTotals[itemsWithAdjustedTotals.length - 1].lineTotal =
                itemsWithAdjustedTotals[itemsWithAdjustedTotals.length - 1].lineTotal.plus(residual);
            }

            // ── Step 3: Phase 2B Landed Cost Calculation ────────────────────────
            const freight         = new Prisma.Decimal(dto.freight ?? 0);
            const loading         = new Prisma.Decimal(dto.loading ?? 0);
            const handling        = new Prisma.Decimal(dto.handling ?? 0);
            const clearingCharges = new Prisma.Decimal(dto.clearingCharges ?? 0);
            const otherCosts      = new Prisma.Decimal(dto.otherCosts ?? 0);

            const landedCostTotal = freight
              .plus(loading)
              .plus(handling)
              .plus(clearingCharges)
              .plus(otherCosts);

            if (landedCostTotal.isNegative()) {
              throw new BadRequestException('Landed cost total cannot be negative');
            }

            // capitalizableCost = supplier total payable + landed acquisition costs capitalised
            const capitalizableCost = totalAmount.plus(landedCostTotal);

            // ── Step 4: Allocate landed costs proportionally to items ───────────
            // Method: Proportional allocation by effective line value (or by quantity if line totals sum to 0)
            const sumEffectiveLines = itemsWithAdjustedTotals.reduce((acc, pi) => acc.plus(pi.lineTotal), new Prisma.Decimal(0));

            const itemsWithAllocation = itemsWithAdjustedTotals.map((pi) => {
              let allocation = new Prisma.Decimal(0);
              if (landedCostTotal.gt(0)) {
                if (sumEffectiveLines.gt(0)) {
                  allocation = landedCostTotal.mul(pi.lineTotal).dividedBy(sumEffectiveLines).toDecimalPlaces(4);
                } else if (sumRawQuantities.gt(0)) {
                  allocation = landedCostTotal.mul(pi.quantity).dividedBy(sumRawQuantities).toDecimalPlaces(4);
                }
              }
              return {
                ...pi,
                allocation,
                totalCapitalizableCost: pi.lineTotal.plus(allocation),
              };
            });

            // Fix any rounding residual on allocation so sum(allocation) == landedCostTotal exactly
            if (itemsWithAllocation.length > 0 && landedCostTotal.gt(0)) {
              const sumAllocated = itemsWithAllocation.reduce(
                (acc, pi) => acc.plus(pi.allocation),
                new Prisma.Decimal(0),
              );
              const residual = landedCostTotal.minus(sumAllocated);
              itemsWithAllocation[itemsWithAllocation.length - 1].allocation =
                itemsWithAllocation[itemsWithAllocation.length - 1].allocation.plus(residual);
              itemsWithAllocation[itemsWithAllocation.length - 1].totalCapitalizableCost =
                itemsWithAllocation[itemsWithAllocation.length - 1].lineTotal.plus(
                  itemsWithAllocation[itemsWithAllocation.length - 1].allocation,
                );
            }

            // ── Step 5: Persist Purchase & PurchaseItems ────────────────────────
            const purchase = await tx.purchase.create({
              data: {
                organizationId,
                branchId: dto.branchId,
                supplierId: dto.supplierId || null,
                purchaseNumber,
                status: PurchaseStatus.COMPLETED,
                subtotal: calculatedSubtotal,
                discount: totalDiscount,
                tax: totalTax,
                total: totalAmount,
                paidAmount: totalAmount,
                // Phase 2B: Landed costs
                freight,
                loading,
                handling,
                clearingCharges,
                otherCosts,
                landedCostTotal,
                capitalizableCost,
                linkedExpenseId: dto.linkedExpenseId || null,
                note: dto.note || null,
                idempotencyKey: dto.idempotencyKey || null,
                requestHash,
                createdBy: userId,
                items: {
                  create: itemsWithAllocation.map((pi) => ({
                    productId: pi.productId,
                    quantity: pi.quantity,
                    unitCost: pi.unitCost,
                    discount: pi.discount,
                    tax: pi.tax,
                    lineTotal: pi.lineTotal,
                    // Phase 2B: per-item landed cost allocation
                    landedCostAllocation:   pi.allocation,
                    totalCapitalizableCost: pi.totalCapitalizableCost,
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
                supplier: { select: { id: true, name: true, phone: true } },
              },
            });

            // ── Step 6: Update Moving Weighted-Average Cost (MWAC) ───────────────
            for (const pi of itemsWithAllocation) {
              const locked = lockedInventories[pi.productId];
              const newQty = locked.quantity.plus(pi.quantity);

              // MWAC uses totalCapitalizableCost (net line value + allocated landed cost)
              const totalCapCost = pi.totalCapitalizableCost;
              const netCostPerUnit = totalCapCost.dividedBy(pi.quantity);
              let newAverageCost = netCostPerUnit;
              if (locked.quantity.gt(0)) {
                const currentValuation = locked.quantity.mul(locked.averageCost);
                newAverageCost = currentValuation.plus(totalCapCost).dividedBy(newQty);
              }

              await tx.inventory.update({
                where: { id: locked.id },
                data: {
                  quantity: newQty.toNumber(),
                  averageCost: newAverageCost.toFixed(4),
                },
              });

              await tx.inventoryMovement.create({
                data: {
                  organizationId,
                  branchId: dto.branchId,
                  productId: pi.productId,
                  movementType: InventoryMovementType.STOCK_IN,
                  referenceType: 'PURCHASE',
                  referenceId: purchase.id,
                  quantity: pi.quantity.toNumber(),
                  beforeQuantity: locked.quantity.toNumber(),
                  afterQuantity: newQty.toNumber(),
                  note: `Purchase ${purchaseNumber}`,
                  createdBy: userId,
                },
              });
            }

            // Annotate linked expense to prevent duplicate expense recognition
            if (dto.linkedExpenseId) {
              const exp = await tx.expense.findUnique({ where: { id: dto.linkedExpenseId } });
              if (exp) {
                await tx.expense.update({
                  where: { id: exp.id },
                  data: {
                    reference: exp.reference
                      ? `${exp.reference} [Capitalized into ${purchaseNumber}]`
                      : `Capitalized into ${purchaseNumber}`,
                  },
                });
              }
            }

            await tx.auditLog.create({
              data: {
                organizationId,
                userId,
                action: 'PURCHASE_CREATED',
                entity: 'Purchase',
                entityId: purchase.id,
                newData: {
                  purchaseNumber: purchase.purchaseNumber,
                  branchId: purchase.branchId,
                  supplierId: purchase.supplierId,
                  total: purchase.total.toNumber(),
                  capitalizableCost: purchase.capitalizableCost.toNumber(),
                  landedCostTotal: purchase.landedCostTotal.toNumber(),
                  linkedExpenseId: purchase.linkedExpenseId,
                  itemCount: purchase.items.length,
                },
              },
            });

            // ── Step 7: Post double-entry purchase journal ──────────────────────
            await this.ledgerService.postPurchaseJournal(
              organizationId,
              {
                id: purchase.id,
                branchId: purchase.branchId,
                total: purchase.total,
                capitalizableCost: purchase.capitalizableCost,
                landedCostTotal: purchase.landedCostTotal,
                linkedExpenseAccountId,
                supplierId: purchase.supplierId,
                createdBy: userId,
              },
              tx,
            );

            return purchase;
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
          type: 'PURCHASE_CREATED',
          title: 'Purchase Created',
          message: `Purchase ${purchase.purchaseNumber} has been successfully created.`,
          entityType: 'Purchase',
          entityId: purchase.id,
        });

        return purchase;
      } catch (error: any) {
        const isPurchaseNumberCollision =
          error.code === 'P2002' &&
          (JSON.stringify(error.meta || {}).includes('purchaseNumber') ||
            error.message?.includes('purchaseNumber'));

        const isIdempotencyCollision =
          error.code === 'P2002' &&
          (JSON.stringify(error.meta || {}).includes('idempotencyKey') ||
            error.message?.includes('idempotencyKey'));

        if (isIdempotencyCollision && dto.idempotencyKey) {
          const existingPurchase = await this.prisma.purchase.findUnique({
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
              supplier: { select: { id: true, name: true, phone: true } },
            },
          });
          if (existingPurchase) {
            if (existingPurchase.requestHash && existingPurchase.requestHash !== requestHash) {
              throw new ConflictException(
                'Idempotency key has already been used with a different request payload'
              );
            }
            return existingPurchase;
          }
        }

        if (isPurchaseNumberCollision) {
          retries++;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.floor(Math.random() * 50 * retries + 20))
          );
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException('Failed to generate a unique purchase number after multiple attempts. Please retry.');
  }

  async findOne(ctx: OrganizationContext, id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true } },
          },
        },
        branch: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true, phone: true, email: true } },
        creator: { select: { id: true, name: true, email: true } },
        canceller: { select: { id: true, name: true, email: true } },
      },
    });

    if (!purchase || purchase.organizationId !== ctx.organizationId) {
      throw new NotFoundException('Purchase not found');
    }

    return purchase;
  }

  async findAll(ctx: OrganizationContext, query: PurchaseQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      branchId,
      supplierId,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query as any;

    const skip = (page - 1) * limit;
    const where: Prisma.PurchaseWhereInput = { organizationId: ctx.organizationId };

    if (branchId) where.branchId = branchId;
    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;

    if (search) {
      where.OR = [
        { purchaseNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const orderBy: Prisma.PurchaseOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const [data, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true, unit: true } },
            },
          },
          branch: { select: { id: true, name: true, code: true } },
          supplier: { select: { id: true, name: true, phone: true } },
        },
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.purchase.count({ where }),
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

  async cancel(ctx: OrganizationContext, purchaseId: string, dto?: CancelPurchaseDto) {
    const organizationId = ctx.organizationId;
    const userId = ctx.userId;

    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: {
        items: true,
      },
    });

    if (!purchase || purchase.organizationId !== organizationId) {
      throw new NotFoundException('Purchase not found');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const lockedRows = await tx.$queryRaw<{ status: string }[]>`
          SELECT status 
          FROM "Purchase" 
          WHERE id = ${purchase.id} 
          FOR UPDATE
        `;

        if (!lockedRows || lockedRows.length === 0) {
          throw new NotFoundException('Purchase not found');
        }

        const currentStatus = lockedRows[0].status;

        if (currentStatus === PurchaseStatus.CANCELLED) {
          return this.findOne(ctx, purchaseId);
        }

        if (currentStatus !== PurchaseStatus.COMPLETED) {
          throw new ConflictException(`Cannot cancel purchase with status ${currentStatus}`);
        }

        const sortedItems = [...purchase.items].sort((a, b) => a.productId.localeCompare(b.productId));

        for (const item of sortedItems) {
          let inventory = await tx.inventory.findFirst({
            where: {
              organizationId,
              branchId: purchase.branchId,
              productId: item.productId,
            },
          });

          if (!inventory) {
            throw new NotFoundException(`Inventory record could not be found for product ${item.productId}`);
          }

          const lockedRows = await tx.$queryRaw<{ id: string; quantity: any; averageCost: any }[]>`
            SELECT id, quantity, "averageCost" 
            FROM "Inventory" 
            WHERE id = ${inventory.id} 
            FOR UPDATE
          `;

          if (!lockedRows || lockedRows.length === 0) {
            throw new NotFoundException(`Inventory record could not be locked`);
          }

          const currentQty = new Prisma.Decimal(lockedRows[0].quantity);
          const currentAverageCost = new Prisma.Decimal(lockedRows[0].averageCost || 0);
          const deductQty = new Prisma.Decimal(item.quantity);

          if (currentQty.lt(deductQty)) {
            throw new ConflictException(
              `Insufficient stock to cancel purchase. Product ${item.productId} current stock: ${currentQty.toString()}, cancellation requires deduction of: ${deductQty.toString()}`
            );
          }

          const newQty = currentQty.minus(deductQty);
          let newAverageCost = currentAverageCost;
          if (newQty.isZero()) {
            newAverageCost = new Prisma.Decimal(0);
          } else {
            const itemCapCost = new Prisma.Decimal(item.totalCapitalizableCost || item.lineTotal);
            const remainingValuation = currentQty.mul(currentAverageCost).minus(itemCapCost);
            if (remainingValuation.gt(0)) {
              newAverageCost = remainingValuation.dividedBy(newQty);
            }
          }

          await tx.inventory.update({
            where: { id: inventory.id },
            data: {
              quantity: newQty.toNumber(),
              averageCost: newAverageCost.toFixed(4),
            },
          });

          await tx.inventoryMovement.create({
            data: {
              organizationId,
              branchId: purchase.branchId,
              productId: item.productId,
              movementType: InventoryMovementType.STOCK_OUT,
              referenceType: 'PURCHASE_CANCEL',
              referenceId: purchase.id,
              quantity: deductQty.toNumber(),
              beforeQuantity: currentQty.toNumber(),
              afterQuantity: newQty.toNumber(),
              note: dto?.reason ? `Purchase cancelled: ${dto.reason}` : `Purchase cancelled: ${purchase.purchaseNumber}`,
              createdBy: userId,
            },
          });
        }

        // Release annotation on linked expense if one was capitalized
        if (purchase.linkedExpenseId) {
          const exp = await tx.expense.findUnique({ where: { id: purchase.linkedExpenseId } });
          if (exp && exp.reference?.includes(`[Capitalized into ${purchase.purchaseNumber}]`)) {
            await tx.expense.update({
              where: { id: exp.id },
              data: {
                reference: exp.reference.replace(` [Capitalized into ${purchase.purchaseNumber}]`, '').trim() || null,
              },
            });
          }
        }

        const updatedPurchase = await tx.purchase.update({
          where: { id: purchase.id },
          data: {
            status: PurchaseStatus.CANCELLED,
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
            supplier: { select: { id: true, name: true, phone: true } },
            creator: { select: { id: true, name: true, email: true } },
            canceller: { select: { id: true, name: true, email: true } },
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            userId,
            action: 'PURCHASE_CANCELLED',
            entity: 'Purchase',
            entityId: purchase.id,
            newData: {
              purchaseNumber: purchase.purchaseNumber,
              reason: dto?.reason || null,
              status: PurchaseStatus.CANCELLED,
            },
          },
        });

        // Reverse the purchase journal entry (ledger)
        await this.ledgerService.reversePurchaseJournal(organizationId, purchase.id, userId, tx);

        return updatedPurchase;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 20000,
        timeout: 30000,
      }
    );
  }
}
