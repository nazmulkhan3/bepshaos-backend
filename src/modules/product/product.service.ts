import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductQueryDto, ProductSortBy } from './dto/product-query.dto.js';
import { PageDto, PageMetaDto } from '../../common/dtos/pagination.dto.js';
import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';

import { SubscriptionLimitService } from '../subscription/services/subscription-limit.service.js';
import { QuotaResourceType } from '../subscription/interfaces/plan-limits.interface.js';

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8);
const barcodeNanoid = customAlphabet('0123456789', 12);

@Injectable()
export class ProductService {
  constructor(
    private prisma: DatabaseService,
    private readonly subscriptionLimitService: SubscriptionLimitService,
  ) {}

  private generateSKU(): string {
    return `SKU-${nanoid()}`;
  }

  private generateBarcode(): string {
    return barcodeNanoid();
  }

  async create(organizationId: string, data: CreateProductDto, userId: string) {
    if (data.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: data.categoryId, organizationId },
      });
      if (!category) {
        throw new BadRequestException('Category not found');
      }
    }

    let retries = 0;
    while (retries < 15) {
      try {
        const sku = data.sku || this.generateSKU();
        const barcode = data.barcode || this.generateBarcode();

        const product = await this.prisma.$transaction(async (tx) => {
          // Enforce SaaS Product limit under Level-1 Organization row lock
          await this.subscriptionLimitService.enforceQuota(
            organizationId,
            QuotaResourceType.PRODUCT,
            tx,
          );

          const newProduct = await tx.product.create({
            data: {
              organizationId,
              ...data,
              sku,
              barcode,
            },
          });

          await tx.auditLog.create({
            data: {
              organizationId,
              userId,
              action: 'PRODUCT_CREATED',
              entity: 'Product',
              entityId: newProduct.id,
              newData: { sku, barcode },
            },
          });

          return newProduct;
        });

        return product;
      } catch (error: any) {
        const isCollision =
          error.code === 'P2002' &&
          (JSON.stringify(error.meta || {}).includes('sku') ||
            JSON.stringify(error.meta || {}).includes('barcode') ||
            error.message?.includes('sku') ||
            error.message?.includes('barcode') ||
            (Array.isArray(error.meta?.target) &&
              (error.meta.target.includes('sku') || error.meta.target.includes('barcode'))));

        if (isCollision) {
          retries++;
          // If the user explicitly provided sku/barcode, we shouldn't keep retrying with the same value
          if ((data.sku && error.meta?.target?.includes('sku')) || (data.barcode && error.meta?.target?.includes('barcode'))) {
             throw new ConflictException('Provided SKU or Barcode already exists in this organization');
          }
          await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25 * retries)));
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Failed to generate unique SKU or Barcode after multiple attempts');
  }

  async findAll(organizationId: string, query: ProductQueryDto) {
    const { page = 1, limit = 20, search, status, categoryId, sortBy, sortOrder = 'desc' } = query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      organizationId,
      status: status || { not: 'DISCONTINUED' },
      deletedAt: null,
    };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput = {};
    if (sortBy === ProductSortBy.NAME) {
      orderBy.name = sortOrder;
    } else if (sortBy === ProductSortBy.PRICE_ASC) {
      orderBy.sellingPrice = 'asc';
    } else if (sortBy === ProductSortBy.PRICE_DESC) {
      orderBy.sellingPrice = 'desc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          category: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    const meta = new PageMetaDto({
      pageOptionsDto: { page, limit, skip },
      itemCount: total,
    });

    return new PageDto(data, meta);
  }

  async findOne(organizationId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId, deletedAt: null },
      include: {
        category: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async update(organizationId: string, productId: string, data: UpdateProductDto, userId: string) {
    await this.findOne(organizationId, productId);

    if (data.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: data.categoryId, organizationId },
      });
      if (!category) {
        throw new BadRequestException('Category not found');
      }
    }

    try {
      const updatedProduct = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.update({
          where: { id: productId },
          data,
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            userId,
            action: 'PRODUCT_UPDATED',
            entity: 'Product',
            entityId: productId,
          },
        });

        return product;
      });

      return updatedProduct;
    } catch (error: any) {
      const isCollision =
        error.code === 'P2002' &&
        (JSON.stringify(error.meta || {}).includes('sku') ||
          JSON.stringify(error.meta || {}).includes('barcode') ||
          error.message?.includes('sku') ||
          error.message?.includes('barcode') ||
          (Array.isArray(error.meta?.target) &&
            (error.meta.target.includes('sku') || error.meta.target.includes('barcode'))));

      if (isCollision) {
        throw new ConflictException('Provided SKU or Barcode already exists in this organization');
      }
      throw error;
    }
  }

  async archive(organizationId: string, productId: string, userId: string) {
    await this.findOne(organizationId, productId);

    const archivedProduct = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id: productId },
        data: { status: 'DISCONTINUED', deletedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'PRODUCT_ARCHIVED',
          entity: 'Product',
          entityId: productId,
        },
      });

      return product;
    });

    return archivedProduct;
  }

  async restore(organizationId: string, productId: string, userId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (!product.deletedAt) {
      throw new ConflictException('Product is not archived');
    }

    const restoredProduct = await this.prisma.$transaction(async (tx) => {
      const restored = await tx.product.update({
        where: { id: productId },
        data: { status: 'ACTIVE', deletedAt: null },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'PRODUCT_RESTORED',
          entity: 'Product',
          entityId: productId,
        },
      });

      return restored;
    });

    return restoredProduct;
  }
}
