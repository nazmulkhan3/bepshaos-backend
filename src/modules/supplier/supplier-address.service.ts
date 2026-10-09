import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateSupplierAddressDto } from './dto/create-supplier-address.dto.js';
import { UpdateSupplierAddressDto } from './dto/update-supplier-address.dto.js';
import { SupplierService } from './supplier.service.js';

@Injectable()
export class SupplierAddressService {
  constructor(
    private prisma: DatabaseService,
    private supplierService: SupplierService,
  ) {}

  async create(organizationId: string, supplierId: string, data: CreateSupplierAddressDto, userId: string) {
    // Verify supplier exists and belongs to the organization
    await this.supplierService.findOne(organizationId, supplierId);

    return this.prisma.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`;
      }

      // If this is the default address, we need to unset other default addresses
      if (data.isDefault) {
        await tx.supplierAddress.updateMany({
          where: { supplierId },
          data: { isDefault: false },
        });
      }

      // If this is the first address, make it default automatically
      if (data.isDefault === undefined) {
        const existingAddressesCount = await tx.supplierAddress.count({
          where: { supplierId },
        });
        if (existingAddressesCount === 0) {
          data.isDefault = true;
        }
      }

      const address = await tx.supplierAddress.create({
        data: {
          supplierId,
          ...data,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'SUPPLIER_ADDRESS_CREATED',
          entity: 'SupplierAddress',
          entityId: address.id,
        },
      });

      return address;
    });
  }

  async findAll(organizationId: string, supplierId: string) {
    // Verify supplier exists and belongs to the organization
    await this.supplierService.findOne(organizationId, supplierId);

    return this.prisma.supplierAddress.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, supplierId: string, addressId: string) {
    // Verify supplier exists and belongs to the organization
    await this.supplierService.findOne(organizationId, supplierId);

    const address = await this.prisma.supplierAddress.findFirst({
      where: { id: addressId, supplierId },
    });

    if (!address) {
      throw new NotFoundException('Supplier address not found');
    }

    return address;
  }

  async update(organizationId: string, supplierId: string, addressId: string, data: UpdateSupplierAddressDto, userId: string) {
    // Verify address exists
    await this.findOne(organizationId, supplierId, addressId);

    return this.prisma.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`;
      }

      // If changing to default, unset others
      if (data.isDefault) {
        await tx.supplierAddress.updateMany({
          where: { supplierId, id: { not: addressId } },
          data: { isDefault: false },
        });
      }

      const updatedAddress = await tx.supplierAddress.update({
        where: { id: addressId },
        data,
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'SUPPLIER_ADDRESS_UPDATED',
          entity: 'SupplierAddress',
          entityId: addressId,
        },
      });

      return updatedAddress;
    });
  }

  async remove(organizationId: string, supplierId: string, addressId: string, userId: string) {
    // Verify address exists
    await this.findOne(organizationId, supplierId, addressId);

    return this.prisma.$transaction(async (tx) => {
      const address = await tx.supplierAddress.delete({
        where: { id: addressId },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'SUPPLIER_ADDRESS_DELETED',
          entity: 'SupplierAddress',
          entityId: addressId,
        },
      });

      return address;
    });
  }
}
