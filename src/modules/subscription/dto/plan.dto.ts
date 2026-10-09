import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlanDto {
  @ApiProperty({ description: 'Unique uppercase plan code', example: 'ENTERPRISE_CUSTOM' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Plan display name', example: 'Enterprise Custom' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Plan description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Active status', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Public catalog visibility', default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'Sort order for display', default: 0 })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Currency', default: 'BDT' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ description: 'Monthly price in currency units', example: 1500 })
  @IsNumber()
  @Min(0)
  priceMonthly: number;

  @ApiProperty({ description: 'Yearly price in currency units (must be 0 until approved)', example: 0 })
  @IsNumber()
  @Min(0)
  priceYearly: number;

  @ApiPropertyOptional({ description: 'Maximum branches allowed (null = unlimited)', example: 5 })
  @IsOptional()
  maxBranches?: number | null;

  @ApiPropertyOptional({ description: 'Maximum staff allowed (null = unlimited)', example: 10 })
  @IsOptional()
  maxStaff?: number | null;

  @ApiPropertyOptional({ description: 'Maximum products allowed (null = unlimited)', example: 5000 })
  @IsOptional()
  maxProducts?: number | null;

  @ApiPropertyOptional({ description: 'Maximum sales per month (null = unlimited)', example: 2000 })
  @IsOptional()
  maxTransactions?: number | null;

  @ApiPropertyOptional({ description: 'JSON metadata/features flags' })
  @IsOptional()
  features?: Record<string, any>;
}

export class UpdatePlanDto {
  @ApiPropertyOptional({ description: 'Plan display name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Plan description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Public catalog visibility' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'Sort order' })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Monthly price' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMonthly?: number;

  @ApiPropertyOptional({ description: 'Yearly price (must be 0 until approved)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceYearly?: number;

  @ApiPropertyOptional({ description: 'Maximum branches' })
  @IsOptional()
  maxBranches?: number | null;

  @ApiPropertyOptional({ description: 'Maximum staff' })
  @IsOptional()
  maxStaff?: number | null;

  @ApiPropertyOptional({ description: 'Maximum products' })
  @IsOptional()
  maxProducts?: number | null;

  @ApiPropertyOptional({ description: 'Maximum sales per month' })
  @IsOptional()
  maxTransactions?: number | null;

  @ApiPropertyOptional({ description: 'JSON metadata/features' })
  @IsOptional()
  features?: Record<string, any>;
}
