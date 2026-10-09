import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateExpenseCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  expenseAccountId: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
