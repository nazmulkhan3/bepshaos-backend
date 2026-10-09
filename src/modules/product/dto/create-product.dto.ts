import { IsString, IsOptional, IsEnum, IsUUID, MaxLength, IsNumber, Min } from 'class-validator';
import { ProductStatus } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  sku?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  barcode?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  brand?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  purchasePrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sellingPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  taxRate?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minStock?: number;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;
}
