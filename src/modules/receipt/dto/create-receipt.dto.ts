import { IsString, IsOptional } from 'class-validator';

export class CreateReceiptDto {
  @IsString()
  paymentId: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
