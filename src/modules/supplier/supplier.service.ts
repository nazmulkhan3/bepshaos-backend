import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { SupplierQueryDto, SupplierSortBy } from './dto/supplier-query.dto.js';
import { PageDto, PageMetaDto } from '../../common/dtos/pagination.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class SupplierService {
  constructor(private prisma: DatabaseService) {}

  private async generateSupplierCode(organizationId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx || this.prisma;
    const lastSupplier = await client.supplier.findFirst({
      where: { organizationId },
      orderBy: { supplierCode: 'desc' },
      select: { supplierCode: true },
    });

    if (!lastSupplier || !lastSupplier.supplierCode) {
      return 'SUP-000001';
    }

    const match = lastSupplier.supplierCode.match(/SUP-(\d+)/);
    if (!match) return 'SUP-000001';

    const lastNumber = parseInt(match[1], 10);
    return `SUP-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  async create(organizationId: string, data: CreateSupplierDto, userId: string) {
    let retries = 0;
    while (retries < 15) {
      try {
        const supplier = await this.prisma.$transaction(async (tx) => {
          const supplierCode = await this.generateSupplierCode(organizationId, tx);

          const newSupplier = await tx.supplier.create({
            data: {
              organizationId,
              supplierCode,
              ...data,
            },
          });

          await tx.auditLog.create({
            data: {
              organizationId,
              userId,
              action: 'SUPPLIER_CREATED',
              entity: 'Supplier',
              entityId: newSupplier.id,
              newData: { supplierCode },
            },
          });

          return newSupplier;
        });

        return supplier;
      } catch (error: any) {
        const isCollision =
          error.code === 'P2002' &&
          (JSON.stringify(error.meta || {}).includes('supplierCode') ||
            error.message?.includes('supplierCode') ||
            (Array.isArray(error.meta?.target) && error.meta.target.includes('supplierCode')));

        if (isCollision) {
          retries++;
          await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25 * retries)));
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Failed to generate a unique supplier code after multiple attempts');
  }

  async findAll(organizationId: string, query: SupplierQueryDto) {
    const { page = 1, limit = 20, search, status, sortBy, sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierWhereInput = {
      organizationId,
      status: status || { not: 'ARCHIVED' }, // By default don't show archived
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { supplierCode: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { taxNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.SupplierOrderByWithRelationInput = {};
    if (sortBy && Object.values(SupplierSortBy).includes(sortBy as SupplierSortBy)) {
      orderBy[sortBy as keyof typeof SupplierSortBy] = sortOrder;
    } else {
      orderBy.createdAt = 'desc';
    }

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    const meta = new PageMetaDto({
      pageOptionsDto: { page, limit, skip },
      itemCount: total,
    });

    return new PageDto(data, meta);
  }

  async findOne(organizationId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, organizationId },
      include: { addresses: true },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    return supplier;
  }

  async update(organizationId: string, supplierId: string, data: UpdateSupplierDto, userId: string) {
    // Verify existence
    await this.findOne(organizationId, supplierId);

    const updatedSupplier = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({
        where: { id: supplierId },
        data,
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'SUPPLIER_UPDATED',
          entity: 'Supplier',
          entityId: supplierId,
        },
      });

      return supplier;
    });

    return updatedSupplier;
  }

  async archive(organizationId: string, supplierId: string, userId: string) {
    // Verify existence
    await this.findOne(organizationId, supplierId);

    const archivedSupplier = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({
        where: { id: supplierId },
        data: { status: 'ARCHIVED' },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'SUPPLIER_ARCHIVED',
          entity: 'Supplier',
          entityId: supplierId,
        },
      });

      return supplier;
    });

    return archivedSupplier;
  }

  async restore(organizationId: string, supplierId: string, userId: string) {
    // Verify existence
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, organizationId },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    if (supplier.status !== 'ARCHIVED') {
      throw new ConflictException('Supplier is not archived');
    }

    const restoredSupplier = await this.prisma.$transaction(async (tx) => {
      const restored = await tx.supplier.update({
        where: { id: supplierId },
        data: { status: 'ACTIVE' },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'SUPPLIER_RESTORED',
          entity: 'Supplier',
          entityId: supplierId,
        },
      });

      return restored;
    });

    return restoredSupplier;
  }
}
