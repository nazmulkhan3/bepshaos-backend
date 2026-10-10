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

export class CreatePurchaseItemDto {
  @ApiProperty({ description: 'Product ID' })
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'Quantity to purchase (> 0)' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  quantity: number;

  @ApiProperty({ description: 'Unit cost.' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitCost: number;

  @ApiPropertyOptional({ description: 'Discount amount for this item (default: 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  discount?: number;

  @ApiPropertyOptional({ description: 'Tax amount for this item (default: 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tax?: number;
}

export class CreatePurchaseDto {
  @ApiProperty({ description: 'Branch ID where the purchase occurs' })
  @IsNotEmpty()
  @IsUUID()
  branchId: string;

  @ApiPropertyOptional({ description: 'Supplier ID (optional for walk-in purchases)' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({ description: 'Items in the purchase', type: [CreatePurchaseItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Purchase must contain at least one item' })
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  items: CreatePurchaseItemDto[];

  @ApiPropertyOptional({ description: 'Overall purchase discount amount (default: 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  discount?: number;

  @ApiPropertyOptional({ description: 'Overall purchase tax amount (default: 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tax?: number;

  // ── Phase 2B: Purchase Landed / Acquisition Costs ──────────────────────────
  // These are capitalizable costs of acquiring and transporting goods.
  // They increase inventory valuation (MWAC) but are NOT necessarily added to
  // the supplier payable (e.g. freight paid to a third-party carrier).
  // For third-party costs, also record a separate Expense entry to avoid
  // double-counting as an operating expense.

  @ApiPropertyOptional({
    description: 'Freight / transport cost capitalizable to inventory (default: 0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  freight?: number;

  @ApiPropertyOptional({
    description: 'Loading / unloading labour cost capitalizable to inventory (default: 0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  loading?: number;

  @ApiPropertyOptional({
    description: 'Handling / storage cost capitalizable to inventory (default: 0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  handling?: number;

  @ApiPropertyOptional({
    description: 'Import clearing / customs charges capitalizable to inventory (default: 0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  clearingCharges?: number;

  @ApiPropertyOptional({
    description: 'Any other capitalizable acquisition costs (default: 0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  otherCosts?: number;

  @ApiPropertyOptional({
    description: 'Optional ID of a separately recorded Expense to capitalize into this purchase, preventing duplicate operating expense recognition',
  })
  @IsOptional()
  @IsUUID()
  linkedExpenseId?: string;

  @ApiPropertyOptional({ description: 'Optional note' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Idempotency key to prevent duplicate submissions' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
