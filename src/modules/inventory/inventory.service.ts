import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { InventoryQueryDto, MovementQueryDto, StockInDto, StockOutDto, StockAdjustDto } from './dto/inventory.dto.js';
import { Prisma, InventoryMovementType } from '@prisma/client';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: DatabaseService) {}

  async findAll(organizationId: string, query: InventoryQueryDto) {
    const { page = 1, limit = 20, search, branchId, productId } = query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryWhereInput = { organizationId };

    if (branchId) where.branchId = branchId;
    if (productId) where.productId = productId;

    if (search) {
      where.product = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        include: {
          product: {
            select: { id: true, name: true, sku: true, barcode: true, status: true },
          },
          branch: {
            select: { id: true, name: true, code: true, status: true },
          },
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.inventory.count({ where }),
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

  async findAllMovements(organizationId: string, query: MovementQueryDto) {
    const { page = 1, limit = 20, branchId, productId, movementType } = query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryMovementWhereInput = { organizationId };

    if (branchId) where.branchId = branchId;
    if (productId) where.productId = productId;
    if (movementType) where.movementType = movementType;

    const [data, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          product: {
            select: { id: true, name: true, sku: true },
          },
          branch: {
            select: { id: true, name: true, code: true },
          },
          user: {
            select: { id: true, email: true, name: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryMovement.count({ where }),
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

  async findOne(organizationId: string, id: string) {
    const inventory = await this.prisma.inventory.findUnique({
      where: { id },
      include: {
        product: true,
        branch: true,
      },
    });

    if (!inventory || inventory.organizationId !== organizationId) {
      throw new NotFoundException(`Inventory record not found`);
    }

    return inventory;
  }

  async stockIn(organizationId: string, userId: string, dto: StockInDto) {
    return this.executeStockMutation(organizationId, userId, {
      branchId: dto.branchId,
      productId: dto.productId,
      delta: dto.quantity,
      type: InventoryMovementType.STOCK_IN,
      note: dto.note,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  async stockOut(organizationId: string, userId: string, dto: StockOutDto) {
    return this.executeStockMutation(organizationId, userId, {
      branchId: dto.branchId,
      productId: dto.productId,
      delta: -dto.quantity, // Negative delta for stock out
      type: InventoryMovementType.STOCK_OUT,
      note: dto.note,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  async adjust(organizationId: string, userId: string, dto: StockAdjustDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Check idempotency
      if (dto.idempotencyKey) {
        const existingMovement = await tx.inventoryMovement.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId,
              idempotencyKey: dto.idempotencyKey,
            },
          } as any,
        });
        if (existingMovement) {
          return existingMovement;
        }
      }

      // 2. Lock inventory row
      const inventory = await this.lockAndValidateInventory(tx, organizationId, dto.branchId, dto.productId);
      
      const currentQty = new Prisma.Decimal(inventory.quantity as any);
      const newQty = new Prisma.Decimal(dto.newQuantity);
      
      const difference = newQty.minus(currentQty);
      
      if (difference.isZero()) {
        // No actual adjustment needed
        return { message: 'Stock already at target quantity', quantity: currentQty.toNumber() };
      }
      
      const type = difference.isPositive() ? InventoryMovementType.ADJUSTMENT : InventoryMovementType.ADJUSTMENT;
      
      return this.processStockUpdate(
        tx,
        organizationId,
        userId,
        inventory,
        difference,
        currentQty,
        type,
        dto.note,
        dto.idempotencyKey
      );
    });
  }

  private async executeStockMutation(
    organizationId: string,
    userId: string,
    params: {
      branchId: string;
      productId: string;
      delta: number;
      type: InventoryMovementType;
      note?: string;
      idempotencyKey?: string;
    }
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Check idempotency
      if (params.idempotencyKey) {
        const existingMovement = await tx.inventoryMovement.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId,
              idempotencyKey: params.idempotencyKey,
            },
          } as any,
        });
        if (existingMovement) {
          return existingMovement;
        }
      }

      // 2. Lock inventory row
      const inventory = await this.lockAndValidateInventory(tx, organizationId, params.branchId, params.productId);
      
      const currentQty = new Prisma.Decimal(inventory.quantity as any);
      const deltaDecimal = new Prisma.Decimal(params.delta);
      const newQty = currentQty.plus(deltaDecimal);

      // 3. Validate negative stock
      if (newQty.isNegative()) {
        throw new ConflictException(`Insufficient stock. Current: ${currentQty.toString()}, Requested: ${Math.abs(params.delta)}`);
      }

      return this.processStockUpdate(
        tx,
        organizationId,
        userId,
        inventory,
        deltaDecimal,
        currentQty,
        params.type,
        params.note,
        params.idempotencyKey
      );
    });
  }

  private async lockAndValidateInventory(
    tx: Prisma.TransactionClient,
    organizationId: string,
    branchId: string,
    productId: string
  ) {
    // Basic validations first without lock
    const product = await tx.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.organizationId !== organizationId) {
      throw new NotFoundException(`Product not found`);
    }
    if (product.status === 'DISCONTINUED') {
      throw new ConflictException(`Cannot mutate stock for discontinued product`);
    }

    const branch = await tx.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch || branch.organizationId !== organizationId) {
      throw new NotFoundException(`Branch not found`);
    }
    if (branch.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot mutate stock for inactive branch`);
    }

    // Ensure inventory row exists first to be able to lock it
    let inventory = await tx.inventory.findFirst({
      where: {
        organizationId,
        branchId,
        productId,
      },
    });

    if (!inventory) {
      inventory = await tx.inventory.create({
        data: {
          organizationId,
          branchId,
          productId,
          quantity: 0,
        },
      });
    }

    // Lock the row exclusively for this transaction
    const lockedRows = await tx.$queryRaw<{ id: string, quantity: any, averageCost: any }[]>`
      SELECT id, quantity, "averageCost" 
      FROM "Inventory" 
      WHERE id = ${inventory.id} 
      FOR UPDATE
    `;

    if (!lockedRows || lockedRows.length === 0) {
      throw new NotFoundException(`Inventory record could not be locked`);
    }

    return {
      ...lockedRows[0],
      productPurchasePrice: product.purchasePrice,
    };
  }

  private async processStockUpdate(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    lockedInventory: any,
    delta: Prisma.Decimal,
    currentQty: Prisma.Decimal,
    type: InventoryMovementType,
    note?: string,
    idempotencyKey?: string
  ) {
    const afterQty = currentQty.plus(delta);

    // If stock-in is performed and inventory averageCost is zero, initialize with product reference purchasePrice if available
    let averageCost = new Prisma.Decimal(lockedInventory.averageCost || 0);
    if (delta.gt(0) && averageCost.isZero() && lockedInventory.productPurchasePrice) {
      averageCost = new Prisma.Decimal(lockedInventory.productPurchasePrice);
    }

    // Update inventory
    const updatedInventory = await tx.inventory.update({
      where: { id: lockedInventory.id },
      data: {
        quantity: afterQty.toNumber(),
        averageCost: averageCost.toFixed(4),
      },
    });

    // Create immutable stock movement
    const movement = await tx.inventoryMovement.create({
      data: {
        organizationId,
        branchId: updatedInventory.branchId,
        productId: updatedInventory.productId,
        movementType: type,
        quantity: Math.abs(delta.toNumber()),
        beforeQuantity: currentQty.toNumber(),
        afterQuantity: afterQty.toNumber(),
        note,
        idempotencyKey,
        createdBy: userId,
      },
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        organizationId,
        userId: userId,
        action: 'INVENTORY_' + type,
        entity: 'Inventory',
        entityId: updatedInventory.id,
        newData: {
          branchId: updatedInventory.branchId,
          productId: updatedInventory.productId,
          delta: delta.toNumber(),
          before: currentQty.toNumber(),
          after: afterQty.toNumber(),
          movementId: movement.id,
        },
      },
    });

    return movement;
  }

  /**
   * Phase 2B: Legacy Stock Valuation Dry-Run Report
   * Identifies historical inventory rows where averageCost = 0, calculates proposed
   * valuation based on verified historical purchase cost (or catalog purchase price),
   * computes valuation deltas and required reconciliation journal decisions WITHOUT
   * modifying any database records.
   */
  async getLegacyValuationDryRun(organizationId: string) {
    const zeroCostInventories = await this.prisma.inventory.findMany({
      where: {
        organizationId,
        averageCost: 0,
        quantity: { gt: 0 },
      },
      include: {
        product: { select: { id: true, name: true, sku: true, purchasePrice: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ branchId: 'asc' }, { productId: 'asc' }],
    });

    const affectedStock = [];
    let totalProposedValuation = new Prisma.Decimal(0);
    let manualReviewCount = 0;

    for (const item of zeroCostInventories) {
      const qty = new Prisma.Decimal(item.quantity);

      // Look up historical purchase items for this product
      const latestPurchaseItem = await this.prisma.purchaseItem.findFirst({
        where: {
          productId: item.productId,
          purchase: { organizationId, branchId: item.branchId, status: 'COMPLETED' },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          quantity: true,
          unitCost: true,
          totalCapitalizableCost: true,
          createdAt: true,
          purchase: { select: { purchaseNumber: true } },
        },
      });

      let proposedUnitCost: Prisma.Decimal;
      let costSource: 'HISTORICAL_PURCHASE' | 'CATALOG_PURCHASE_PRICE' | 'UNRESOLVED_ZERO';

      if (
        latestPurchaseItem &&
        latestPurchaseItem.totalCapitalizableCost &&
        Number(latestPurchaseItem.totalCapitalizableCost) > 0 &&
        Number(latestPurchaseItem.quantity) > 0
      ) {
        proposedUnitCost = new Prisma.Decimal(latestPurchaseItem.totalCapitalizableCost).dividedBy(
          latestPurchaseItem.quantity,
        );
        costSource = 'HISTORICAL_PURCHASE';
      } else if (latestPurchaseItem && Number(latestPurchaseItem.unitCost) > 0) {
        proposedUnitCost = new Prisma.Decimal(latestPurchaseItem.unitCost);
        costSource = 'HISTORICAL_PURCHASE';
      } else if (item.product.purchasePrice && Number(item.product.purchasePrice) > 0) {
        proposedUnitCost = new Prisma.Decimal(item.product.purchasePrice);
        costSource = 'CATALOG_PURCHASE_PRICE';
        manualReviewCount++;
      } else {
        proposedUnitCost = new Prisma.Decimal(0);
        costSource = 'UNRESOLVED_ZERO';
        manualReviewCount++;
      }

      const currentValuation = new Prisma.Decimal(0);
      const proposedValuation = qty.mul(proposedUnitCost);
      const valuationDifference = proposedValuation.minus(currentValuation);

      totalProposedValuation = totalProposedValuation.plus(proposedValuation);

      affectedStock.push({
        inventoryId: item.id,
        branch: { id: item.branch.id, name: item.branch.name, code: item.branch.code },
        product: { id: item.product.id, name: item.product.name, sku: item.product.sku },
        quantity: qty.toNumber(),
        currentAverageCost: '0.0000',
        currentValuation: '0.0000',
        proposedAverageCost: proposedUnitCost.toFixed(4),
        proposedValuation: proposedValuation.toFixed(4),
        valuationDifference: valuationDifference.toFixed(4),
        costSource,
        referencePurchase: latestPurchaseItem?.purchase?.purchaseNumber || null,
        reconciliationDecision: valuationDifference.gt(0)
          ? {
              action: 'MANUAL_RECONCILIATION_JOURNAL_REQUIRED',
              debitAccount: '1200 Inventory Asset',
              creditAccount: '3000 Owner Equity (Opening Balance / Prior Period Adjustment)',
              amount: valuationDifference.toFixed(4),
            }
          : { action: 'NO_ADJUSTMENT_REQUIRED', amount: '0.0000' },
      });
    }

    return {
      dryRun: true,
      executionTimestamp: new Date().toISOString(),
      disclaimer: 'DRY RUN ONLY — No database records or financial journals were created or modified.',
      summary: {
        totalAffectedItems: affectedStock.length,
        totalProposedValuation: totalProposedValuation.toFixed(4),
        manualReviewRequiredCount: manualReviewCount,
      },
      affectedStock,
    };
  }
}
