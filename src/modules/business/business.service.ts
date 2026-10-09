import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { CreateBusinessDto } from './dto/create-business.dto.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';

@Injectable()
export class BusinessService {
  constructor(private prisma: DatabaseService) {}

  async create(organizationId: string, createBusinessDto: CreateBusinessDto) {
    const existing = await this.prisma.business.findUnique({
      where: { organizationId },
    });

    if (existing) {
      throw new ConflictException('Business profile already exists for this organization');
    }

    return this.prisma.business.create({
      data: {
        organizationId,
        ...createBusinessDto,
      },
    });
  }

  async findOne(organizationId: string) {
    const business = await this.prisma.business.findUnique({
      where: { organizationId },
    });

    if (!business) {
      throw new NotFoundException('Business profile not found');
    }

    return business;
  }

  async update(organizationId: string, updateBusinessDto: UpdateBusinessDto) {
    const existing = await this.prisma.business.findUnique({
      where: { organizationId },
    });

    if (!existing) {
      throw new NotFoundException('Business profile not found');
    }

    return this.prisma.business.update({
      where: { organizationId },
      data: updateBusinessDto,
    });
  }
}
