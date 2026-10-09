import { IsOptional, IsEnum, IsString } from 'class-validator';
import { ReceiptStatus } from '@prisma/client';

export class UpdateReceiptDto {
  @IsOptional()
  @IsEnum(ReceiptStatus)
  status?: ReceiptStatus;

  @IsOptional()
  @IsString()
  note?: string;
}
