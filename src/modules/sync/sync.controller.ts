import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { SyncService } from './sync.service.js';
import { SyncUploadDto, SyncUploadResponseDto, SyncDownloadQueryDto, SyncDownloadResponseDto } from './dto/index.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@ApiTags('Offline Sync')
@ApiBearerAuth()
@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId/sync', version: '1' })
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload a batch of offline operations from mobile Android client',
    description:
      'Processes queued operations idempotently with per-operation authorization, validation, conflict detection, and structured results.',
  })
  @ApiResponse({
    status: 200,
    description: 'Batch processed with structured per-operation results',
    type: SyncUploadResponseDto,
  })
  async upload(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: SyncUploadDto,
  ): Promise<SyncUploadResponseDto> {
    return this.syncService.processUploadBatch(ctx.organizationId, ctx.userId, dto);
  }

  @Get('download')
  @ApiOperation({
    summary: 'Incrementally download changed entities since cursor',
    description:
      'Returns customers, categories, products, sales, and payments modified after the `since` cursor timestamp.',
  })
  @ApiResponse({
    status: 200,
    description: 'Incremental sync data and next cursor',
    type: SyncDownloadResponseDto,
  })
  async download(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() query: SyncDownloadQueryDto,
  ): Promise<SyncDownloadResponseDto> {
    return this.syncService.getIncrementalDownload(ctx.organizationId, query);
  }
}
