import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { SalesService } from '../sales/sales.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CustomerService } from '../customer/customer.service.js';
import { ProductService } from '../product/product.service.js';
import { CategoryService } from '../category/category.service.js';
import {
  SyncEntityType,
  SyncOperationAction,
  SyncOperationDto,
  SyncOperationResultDto,
  SyncOperationStatus,
  SyncUploadDto,
  SyncUploadResponseDto,
  SyncDownloadQueryDto,
  SyncDownloadResponseDto,
} from './dto/index.js';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly authzService: AuthorizationService,
    private readonly auditLogService: AuditLogService,
    private readonly salesService: SalesService,
    private readonly inventoryService: InventoryService,
    private readonly customerService: CustomerService,
    private readonly productService: ProductService,
    private readonly categoryService: CategoryService,
  ) {}

  /**
   * Process a batch of offline operations idempotently with per-operation isolation and structured results
   */
  async processUploadBatch(
    organizationId: string,
    userId: string,
    dto: SyncUploadDto,
  ): Promise<SyncUploadResponseDto> {
    const batchId = randomUUID();
    const results: SyncOperationResultDto[] = [];

    for (const op of dto.operations) {
      try {
        const result = await this.processSingleOperation(organizationId, userId, op);
        results.push(result);
      } catch (err: any) {
        this.logger.error(`Error processing sync op ${op.operationId}: ${err.message}`, err.stack);
        results.push({
          operationId: op.operationId,
          status: SyncOperationStatus.REJECTED,
          entityType: op.entityType,
          clientId: op.clientId,
          serverId: op.serverId,
          message: err.message || 'Internal processing error',
        });
      }
    }

    const successCount = results.filter((r) => r.status === SyncOperationStatus.SUCCESS).length;
    const conflictCount = results.filter((r) => r.status === SyncOperationStatus.CONFLICT).length;
    const rejectedCount = results.filter((r) => r.status === SyncOperationStatus.REJECTED).length;

    // Audit log the sync batch execution
    await this.auditLogService.logAction({
      organizationId,
      userId,
      action: 'OFFLINE_SYNC_BATCH_PROCESSED',
      entity: 'SyncBatch',
      entityId: batchId,
      newData: {
        totalOperations: dto.operations.length,
        successCount,
        conflictCount,
        rejectedCount,
      },
    });

    return {
      batchId,
      processedCount: results.length,
      successCount,
      conflictCount,
      rejectedCount,
      results,
    };
  }

  /**
   * Processes a single offline operation with server-side validation and authorization
   */
  private async processSingleOperation(
    organizationId: string,
    userId: string,
    op: SyncOperationDto,
  ): Promise<SyncOperationResultDto> {
    // 1. Authorize operation by required permission
    const requiredPermission = this.getRequiredPermission(op.entityType, op.action);
    const hasPermission = await this.authzService.hasPermissions(organizationId, userId, [
      requiredPermission,
    ]);

    if (!hasPermission) {
      return {
        operationId: op.operationId,
        status: SyncOperationStatus.REJECTED,
        entityType: op.entityType,
        clientId: op.clientId,
        serverId: op.serverId,
        message: `Forbidden: User lacks permission ${requiredPermission}`,
      };
    }

    // 2. Delegate to entity-specific handler
    switch (op.entityType) {
      case SyncEntityType.CUSTOMER:
        return this.processCustomerOperation(organizationId, userId, op);
      case SyncEntityType.CATEGORY:
        return this.processCategoryOperation(organizationId, userId, op);
      case SyncEntityType.PRODUCT:
        return this.processProductOperation(organizationId, userId, op);
      case SyncEntityType.SALE:
        return this.processSaleOperation(organizationId, userId, op);
      case SyncEntityType.INVENTORY_ADJUSTMENT:
        return this.processInventoryOperation(organizationId, userId, op);
      default:
        return {
          operationId: op.operationId,
          status: SyncOperationStatus.REJECTED,
          entityType: op.entityType,
          clientId: op.clientId,
          serverId: op.serverId,
          message: `Unsupported entity type: ${op.entityType}`,
        };
    }
  }

  private getRequiredPermission(entityType: SyncEntityType, action: SyncOperationAction): string {
    const actionStr = action === SyncOperationAction.DELETE ? 'archive' : action === SyncOperationAction.UPDATE ? 'update' : 'create';
    switch (entityType) {
      case SyncEntityType.CUSTOMER:
        return `customer:${actionStr}`;
      case SyncEntityType.CATEGORY:
        return `category:${actionStr}`;
      case SyncEntityType.PRODUCT:
        return `product:${actionStr}`;
      case SyncEntityType.SALE:
        return 'sale:create';
      case SyncEntityType.INVENTORY_ADJUSTMENT:
        return 'inventory:adjust';
      default:
        return 'organization:read';
    }
  }

  /**
   * Customer sync handler with clientId idempotency and conflict detection
   */
  private async processCustomerOperation(
    organizationId: string,
    userId: string,
    op: SyncOperationDto,
  ): Promise<SyncOperationResultDto> {
    if (op.action === SyncOperationAction.CREATE) {
      // Check existing by clientId (idempotency)
      if (op.clientId) {
        const existing = await this.prisma.customer.findFirst({
          where: { clientId: op.clientId },
        });

        if (existing) {
          if (existing.organizationId !== organizationId) {
            return {
              operationId: op.operationId,
              status: SyncOperationStatus.CONFLICT,
              entityType: op.entityType,
              clientId: op.clientId,
              message: 'Cross-tenant clientId collision detected',
              conflictDetails: { reason: 'CROSS_TENANT_COLLISION' },
            };
          }
          return {
            operationId: op.operationId,
            status: SyncOperationStatus.SUCCESS,
            entityType: op.entityType,
            clientId: op.clientId,
            serverId: existing.id,
            message: 'Idempotent replay: customer already created',
            serverData: existing,
          };
        }
      }

      // Check conflict by customerCode if specified
      if (op.data?.customerCode) {
        const codeExisting = await this.prisma.customer.findUnique({
          where: {
            organizationId_customerCode: {
              organizationId,
              customerCode: op.data.customerCode,
            },
          },
        });
        if (codeExisting) {
          return {
            operationId: op.operationId,
            status: SyncOperationStatus.CONFLICT,
            entityType: op.entityType,
            clientId: op.clientId,
            serverId: codeExisting.id,
            message: `Conflict: Customer with code ${op.data.customerCode} already exists`,
            conflictDetails: {
              reason: 'CUSTOMER_CODE_EXISTS',
              serverRecord: codeExisting,
              clientRecord: op.data,
            },
          };
        }
      }

      // Create with clientId
      const newCustomer = await this.customerService.create(
        organizationId,
        op.data as any,
        userId,
      );

      // Link clientId if provided
      if (op.clientId) {
        await this.prisma.customer.update({
          where: { id: newCustomer.id },
          data: { clientId: op.clientId },
        });
      }

      return {
        operationId: op.operationId,
        status: SyncOperationStatus.SUCCESS,
        entityType: op.entityType,
        clientId: op.clientId,
        serverId: newCustomer.id,
        serverData: newCustomer,
      };
    }

    if (op.action === SyncOperationAction.UPDATE) {
      const targetId = op.serverId;
      if (!targetId) {
        return {
          operationId: op.operationId,
          status: SyncOperationStatus.REJECTED,
          entityType: op.entityType,
          clientId: op.clientId,
          message: 'Server ID is required for customer update',
        };
      }

      const existing = await this.prisma.customer.findFirst({
        where: { id: targetId, organizationId },
      });

      if (!existing) {
        return {
          operationId: op.operationId,
          status: SyncOperationStatus.REJECTED,
          entityType: op.entityType,
          serverId: targetId,
          message: 'Customer not found in current organization',
        };
      }

      // Conflict detection: if clientTimestamp is older than server's updatedAt
      if (op.clientTimestamp && new Date(op.clientTimestamp) < existing.updatedAt) {
        return {
          operationId: op.operationId,
          status: SyncOperationStatus.CONFLICT,
          entityType: op.entityType,
          serverId: targetId,
          clientId: op.clientId,
          message: 'Update conflict: Server record has been updated since client change',
          conflictDetails: {
            reason: 'SERVER_RECORD_NEWER',
            serverRecord: existing,
            clientRecord: op.data,
          },
        };
      }

      const updated = await this.customerService.update(
        organizationId,
        targetId,
        op.data as any,
        userId,
      );

      return {
        operationId: op.operationId,
        status: SyncOperationStatus.SUCCESS,
        entityType: op.entityType,
        serverId: updated.id,
        clientId: op.clientId,
        serverData: updated,
      };
    }

    return {
      operationId: op.operationId,
      status: SyncOperationStatus.REJECTED,
      entityType: op.entityType,
      message: `Action ${op.action} not supported for customer sync`,
    };
  }

  /**
   * Category sync handler
   */
  private async processCategoryOperation(
    organizationId: string,
    userId: string,
    op: SyncOperationDto,
  ): Promise<SyncOperationResultDto> {
    if (op.action === SyncOperationAction.CREATE) {
      if (op.clientId) {
        const existing = await this.prisma.category.findFirst({
          where: { clientId: op.clientId },
        });

        if (existing) {
          if (existing.organizationId !== organizationId) {
            return {
              operationId: op.operationId,
              status: SyncOperationStatus.CONFLICT,
              entityType: op.entityType,
              clientId: op.clientId,
              message: 'Cross-tenant clientId collision detected',
              conflictDetails: { reason: 'CROSS_TENANT_COLLISION' },
            };
          }
          return {
            operationId: op.operationId,
            status: SyncOperationStatus.SUCCESS,
            entityType: op.entityType,
            clientId: op.clientId,
            serverId: existing.id,
            message: 'Idempotent replay: category already exists',
            serverData: existing,
          };
        }
      }

      const created = await this.categoryService.create(
        organizationId,
        op.data as any,
        userId,
      );

      if (op.clientId) {
        await this.prisma.category.update({
          where: { id: created.id },
          data: { clientId: op.clientId },
        });
      }

      return {
        operationId: op.operationId,
        status: SyncOperationStatus.SUCCESS,
        entityType: op.entityType,
        clientId: op.clientId,
        serverId: created.id,
        serverData: created,
      };
    }

    return {
      operationId: op.operationId,
      status: SyncOperationStatus.REJECTED,
      entityType: op.entityType,
      message: `Action ${op.action} not supported for category sync`,
    };
  }

  /**
   * Product sync handler
   */
  private async processProductOperation(
    organizationId: string,
    userId: string,
    op: SyncOperationDto,
  ): Promise<SyncOperationResultDto> {
    if (op.action === SyncOperationAction.CREATE) {
      if (op.clientId) {
        const existing = await this.prisma.product.findFirst({
          where: { clientId: op.clientId },
        });

        if (existing) {
          if (existing.organizationId !== organizationId) {
            return {
              operationId: op.operationId,
              status: SyncOperationStatus.CONFLICT,
              entityType: op.entityType,
              clientId: op.clientId,
              message: 'Cross-tenant clientId collision detected',
              conflictDetails: { reason: 'CROSS_TENANT_COLLISION' },
            };
          }
          return {
            operationId: op.operationId,
            status: SyncOperationStatus.SUCCESS,
            entityType: op.entityType,
            clientId: op.clientId,
            serverId: existing.id,
            message: 'Idempotent replay: product already exists',
            serverData: existing,
          };
        }
      }

      const created = await this.productService.create(
        organizationId,
        op.data as any,
        userId,
      );

      if (op.clientId) {
        await this.prisma.product.update({
          where: { id: created.id },
          data: { clientId: op.clientId },
        });
      }

      return {
        operationId: op.operationId,
        status: SyncOperationStatus.SUCCESS,
        entityType: op.entityType,
        clientId: op.clientId,
        serverId: created.id,
        serverData: created,
      };
    }

    return {
      operationId: op.operationId,
      status: SyncOperationStatus.REJECTED,
      entityType: op.entityType,
      message: `Action ${op.action} not supported for product sync`,
    };
  }

  /**
   * Sale sync handler with stable clientId / idempotencyKey
   */
  private async processSaleOperation(
    organizationId: string,
    userId: string,
    op: SyncOperationDto,
  ): Promise<SyncOperationResultDto> {
    if (op.action === SyncOperationAction.CREATE) {
      // 1. Check idempotency by clientId first
      if (op.clientId) {
        const existingByClientId = await this.prisma.sale.findFirst({
          where: { clientId: op.clientId },
          include: { items: true },
        });

        if (existingByClientId) {
          if (existingByClientId.organizationId !== organizationId) {
            return {
              operationId: op.operationId,
              status: SyncOperationStatus.CONFLICT,
              entityType: op.entityType,
              clientId: op.clientId,
              message: 'Cross-tenant sale collision detected',
              conflictDetails: { reason: 'CROSS_TENANT_COLLISION' },
            };
          }
          return {
            operationId: op.operationId,
            status: SyncOperationStatus.SUCCESS,
            entityType: op.entityType,
            clientId: op.clientId,
            serverId: existingByClientId.id,
            message: 'Idempotent replay: sale already recorded',
            serverData: existingByClientId,
          };
        }
      }

      // 2. Set idempotencyKey = operationId to leverage SalesService idempotency
      const saleDto = {
        ...op.data,
        idempotencyKey: op.data.idempotencyKey || op.operationId,
      };

      try {
        const sale = await this.salesService.create(organizationId, userId, saleDto as any);

        if (op.clientId) {
          await this.prisma.sale.update({
            where: { id: sale.id },
            data: { clientId: op.clientId },
          });
        }

        return {
          operationId: op.operationId,
          status: SyncOperationStatus.SUCCESS,
          entityType: op.entityType,
          clientId: op.clientId,
          serverId: sale.id,
          serverData: sale,
        };
      } catch (saleErr: any) {
        // Distinguish business conflicts (e.g. insufficient inventory) from crashes
        return {
          operationId: op.operationId,
          status: SyncOperationStatus.CONFLICT,
          entityType: op.entityType,
          clientId: op.clientId,
          message: saleErr.message,
          conflictDetails: {
            reason: 'SALE_PROCESSING_REJECTED',
            clientRecord: op.data,
          },
        };
      }
    }

    return {
      operationId: op.operationId,
      status: SyncOperationStatus.REJECTED,
      entityType: op.entityType,
      message: `Action ${op.action} not supported for sale sync`,
    };
  }

  /**
   * Inventory adjustment sync handler
   */
  private async processInventoryOperation(
    organizationId: string,
    userId: string,
    op: SyncOperationDto,
  ): Promise<SyncOperationResultDto> {
    const adjustDto = {
      ...op.data,
      idempotencyKey: op.data.idempotencyKey || op.operationId,
    };

    try {
      const movement = await this.inventoryService.adjust(
        organizationId,
        userId,
        adjustDto as any,
      );

      return {
        operationId: op.operationId,
        status: SyncOperationStatus.SUCCESS,
        entityType: op.entityType,
        serverId: 'id' in movement ? (movement as any).id : undefined,
        serverData: movement,
      };
    } catch (invErr: any) {
      return {
        operationId: op.operationId,
        status: SyncOperationStatus.CONFLICT,
        entityType: op.entityType,
        message: invErr.message,
        conflictDetails: {
          reason: 'INVENTORY_ADJUSTMENT_FAILED',
          clientRecord: op.data,
        },
      };
    }
  }

  /**
   * Incremental download of all domain entities modified since cursor
   */
  async getIncrementalDownload(
    organizationId: string,
    query: SyncDownloadQueryDto,
  ): Promise<SyncDownloadResponseDto> {
    const limit = query.limit || 100;
    const sinceDate = query.since ? new Date(query.since) : new Date(0);
    const now = new Date();

    const [customers, categories, products, sales, payments] = await Promise.all([
      this.prisma.customer.findMany({
        where: {
          organizationId,
          updatedAt: { gt: sinceDate },
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.category.findMany({
        where: {
          organizationId,
          updatedAt: { gt: sinceDate },
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.product.findMany({
        where: {
          organizationId,
          updatedAt: { gt: sinceDate },
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.sale.findMany({
        where: {
          organizationId,
          updatedAt: { gt: sinceDate },
        },
        include: {
          items: true,
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: {
          organizationId,
          updatedAt: { gt: sinceDate },
        },
        include: {
          allocations: true,
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      }),
    ]);

    // Find the latest timestamp among all fetched entities to form next cursor
    const timestamps = [
      ...customers.map((c) => c.updatedAt),
      ...categories.map((c) => c.updatedAt),
      ...products.map((p) => p.updatedAt),
      ...sales.map((s) => s.updatedAt),
      ...payments.map((p) => p.updatedAt),
    ];

    let nextCursor = now.toISOString();
    if (timestamps.length > 0) {
      const maxTimestamp = new Date(Math.max(...timestamps.map((t) => t.getTime())));
      nextCursor = maxTimestamp.toISOString();
    }

    const hasMore =
      customers.length === limit ||
      categories.length === limit ||
      products.length === limit ||
      sales.length === limit ||
      payments.length === limit;

    return {
      serverTime: now.toISOString(),
      nextCursor,
      hasMore,
      customers,
      categories,
      products,
      sales,
      payments,
    };
  }
}
