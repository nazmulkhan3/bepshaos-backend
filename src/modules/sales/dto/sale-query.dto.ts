import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PageOptionsDto } from '../../../common/dtos/pagination.dto.js';
import { SaleStatus } from '@prisma/client';

export enum SaleSortBy {
  createdAt = 'createdAt',
  saleNumber = 'saleNumber',
  totalAmount = 'totalAmount',
}

export class SaleQueryDto extends PageOptionsDto {
  @ApiPropertyOptional({ description: 'Search term for saleNumber or customer name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by branch ID' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Filter by customer ID' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: SaleStatus, description: 'Filter by sale status' })
  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;

  @ApiPropertyOptional({ description: 'Start date filter (inclusive, ISO format)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End date filter (inclusive, ISO format)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: SaleSortBy, default: SaleSortBy.createdAt })
  @IsOptional()
  @IsEnum(SaleSortBy)
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'] as const)
  sortOrder?: 'asc' | 'desc' = 'desc';
}
