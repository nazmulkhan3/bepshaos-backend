import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, IsDateString } from 'class-validator';
import { PageOptionsDto } from '../../../common/dtos/pagination.dto.js';
import { PurchaseStatus } from '@prisma/client';

export enum PurchaseSortBy {
  CREATED_AT = 'createdAt',
  TOTAL = 'total',
  PURCHASE_NUMBER = 'purchaseNumber',
}

export class PurchaseQueryDto extends PageOptionsDto {
  @ApiPropertyOptional({ description: 'Filter by Branch ID' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Filter by Supplier ID' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Filter by Purchase Status', enum: PurchaseStatus })
  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;

  @ApiPropertyOptional({ description: 'Search term (matches purchase number)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Field to sort by', enum: PurchaseSortBy })
  @IsOptional()
  @IsEnum(PurchaseSortBy)
  sortBy?: PurchaseSortBy;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'] as const)
  sortOrder?: 'asc' | 'desc' = 'desc';
}
