import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { PageOptionsDto } from '../../../common/dtos/pagination.dto.js';
import { InventoryMovementType } from '@prisma/client';

export class InventoryQueryDto extends PageOptionsDto {
  @ApiPropertyOptional({ description: 'Filter by Branch ID' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Filter by Product ID' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Search term for product name or SKU' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class MovementQueryDto extends PageOptionsDto {
  @ApiPropertyOptional({ description: 'Filter by Branch ID' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Filter by Product ID' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Filter by Movement Type', enum: InventoryMovementType })
  @IsOptional()
  @IsString()
  movementType?: InventoryMovementType;
}

export class StockInDto {
  @ApiProperty({ description: 'Branch ID' })
  @IsNotEmpty()
  @IsUUID()
  branchId: string;

  @ApiProperty({ description: 'Product ID' })
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'Quantity to add' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  quantity: number;

  @ApiPropertyOptional({ description: 'Note or reason' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Idempotency Key' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class StockOutDto {
  @ApiProperty({ description: 'Branch ID' })
  @IsNotEmpty()
  @IsUUID()
  branchId: string;

  @ApiProperty({ description: 'Product ID' })
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'Quantity to remove' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  quantity: number;

  @ApiPropertyOptional({ description: 'Note or reason' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Idempotency Key' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class StockAdjustDto {
  @ApiProperty({ description: 'Branch ID' })
  @IsNotEmpty()
  @IsUUID()
  branchId: string;

  @ApiProperty({ description: 'Product ID' })
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'New total physical quantity' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  newQuantity: number;

  @ApiPropertyOptional({ description: 'Note or reason' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Idempotency Key' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
