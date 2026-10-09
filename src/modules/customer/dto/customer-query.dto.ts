import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PageOptionsDto } from '../../../common/dtos/pagination.dto.js';
import { CustomerStatus } from '@prisma/client';

export class CustomerQueryDto extends PageOptionsDto {
  @ApiPropertyOptional({ description: 'Search term for name, code, email, or phone' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: CustomerStatus })
  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus;

  @ApiPropertyOptional({ description: 'Sort field (e.g., createdAt, name)' })
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ description: 'Sort direction (asc or desc)', enum: ['asc', 'desc'] })
  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}
