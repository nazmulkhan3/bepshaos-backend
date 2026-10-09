import { IsOptional, IsEnum, IsString, IsUUID } from 'class-validator';
import { PageOptionsDto } from '../../../common/dtos/pagination.dto.js';
import { ProductStatus } from '@prisma/client';

export enum ProductSortBy {
  CREATED_AT = 'createdAt',
  NAME = 'name',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
}

export class ProductQueryDto extends PageOptionsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(ProductSortBy)
  sortBy?: ProductSortBy;
}
