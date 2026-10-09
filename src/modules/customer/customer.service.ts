import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { CustomerQueryDto } from './dto/customer-query.dto.js';
import { PageDto, PageMetaDto } from '../../common/dtos/pagination.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class CustomerService {
  constructor(private prisma: DatabaseService) {}

  private async generateCustomerCode(organizationId: string): Promise<string> {
    const lastCustomer = await this.prisma.customer.findFirst({
      where: { organizationId },
      orderBy: { customerCode: 'desc' },
      select: { customerCode: true },
    });

    if (!lastCustomer || !lastCustomer.customerCode) {
      return 'CUS-000001';
    }

    const match = lastCustomer.customerCode.match(/CUS-(\d+)/);
    if (!match) return 'CUS-000001';

    const lastNumber = parseInt(match[1], 10);
    return `CUS-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  async create(organizationId: string, data: CreateCustomerDto, userId: string) {
    let retries = 0;
    while (retries < 5) {
      try {
        const customerCode = await this.generateCustomerCode(organizationId);

        const customer = await this.prisma.$transaction(async (tx) => {
          const newCustomer = await tx.customer.create({
            data: {
              organizationId,
              customerCode,
              ...data,
            },
          });

          await tx.auditLog.create({
            data: {
              organizationId,
              userId,
              action: 'CUSTOMER_CREATED',
              entity: 'Customer',
              entityId: newCustomer.id,
              newData: { customerCode },
            },
          });

          return newCustomer;
        });

        return customer;
      } catch (error: any) {
        if (error.code === 'P2002' && error.meta?.target?.includes('customerCode')) {
          retries++;
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Failed to generate a unique customer code after multiple attempts');
  }

  async findAll(organizationId: string, query: CustomerQueryDto) {
    const { page = 1, limit = 20, search, status, sortBy, sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      organizationId,
      status: status || { not: 'ARCHIVED' }, // By default don't show archived
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { customerCode: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.CustomerOrderByWithRelationInput = {};
    if (sortBy && ['name', 'createdAt', 'customerCode'].includes(sortBy)) {
      orderBy[sortBy as keyof Prisma.CustomerOrderByWithRelationInput] = sortOrder;
    } else {
      orderBy.createdAt = 'desc';
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.customer.count({ where }),
    ]);

    const meta = new PageMetaDto({
      pageOptionsDto: { page, limit, skip },
      itemCount: total,
    });

    return new PageDto(data, meta);
  }

  async findOne(organizationId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      include: { addresses: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async update(organizationId: string, customerId: string, data: UpdateCustomerDto, userId: string) {
    // Verify existence
    await this.findOne(organizationId, customerId);

    const updatedCustomer = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: customerId },
        data,
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'CUSTOMER_UPDATED',
          entity: 'Customer',
          entityId: customerId,
        },
      });

      return customer;
    });

    return updatedCustomer;
  }

  async archive(organizationId: string, customerId: string, userId: string) {
    // Verify existence
    await this.findOne(organizationId, customerId);

    const archivedCustomer = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: { status: 'ARCHIVED' },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'CUSTOMER_ARCHIVED',
          entity: 'Customer',
          entityId: customerId,
        },
      });

      return customer;
    });

    return archivedCustomer;
  }
}
