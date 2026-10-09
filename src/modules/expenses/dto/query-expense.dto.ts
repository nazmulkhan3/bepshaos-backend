import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ExpenseStatus } from '@prisma/client';
import { PageOptionsDto } from '../../../common/dtos/pagination.dto.js';

export class QueryExpenseDto extends PageOptionsDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}
