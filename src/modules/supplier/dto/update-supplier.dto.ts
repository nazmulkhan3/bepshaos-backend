import { PartialType } from '@nestjs/swagger';
import { CreateSupplierDto } from './create-supplier.dto.js';
import { IsEnum, IsOptional } from 'class-validator';
import { SupplierStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @ApiPropertyOptional({ enum: SupplierStatus })
  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;
}
