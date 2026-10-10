import { IsOptional, IsDateString, IsUUID, IsString } from 'class-validator';

export class GetProductProfitabilityQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  allocationRule?: 'ACTUAL_UNITS' | 'ORDER_COUNT' | 'REVENUE_SHARE';
}
