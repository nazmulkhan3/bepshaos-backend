import { IsOptional, IsEnum, IsString, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PageOptionsDto } from '../../../common/dtos/pagination.dto.js';
import { CategoryStatus } from '@prisma/client';

export enum CategorySortBy {
  CREATED_AT = 'createdAt',
  NAME = 'name',
}

export class CategoryQueryDto extends PageOptionsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  rootOnly?: boolean;

  @IsOptional()
  @IsEnum(CategorySortBy)
  sortBy?: CategorySortBy;
}
