import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PageOptionsDto } from '../../../common/dtos/pagination.dto.js';
import { SupplierStatus } from '@prisma/client';

export enum SupplierSortBy {
  createdAt = 'createdAt',
  name = 'name',
  supplierCode = 'supplierCode',
  companyName = 'companyName',
}

export class SupplierQueryDto extends PageOptionsDto {
  @ApiPropertyOptional({ description: 'Search term for name, companyName, email, phone, supplierCode' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: SupplierStatus, description: 'Filter by status' })
  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;

  @ApiPropertyOptional({ enum: SupplierSortBy, description: 'Sort field' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'] as const)
  sortOrder?: 'asc' | 'desc' = 'desc';
}
