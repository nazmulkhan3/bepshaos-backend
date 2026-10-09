import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SyncEntityType {
  CUSTOMER = 'CUSTOMER',
  CATEGORY = 'CATEGORY',
  PRODUCT = 'PRODUCT',
  SALE = 'SALE',
  PAYMENT = 'PAYMENT',
  INVENTORY_ADJUSTMENT = 'INVENTORY_ADJUSTMENT',
}

export enum SyncOperationAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

export enum SyncOperationStatus {
  SUCCESS = 'SUCCESS',
  CONFLICT = 'CONFLICT',
  REJECTED = 'REJECTED',
  SKIPPED = 'SKIPPED',
}

export class SyncOperationDto {
  @ApiProperty({ description: 'Client-assigned unique operation ID for idempotency' })
  @IsString()
  @IsNotEmpty()
  operationId: string;

  @ApiProperty({ enum: SyncEntityType, description: 'Target entity type' })
  @IsEnum(SyncEntityType)
  entityType: SyncEntityType;

  @ApiProperty({ enum: SyncOperationAction, description: 'Action type' })
  @IsEnum(SyncOperationAction)
  action: SyncOperationAction;

  @ApiPropertyOptional({ description: 'Client-side UUID of the record' })
  @IsString()
  @IsOptional()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Server-side UUID of the record if existing/known' })
  @IsString()
  @IsOptional()
  serverId?: string;

  @ApiPropertyOptional({ description: 'Client timestamp when change was performed' })
  @IsString()
  @IsOptional()
  clientTimestamp?: string;

  @ApiProperty({ description: 'Payload data for the operation' })
  @IsObject()
  data: Record<string, any>;
}

export class SyncUploadDto {
  @ApiProperty({ type: [SyncOperationDto], description: 'List of queued operations to sync' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncOperationDto)
  operations: SyncOperationDto[];
}

export class SyncOperationResultDto {
  operationId: string;
  status: SyncOperationStatus;
  entityType: SyncEntityType;
  clientId?: string;
  serverId?: string;
  message?: string;
  serverData?: any;
  conflictDetails?: {
    reason: string;
    serverRecord?: any;
    clientRecord?: any;
  };
}

export class SyncUploadResponseDto {
  batchId: string;
  processedCount: number;
  successCount: number;
  conflictCount: number;
  rejectedCount: number;
  results: SyncOperationResultDto[];
}
