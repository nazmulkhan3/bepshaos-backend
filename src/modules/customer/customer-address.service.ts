import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto.js';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto.js';

@Injectable()
export class CustomerAddressService {
  constructor(private prisma: DatabaseService) {}

  private async verifyCustomer(organizationId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
  }

  async create(organizationId: string, customerId: string, data: CreateCustomerAddressDto, userId: string) {
    await this.verifyCustomer(organizationId, customerId);

    return this.prisma.$transaction(async (tx) => {
      // If it's default, unset other defaults
      if (data.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId },
          data: { isDefault: false },
        });
      }

      const address = await tx.customerAddress.create({
        data: {
          customerId,
          ...data,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'CUSTOMER_ADDRESS_CREATED',
          entity: 'CustomerAddress',
          entityId: address.id,
        },
      });

      return address;
    });
  }

  async findAll(organizationId: string, customerId: string) {
    await this.verifyCustomer(organizationId, customerId);

    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(organizationId: string, customerId: string, addressId: string, data: UpdateCustomerAddressDto, userId: string) {
    await this.verifyCustomer(organizationId, customerId);

    const addressExists = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });

    if (!addressExists) {
      throw new NotFoundException('Customer address not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // If setting to default, unset others
      if (data.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, id: { not: addressId } },
          data: { isDefault: false },
        });
      }

      const updatedAddress = await tx.customerAddress.update({
        where: { id: addressId },
        data,
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'CUSTOMER_ADDRESS_UPDATED',
          entity: 'CustomerAddress',
          entityId: addressId,
        },
      });

      return updatedAddress;
    });
  }

  async remove(organizationId: string, customerId: string, addressId: string, userId: string) {
    await this.verifyCustomer(organizationId, customerId);

    const addressExists = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });

    if (!addressExists) {
      throw new NotFoundException('Customer address not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({
        where: { id: addressId },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'CUSTOMER_ADDRESS_ARCHIVED',
          entity: 'CustomerAddress',
          entityId: addressId,
        },
      });

      return { deleted: true };
    });
  }
}
