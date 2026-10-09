import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { CategoryQueryDto, CategorySortBy } from './dto/category-query.dto.js';
import { PageDto, PageMetaDto } from '../../common/dtos/pagination.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class CategoryService {
  constructor(private prisma: DatabaseService) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  async create(organizationId: string, data: CreateCategoryDto, userId: string) {
    let slug = data.slug || this.generateSlug(data.name);

    if (data.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: data.parentId, organizationId },
      });
      if (!parent) {
        throw new BadRequestException('Parent category not found');
      }
    }

    let retries = 0;
    while (retries < 5) {
      try {
        const category = await this.prisma.$transaction(async (tx) => {
          const newCategory = await tx.category.create({
            data: {
              organizationId,
              ...data,
              slug,
            },
          });

          await tx.auditLog.create({
            data: {
              organizationId,
              userId,
              action: 'CATEGORY_CREATED',
              entity: 'Category',
              entityId: newCategory.id,
              newData: { slug },
            },
          });

          return newCategory;
        });

        return category;
      } catch (error: any) {
        const isCollision =
          error.code === 'P2002' &&
          (JSON.stringify(error.meta || {}).includes('slug') ||
            error.message?.includes('slug') ||
            (Array.isArray(error.meta?.target) && error.meta.target.includes('slug')));

        if (isCollision) {
          retries++;
          slug = `${this.generateSlug(data.name)}-${Math.floor(Math.random() * 1000)}`;
          await new Promise((resolve) => setTimeout(resolve, 10 * retries));
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Failed to generate a unique slug for category');
  }

  async findAll(organizationId: string, query: CategoryQueryDto) {
    const { page = 1, limit = 20, search, status, rootOnly, parentId, sortBy, sortOrder = 'desc' } = query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.CategoryWhereInput = {
      organizationId,
      status: status || { not: 'ARCHIVED' },
      deletedAt: null,
    };

    if (rootOnly) {
      where.parentId = null;
    } else if (parentId) {
      where.parentId = parentId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.CategoryOrderByWithRelationInput = {};
    if (sortBy === CategorySortBy.NAME) {
      orderBy.name = sortOrder;
    } else {
      orderBy.createdAt = sortOrder;
    }

    const [data, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          parent: { select: { id: true, name: true, slug: true } },
          _count: { select: { children: true, products: true } },
        },
      }),
      this.prisma.category.count({ where }),
    ]);

    const meta = new PageMetaDto({
      pageOptionsDto: { page, limit, skip },
      itemCount: total,
    });

    return new PageDto(data, meta);
  }

  async findOne(organizationId: string, categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId, deletedAt: null },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: {
          where: { deletedAt: null, status: { not: 'ARCHIVED' } },
          select: { id: true, name: true, slug: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async update(organizationId: string, categoryId: string, data: UpdateCategoryDto, userId: string) {
    const existing = await this.findOne(organizationId, categoryId);

    if (data.parentId && data.parentId === categoryId) {
      throw new BadRequestException('Category cannot be its own parent');
    }

    if (data.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: data.parentId, organizationId },
      });
      if (!parent) {
        throw new BadRequestException('Parent category not found');
      }
    }

    let slug = data.slug || (data.name ? this.generateSlug(data.name) : existing.slug);

    let retries = 0;
    while (retries < 5) {
      try {
        const updatedCategory = await this.prisma.$transaction(async (tx) => {
          const category = await tx.category.update({
            where: { id: categoryId },
            data: { ...data, slug },
          });

          await tx.auditLog.create({
            data: {
              organizationId,
              userId,
              action: 'CATEGORY_UPDATED',
              entity: 'Category',
              entityId: categoryId,
            },
          });

          return category;
        });

        return updatedCategory;
      } catch (error: any) {
        const isCollision =
          error.code === 'P2002' &&
          (JSON.stringify(error.meta || {}).includes('slug') ||
            error.message?.includes('slug') ||
            (Array.isArray(error.meta?.target) && error.meta.target.includes('slug')));

        if (isCollision) {
          retries++;
          slug = `${this.generateSlug(data.name || existing.name)}-${Math.floor(Math.random() * 1000)}`;
          await new Promise((resolve) => setTimeout(resolve, 10 * retries));
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Failed to generate a unique slug for category during update');
  }

  async archive(organizationId: string, categoryId: string, userId: string) {
    await this.findOne(organizationId, categoryId);

    const archivedCategory = await this.prisma.$transaction(async (tx) => {
      const category = await tx.category.update({
        where: { id: categoryId },
        data: { status: 'ARCHIVED' },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'CATEGORY_ARCHIVED',
          entity: 'Category',
          entityId: categoryId,
        },
      });

      return category;
    });

    return archivedCategory;
  }

  async restore(organizationId: string, categoryId: string, userId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId, deletedAt: null },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (category.status !== 'ARCHIVED') {
      throw new ConflictException('Category is not archived');
    }

    const restoredCategory = await this.prisma.$transaction(async (tx) => {
      const restored = await tx.category.update({
        where: { id: categoryId },
        data: { status: 'ACTIVE' },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'CATEGORY_RESTORED',
          entity: 'Category',
          entityId: categoryId,
        },
      });

      return restored;
    });

    return restoredCategory;
  }
}
