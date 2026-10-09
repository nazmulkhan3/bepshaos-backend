import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { AccountType, AccountCategory } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsEnum(AccountCategory)
  category: AccountCategory;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  parentId?: string;
}
