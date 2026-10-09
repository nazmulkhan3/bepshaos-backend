import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsNumberString,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreateExpenseDto {
  @IsString()
  @IsNotEmpty()
  branchId: string;

  @IsString()
  @IsOptional()
  expenseDate?: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsEnum(PaymentMethod)
  @IsNotEmpty()
  paymentMethod: PaymentMethod;

  @IsString()
  @IsNotEmpty()
  paymentAccountId: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
