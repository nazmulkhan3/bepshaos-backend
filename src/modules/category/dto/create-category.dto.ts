import { IsString, IsOptional, IsEnum, IsUUID, MaxLength } from 'class-validator';
import { CategoryStatus } from '@prisma/client';
import { Transform } from 'class-transformer';

export class CreateCategoryDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  slug?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsEnum(CategoryStatus)
  @IsOptional()
  status?: CategoryStatus;
}
