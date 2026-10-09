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
    const lockedRows = await tx.$queryRaw<{ id: string, quantity: any }[]>`
      SELECT id, quantity 
      FROM "Inventory" 
      WHERE id = ${inventory.id} 
      FOR UPDATE
    `;

    if (!lockedRows || lockedRows.length === 0) {
      throw new NotFoundException(`Inventory record could not be locked`);
    }

    return lockedRows[0];
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

    // Update inventory
    const updatedInventory = await tx.inventory.update({
      where: { id: lockedInventory.id },
      data: {
        quantity: afterQty.toNumber(),
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
}
