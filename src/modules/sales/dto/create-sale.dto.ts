import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';

export class CreateSaleItemDto {
  @ApiProperty({ description: 'Product ID' })
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'Quantity to sell (> 0)' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  quantity: number;

  @ApiPropertyOptional({ description: 'Unit price. If omitted, canonical product selling price will be used.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Discount amount for this item (default: 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  discountAmount?: number;

  @ApiPropertyOptional({ description: 'Tax amount for this item (default: 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  taxAmount?: number;
}

export class CreateSaleDto {
  @ApiProperty({ description: 'Branch ID where the sale occurs' })
  @IsNotEmpty()
  @IsUUID()
  branchId: string;

  @ApiPropertyOptional({ description: 'Customer ID (optional for walk-in sales)' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ description: 'Items in the sale', type: [CreateSaleItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Sale must contain at least one item' })
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items: CreateSaleItemDto[];

  @ApiPropertyOptional({ description: 'Overall sale discount amount (default: 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  discountAmount?: number;

  @ApiPropertyOptional({ description: 'Overall sale tax amount (default: 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  taxAmount?: number;

  @ApiPropertyOptional({ description: 'Amount paid immediately upon sale. If omitted, defaults to full total amount. Set 0 for credit / bakite sale.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  paidAmount?: number;

  @ApiPropertyOptional({ description: 'Optional note' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Idempotency key to prevent duplicate submissions' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
