import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateExpenseCategoryDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  expenseAccountId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

