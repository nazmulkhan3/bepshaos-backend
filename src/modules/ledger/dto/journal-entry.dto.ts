import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNotEmpty,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JournalSourceType } from '@prisma/client';

export class JournalLineDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  debit: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  credit: number;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;
}

export class CreateJournalEntryDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsOptional()
  @IsEnum(JournalSourceType)
  sourceType?: JournalSourceType;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}
