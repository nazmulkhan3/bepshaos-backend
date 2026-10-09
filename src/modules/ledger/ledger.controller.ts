import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LedgerService } from './ledger.service.js';
import {
  CreateAccountDto,
  UpdateAccountDto,
  CreateJournalEntryDto,
  LedgerQueryDto,
  KhataQueryDto,
  JournalQueryDto,
} from './dto/index.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { PermissionGuard } from '../../common/guards/permission.guard.js';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator.js';
import type { OrganizationContext } from '../../common/interfaces/organization-context.interface.js';

@UseGuards(TenantGuard, PermissionGuard)
@Controller({ path: 'organizations/:organizationId', version: '1' })
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  // ─── Accounts ─────────────────────────────────────────────────────────────

  @Get('ledger/accounts')
  @RequirePermissions('ledger:account-read')
  listAccounts(@CurrentOrganization() ctx: OrganizationContext) {
    return this.ledgerService.listAccounts(ctx.organizationId);
  }

  @Post('ledger/accounts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('ledger:account-create')
  createAccount(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: CreateAccountDto,
  ) {
    return this.ledgerService.createAccount(ctx.organizationId, ctx.userId, dto);
  }

  @Get('ledger/accounts/:accountId')
  @RequirePermissions('ledger:account-read')
  getAccount(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('accountId') accountId: string,
  ) {
    return this.ledgerService.getAccount(ctx.organizationId, accountId);
  }

  @Patch('ledger/accounts/:accountId')
  @RequirePermissions('ledger:account-update')
  updateAccount(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('accountId') accountId: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.ledgerService.updateAccount(ctx.organizationId, accountId, ctx.userId, dto);
  }

  @Get('ledger/accounts/:accountId/balance')
  @RequirePermissions('ledger:read')
  getAccountBalance(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('accountId') accountId: string,
  ) {
    return this.ledgerService.getAccountBalance(ctx.organizationId, accountId);
  }

  @Get('ledger/accounts/:accountId/ledger')
  @RequirePermissions('ledger:read')
  getAccountLedger(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('accountId') accountId: string,
    @Query() query: LedgerQueryDto,
  ) {
    return this.ledgerService.getAccountLedger(ctx.organizationId, accountId, query);
  }

  // ─── Journal Entries ──────────────────────────────────────────────────────

  @Get('journal-entries')
  @RequirePermissions('ledger:journal-read')
  listJournalEntries(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query() query: JournalQueryDto,
  ) {
    return this.ledgerService.listJournalEntries(ctx.organizationId, query);
  }

  @Post('journal-entries')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('ledger:journal-create')
  createJournalEntry(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.ledgerService.createManualJournalEntry(ctx.organizationId, ctx.userId, dto);
  }

  @Get('journal-entries/:entryId')
  @RequirePermissions('ledger:journal-read')
  getJournalEntry(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('entryId') entryId: string,
  ) {
    return this.ledgerService.getJournalEntry(ctx.organizationId, entryId);
  }

  @Post('journal-entries/:entryId/reverse')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('ledger:reverse')
  reverseJournalEntry(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('entryId') entryId: string,
    @Body('reason') reason: string,
  ) {
    return this.ledgerService.reverseJournalEntry(ctx.organizationId, entryId, ctx.userId, reason);
  }

  // ─── Customer Khata ───────────────────────────────────────────────────────

  @Get('customers/:customerId/khata')
  @RequirePermissions('ledger:read')
  getCustomerKhata(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('customerId') customerId: string,
    @Query() query: KhataQueryDto,
  ) {
    return this.ledgerService.getCustomerKhata(ctx.organizationId, customerId, query);
  }

  // ─── Supplier Khata ───────────────────────────────────────────────────────

  @Get('suppliers/:supplierId/khata')
  @RequirePermissions('ledger:read')
  getSupplierKhata(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('supplierId') supplierId: string,
    @Query() query: KhataQueryDto,
  ) {
    return this.ledgerService.getSupplierKhata(ctx.organizationId, supplierId, query);
  }
}
