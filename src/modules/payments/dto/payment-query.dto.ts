import {
  IsOptional,
  IsString,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentDirection, PaymentStatus, PaymentMethod } from '@prisma/client';
import { PageOptionsDto } from '../../../common/dtos/pagination.dto.js';

export enum PaymentSortBy {
  CREATED_AT = 'createdAt',
  AMOUNT = 'amount',
  PAYMENT_NUMBER = 'paymentNumber',
}

export class PaymentQueryDto extends PageOptionsDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsEnum(PaymentDirection)
  direction?: PaymentDirection;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(PaymentSortBy)
  sortBy?: PaymentSortBy = PaymentSortBy.CREATED_AT;

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
