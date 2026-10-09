import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  ValidateNested,
  IsArray,
  IsNumberString,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentDirection, PaymentMethod } from '@prisma/client';

class PaymentAllocationDto {
  @ValidateIf((o) => o.purchaseId == null)
  @IsString()
  @IsNotEmpty()
  saleId?: string;

  @ValidateIf((o) => o.saleId == null)
  @IsString()
  @IsNotEmpty()
  purchaseId?: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;
}

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  branchId: string;

  @IsEnum(PaymentDirection)
  @IsNotEmpty()
  direction: PaymentDirection;

  @ValidateIf((o) => o.direction === PaymentDirection.RECEIVED)
  @IsString()
  @IsNotEmpty()
  customerId?: string;

  @ValidateIf((o) => o.direction === PaymentDirection.PAID)
  @IsString()
  @IsNotEmpty()
  supplierId?: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsEnum(PaymentMethod)
  @IsNotEmpty()
  method: PaymentMethod;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  @IsNotEmpty()
  allocations: PaymentAllocationDto[];

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
