import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SyncDownloadQueryDto {
  @ApiPropertyOptional({ description: 'ISO date string cursor for incremental sync changes since' })
  @IsDateString()
  @IsOptional()
  since?: string;

  @ApiPropertyOptional({ description: 'Limit per entity page (1 to 200)' })
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 100;
}

export class SyncDownloadResponseDto {
  serverTime: string;
  nextCursor: string;
  hasMore: boolean;
  customers: any[];
  categories: any[];
  products: any[];
  sales: any[];
  payments: any[];
}
