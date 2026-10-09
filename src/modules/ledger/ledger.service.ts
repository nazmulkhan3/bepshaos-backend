import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import {
  Prisma,
  AccountType,
  AccountCategory,
  JournalEntryStatus,
  JournalSourceType,
  PaymentMethod,
  PaymentDirection,
} from '@prisma/client';
import { Decimal } from 'decimal.js';
import crypto from 'crypto';
import { CreateAccountDto, UpdateAccountDto, CreateJournalEntryDto } from './dto/index.js';
import { LedgerQueryDto, KhataQueryDto, JournalQueryDto } from './dto/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// System Account Definitions
// ─────────────────────────────────────────────────────────────────────────────
export const SYSTEM_ACCOUNTS = [
  { code: '1000', name: 'Cash',                type: AccountType.ASSET,     category: AccountCategory.CASH },
  { code: '1010', name: 'Bank',                type: AccountType.ASSET,     category: AccountCategory.BANK },
  { code: '1100', name: 'Accounts Receivable', type: AccountType.ASSET,     category: AccountCategory.ACCOUNTS_RECEIVABLE },
  { code: '1200', name: 'Inventory',           type: AccountType.ASSET,     category: AccountCategory.INVENTORY },
  { code: '2000', name: 'Accounts Payable',    type: AccountType.LIABILITY, category: AccountCategory.ACCOUNTS_PAYABLE },
  { code: '3000', name: 'Owner Equity',        type: AccountType.EQUITY,    category: AccountCategory.OWNER_EQUITY },
  { code: '4000', name: 'Sales Revenue',       type: AccountType.REVENUE,   category: AccountCategory.SALES_REVENUE },
  { code: '5000', name: 'General Expense',     type: AccountType.EXPENSE,   category: AccountCategory.GENERAL_EXPENSE },
];

// PaymentMethod → ledger account category mapping
const PAYMENT_METHOD_TO_ACCOUNT: Record<PaymentMethod, AccountCategory> = {
  [PaymentMethod.CASH]:  AccountCategory.CASH,
  [PaymentMethod.BANK]:  AccountCategory.BANK,
  [PaymentMethod.BKASH]: AccountCategory.BANK,
  [PaymentMethod.NAGAD]: AccountCategory.BANK,
  [PaymentMethod.CARD]:  AccountCategory.BANK,
  [PaymentMethod.OTHER]: AccountCategory.CASH,
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal posting types
// ─────────────────────────────────────────────────────────────────────────────
export interface PostJournalParams {
  organizationId: string;
  branchId?: string;
  description: string;
  sourceType: JournalSourceType;
  sourceId?: string;
  idempotencyKey?: string;
  createdBy?: string;
  lines: Array<{
    accountCategory?: AccountCategory;
    accountId?: string;
    description?: string;
    debit: string;  // Decimal string
    credit: string; // Decimal string
    customerId?: string;
    supplierId?: string;
  }>;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: DatabaseService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM ACCOUNTS — provision during org creation
  // ─────────────────────────────────────────────────────────────────────────

  async provisionSystemAccounts(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    for (const acct of SYSTEM_ACCOUNTS) {
      await tx.account.upsert({
        where: { organizationId_code: { organizationId, code: acct.code } },
        update: {},
        create: {
          organizationId,
          code: acct.code,
          name: acct.name,
          type: acct.type,
          category: acct.category,
          isSystem: true,
          isActive: true,
        },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCOUNT MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────

  private async requireAccount(
    organizationId: string,
    category: AccountCategory,
    tx: Prisma.TransactionClient,
  ) {
    const account = await tx.account.findFirst({
      where: { organizationId, category, isActive: true },
    });
    if (!account) {
      throw new BadRequestException(
        `No active account found for category ${category}. Please ensure system accounts are provisioned.`,
      );
    }
    return account;
  }

  private async requireAccountById(
    organizationId: string,
    accountId: string,
    tx: Prisma.TransactionClient,
  ) {
    const account = await tx.account.findFirst({
      where: { id: accountId, organizationId },
    });
    if (!account) {
      throw new NotFoundException(`Account ${accountId} not found in this organization`);
    }
    if (!account.isActive) {
      throw new BadRequestException(`Account ${account.code} is inactive and cannot receive postings`);
    }
    return account;
  }

  async createAccount(organizationId: string, userId: string, dto: CreateAccountDto) {
    // Validate parent
    if (dto.parentId) {
      const parent = await this.prisma.account.findFirst({
        where: { id: dto.parentId, organizationId },
      });
      if (!parent) {
        throw new NotFoundException('Parent account not found in this organization');
      }
      if (dto.parentId === dto.parentId) {
        // Extra protection — self-parent check if id was somehow the same (handled at DB level too)
      }
    }

    // Check for duplicate code
    const existing = await this.prisma.account.findUnique({
      where: { organizationId_code: { organizationId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException(`Account code ${dto.code} already exists in this organization`);
    }

    const account = await this.prisma.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: {
          organizationId,
          code: dto.code,
          name: dto.name,
          type: dto.type,
          category: dto.category,
          parentId: dto.parentId || null,
          isSystem: false,
          isActive: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'ACCOUNT_CREATED',
          entity: 'Account',
          entityId: created.id,
          newData: created as any,
        },
      });

      return created;
    });

    return account;
  }

  async updateAccount(organizationId: string, accountId: string, userId: string, dto: UpdateAccountDto) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, organizationId },
    });
    if (!account) throw new NotFoundException('Account not found');

    // System accounts: cannot change type or deactivate unless there are no postings
    if (account.isSystem && dto.isActive === false) {
      throw new ForbiddenException('System accounts cannot be deactivated');
    }

    // Validate parent if changing
    if (dto.parentId) {
      if (dto.parentId === accountId) {
        throw new BadRequestException('An account cannot be its own parent');
      }
      const parent = await this.prisma.account.findFirst({
        where: { id: dto.parentId, organizationId },
      });
      if (!parent) throw new NotFoundException('Parent account not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.account.update({
        where: { id: accountId },
        data: {
          name: dto.name,
          isActive: dto.isActive,
          parentId: dto.parentId,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'ACCOUNT_UPDATED',
          entity: 'Account',
          entityId: accountId,
          oldData: account as any,
          newData: upd as any,
        },
      });

      return upd;
    });

    return updated;
  }

  async listAccounts(organizationId: string) {
    return this.prisma.account.findMany({
      where: { organizationId },
      orderBy: { code: 'asc' },
      include: { parent: { select: { id: true, code: true, name: true } } },
    });
  }

  async getAccount(organizationId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, organizationId },
      include: {
        parent: { select: { id: true, code: true, name: true } },
        children: { select: { id: true, code: true, name: true, isActive: true } },
      },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNAL NUMBER GENERATION
  // ─────────────────────────────────────────────────────────────────────────

  private async generateJournalNumber(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const last = await tx.journalEntry.findFirst({
      where: { organizationId },
      orderBy: { entryNumber: 'desc' },
      select: { entryNumber: true },
    });

    if (!last?.entryNumber) return 'JE-000001';

    const match = last.entryNumber.match(/JE-(\d+)/);
    if (!match) return 'JE-000001';

    const n = parseInt(match[1], 10);
    return `JE-${String(n + 1).padStart(6, '0')}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CORE JOURNAL POSTING ENGINE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Post a double-entry journal inside an existing transaction.
   * Validates balance: SUM(debit) == SUM(credit).
   * Throws if unbalanced.
   * Supports idempotency: same sourceType+sourceId → returns existing.
   */
  async postJournal(
    params: PostJournalParams,
    tx: Prisma.TransactionClient,
  ) {
    const { organizationId, branchId, description, sourceType, sourceId, idempotencyKey, createdBy, lines } = params;

    // ── Idempotency check (source uniqueness for non-MANUAL) ──────────────
    if (sourceType !== JournalSourceType.MANUAL && sourceId) {
      const existing = await tx.journalEntry.findUnique({
        where: { organizationId_sourceType_sourceId: { organizationId, sourceType, sourceId } },
        include: { lines: true },
      });
      if (existing) return existing;
    }

    if (idempotencyKey) {
      const existing = await tx.journalEntry.findUnique({
        where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
        include: { lines: true },
      });
      if (existing) return existing;
    }

    // ── Resolve accounts ──────────────────────────────────────────────────
    const resolvedLines: Array<{
      accountId: string;
      description?: string;
      debit: Decimal;
      credit: Decimal;
      customerId?: string;
      supplierId?: string;
    }> = [];

    for (const line of lines) {
      let accountId = line.accountId;

      if (!accountId && line.accountCategory) {
        const acct = await this.requireAccount(organizationId, line.accountCategory, tx);
        accountId = acct.id;
      }

      if (!accountId) {
        throw new BadRequestException('Each journal line must specify either accountId or accountCategory');
      }

      // Validate account belongs to this org and is active
      await this.requireAccountById(organizationId, accountId, tx);

      const debit = new Decimal(line.debit);
      const credit = new Decimal(line.credit);

      if (debit.lt(0) || credit.lt(0)) {
        throw new BadRequestException('Debit and credit amounts must be non-negative');
      }
      if (debit.isZero() && credit.isZero()) {
        throw new BadRequestException('Each journal line must have either a debit or credit amount > 0');
      }
      if (!debit.isZero() && !credit.isZero()) {
        throw new BadRequestException('A journal line cannot have both debit and credit amounts');
      }

      resolvedLines.push({
        accountId,
        description: line.description,
        debit,
        credit,
        customerId: line.customerId,
        supplierId: line.supplierId,
      });
    }

    // ── Double-entry balance validation ───────────────────────────────────
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    for (const line of resolvedLines) {
      totalDebit = totalDebit.plus(line.debit);
      totalCredit = totalCredit.plus(line.credit);
    }

    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException(
        `Journal entry is unbalanced: total debit=${totalDebit.toFixed(4)}, total credit=${totalCredit.toFixed(4)}`,
      );
    }

    if (totalDebit.isZero()) {
      throw new BadRequestException('Journal entry must have at least one debit and one credit line');
    }

    // ── Generate entry number and create journal ──────────────────────────
    const entryNumber = await this.generateJournalNumber(organizationId, tx);

    const requestHash = idempotencyKey
      ? crypto.createHash('sha256').update(JSON.stringify({ lines: resolvedLines.map(l => ({
          accountId: l.accountId,
          debit: l.debit.toFixed(4),
          credit: l.credit.toFixed(4),
        })) })).digest('hex')
      : undefined;

    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId,
        branchId: branchId || null,
        entryNumber,
        description,
        sourceType,
        sourceId: sourceId || null,
        status: JournalEntryStatus.POSTED,
        idempotencyKey: idempotencyKey || null,
        requestHash: requestHash || null,
        createdBy: createdBy || null,
        lines: {
          create: resolvedLines.map((l) => ({
            accountId: l.accountId,
            description: l.description || null,
            debit: l.debit.toFixed(4),
            credit: l.credit.toFixed(4),
            customerId: l.customerId || null,
            supplierId: l.supplierId || null,
          })),
        },
      },
      include: { lines: true },
    });

    // ── Audit log ─────────────────────────────────────────────────────
    await tx.auditLog.create({
      data: {
        organizationId,
        userId: createdBy || null,
        action: 'JOURNAL_ENTRY_CREATED',
        entity: 'JournalEntry',
        entityId: journalEntry.id,
        newData: { entryNumber, sourceType, sourceId } as any,
      },
    });

    return journalEntry;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REVERSAL
  // ─────────────────────────────────────────────────────────────────────────

  async reverseJournal(
    organizationId: string,
    journalEntryId: string,
    userId: string,
    tx: Prisma.TransactionClient,
    reason?: string,
  ) {
    // Lock original entry to prevent concurrent reversals
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "JournalEntry" 
      WHERE id = ${journalEntryId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    
    if (!locked || locked.length === 0) {
      throw new NotFoundException('Journal entry not found');
    }

    const original = await tx.journalEntry.findFirst({
      where: { id: journalEntryId, organizationId },
      include: { lines: true },
    });

    if (!original) {
      throw new NotFoundException('Journal entry not found');
    }

    if (original.status === JournalEntryStatus.REVERSED) {
      // Already reversed — idempotent: find the reversal and return it
      const existingReversal = await tx.journalEntry.findFirst({
        where: { reversalOfId: journalEntryId, organizationId },
        include: { lines: true },
      });
      if (existingReversal) return existingReversal;
    }

    // Check no reversal already exists (concurrency protection)
    const existingReversal = await tx.journalEntry.findFirst({
      where: { reversalOfId: journalEntryId, organizationId },
    });
    if (existingReversal) {
      return await tx.journalEntry.findFirst({
        where: { reversalOfId: journalEntryId, organizationId },
        include: { lines: true },
      });
    }

    // Swap debits and credits
    const reversalLines = original.lines.map((line) => ({
      accountId: line.accountId,
      description: `Reversal: ${line.description || ''}`,
      debit: new Decimal(line.credit.toString()),
      credit: new Decimal(line.debit.toString()),
      customerId: line.customerId || undefined,
      supplierId: line.supplierId || undefined,
    }));

    const reversalEntry = await this.postJournal(
      {
        organizationId,
        branchId: original.branchId || undefined,
        description: reason || `Reversal of ${original.entryNumber}`,
        sourceType: original.sourceType,
        sourceId: undefined, // No source uniqueness on reversals
        createdBy: userId,
        lines: reversalLines.map((l) => ({
          accountId: l.accountId,
          description: l.description,
          debit: l.debit.toFixed(4),
          credit: l.credit.toFixed(4),
          customerId: l.customerId,
          supplierId: l.supplierId,
        })),
      },
      tx,
    );

    // Mark original as REVERSED and link to reversal
    await tx.journalEntry.update({
      where: { id: journalEntryId },
      data: {
        status: JournalEntryStatus.REVERSED,
        reversedById: reversalEntry.id,
      },
    });

    // Link reversal to original
    await tx.journalEntry.update({
      where: { id: reversalEntry.id },
      data: { reversalOfId: journalEntryId },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        userId,
        action: 'JOURNAL_ENTRY_REVERSED',
        entity: 'JournalEntry',
        entityId: reversalEntry.id,
        newData: { originalEntryId: journalEntryId, reversalEntryId: reversalEntry.id } as any,
      },
    });

    return reversalEntry;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SALE POSTING
  // ─────────────────────────────────────────────────────────────────────────

  async postSaleJournal(
    organizationId: string,
    sale: { id: string; branchId: string; totalAmount: any; customerId?: string | null; createdBy?: string | null },
    tx: Prisma.TransactionClient,
  ) {
    const amount = new Decimal(sale.totalAmount.toString());

    // Walk-in → Debit Cash; Registered customer → Debit AR
    const debitCategory = sale.customerId
      ? AccountCategory.ACCOUNTS_RECEIVABLE
      : AccountCategory.CASH;

    return this.postJournal(
      {
        organizationId,
        branchId: sale.branchId,
        description: `Sale posted`,
        sourceType: JournalSourceType.SALE,
        sourceId: sale.id,
        createdBy: sale.createdBy || undefined,
        lines: [
          {
            accountCategory: debitCategory,
            debit: amount.toFixed(4),
            credit: '0.0000',
            customerId: sale.customerId || undefined,
            description: 'Sale debit',
          },
          {
            accountCategory: AccountCategory.SALES_REVENUE,
            debit: '0.0000',
            credit: amount.toFixed(4),
            description: 'Sales Revenue',
          },
        ],
      },
      tx,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PURCHASE POSTING
  // ─────────────────────────────────────────────────────────────────────────

  async postPurchaseJournal(
    organizationId: string,
    purchase: { id: string; branchId: string; total: any; supplierId?: string | null; createdBy?: string | null },
    tx: Prisma.TransactionClient,
  ) {
    const amount = new Decimal(purchase.total.toString());

    return this.postJournal(
      {
        organizationId,
        branchId: purchase.branchId,
        description: `Purchase posted`,
        sourceType: JournalSourceType.PURCHASE,
        sourceId: purchase.id,
        createdBy: purchase.createdBy || undefined,
        lines: [
          {
            accountCategory: AccountCategory.INVENTORY,
            debit: amount.toFixed(4),
            credit: '0.0000',
            description: 'Inventory',
          },
          {
            accountCategory: AccountCategory.ACCOUNTS_PAYABLE,
            debit: '0.0000',
            credit: amount.toFixed(4),
            supplierId: purchase.supplierId || undefined,
            description: 'Accounts Payable',
          },
        ],
      },
      tx,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAYMENT POSTING
  // ─────────────────────────────────────────────────────────────────────────

  async postPaymentJournal(
    organizationId: string,
    payment: {
      id: string;
      branchId: string;
      amount: any;
      direction: PaymentDirection;
      method: PaymentMethod;
      customerId?: string | null;
      supplierId?: string | null;
      createdBy?: string | null;
    },
    tx: Prisma.TransactionClient,
  ) {
    const amount = new Decimal(payment.amount.toString());
    const cashCategory = PAYMENT_METHOD_TO_ACCOUNT[payment.method];
    const sourceType = payment.direction === PaymentDirection.RECEIVED
      ? JournalSourceType.CUSTOMER_PAYMENT
      : JournalSourceType.SUPPLIER_PAYMENT;

    let lines: PostJournalParams['lines'];

    if (payment.direction === PaymentDirection.RECEIVED) {
      // RECEIVED: Debit Cash/Bank, Credit AR
      lines = [
        {
          accountCategory: cashCategory,
          debit: amount.toFixed(4),
          credit: '0.0000',
          description: 'Cash/Bank received',
        },
        {
          accountCategory: AccountCategory.ACCOUNTS_RECEIVABLE,
          debit: '0.0000',
          credit: amount.toFixed(4),
          customerId: payment.customerId || undefined,
          description: 'AR settled',
        },
      ];
    } else {
      // PAID: Debit AP, Credit Cash/Bank
      lines = [
        {
          accountCategory: AccountCategory.ACCOUNTS_PAYABLE,
          debit: amount.toFixed(4),
          credit: '0.0000',
          supplierId: payment.supplierId || undefined,
          description: 'AP settled',
        },
        {
          accountCategory: cashCategory,
          debit: '0.0000',
          credit: amount.toFixed(4),
          description: 'Cash/Bank paid',
        },
      ];
    }

    return this.postJournal(
      {
        organizationId,
        branchId: payment.branchId,
        description: `${sourceType} posted`,
        sourceType,
        sourceId: payment.id,
        createdBy: payment.createdBy || undefined,
        lines,
      },
      tx,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REVERSAL HELPERS FOR SALES/PURCHASES/PAYMENTS
  // ─────────────────────────────────────────────────────────────────────────

  async reverseSaleJournal(
    organizationId: string,
    saleId: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    const journal = await tx.journalEntry.findUnique({
      where: { organizationId_sourceType_sourceId: { organizationId, sourceType: JournalSourceType.SALE, sourceId: saleId } },
    });
    if (!journal) return null; // No journal to reverse (e.g., zero-amount sale)
    return this.reverseJournal(organizationId, journal.id, userId, tx, `Sale cancellation reversal`);
  }

  async reversePurchaseJournal(
    organizationId: string,
    purchaseId: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    const journal = await tx.journalEntry.findUnique({
      where: { organizationId_sourceType_sourceId: { organizationId, sourceType: JournalSourceType.PURCHASE, sourceId: purchaseId } },
    });
    if (!journal) return null;
    return this.reverseJournal(organizationId, journal.id, userId, tx, `Purchase cancellation reversal`);
  }

  async reversePaymentJournal(
    organizationId: string,
    paymentId: string,
    userId: string,
    tx: Prisma.TransactionClient,
    direction: PaymentDirection,
  ) {
    const sourceType = direction === PaymentDirection.RECEIVED
      ? JournalSourceType.CUSTOMER_PAYMENT
      : JournalSourceType.SUPPLIER_PAYMENT;

    const journal = await tx.journalEntry.findUnique({
      where: { organizationId_sourceType_sourceId: { organizationId, sourceType, sourceId: paymentId } },
    });
    if (!journal) return null;
    return this.reverseJournal(organizationId, journal.id, userId, tx, `Payment void reversal`);
  }

  async reverseExpenseJournal(
    organizationId: string,
    expenseId: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    const journal = await tx.journalEntry.findUnique({
      where: { organizationId_sourceType_sourceId: { organizationId, sourceType: JournalSourceType.EXPENSE, sourceId: expenseId } },
    });
    if (!journal) return null;
    return this.reverseJournal(organizationId, journal.id, userId, tx, `Expense cancellation reversal`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCOUNT BALANCE (derived from posted lines only)
  // ─────────────────────────────────────────────────────────────────────────

  async getAccountBalance(organizationId: string, accountId: string) {
    await this.getAccount(organizationId, accountId);

    const result = await this.prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        journalEntry: {
          organizationId,
          status: JournalEntryStatus.POSTED,
        },
      },
      _sum: { debit: true, credit: true },
    });

    const totalDebit = new Decimal(result._sum.debit?.toString() || '0');
    const totalCredit = new Decimal(result._sum.credit?.toString() || '0');

    const account = await this.prisma.account.findUnique({ where: { id: accountId } });

    // Normal balance: ASSET/EXPENSE → debit increases; LIABILITY/EQUITY/REVENUE → credit increases
    let balance: Decimal;
    if (account!.type === AccountType.ASSET || account!.type === AccountType.EXPENSE) {
      balance = totalDebit.minus(totalCredit);
    } else {
      balance = totalCredit.minus(totalDebit);
    }

    return {
      account,
      totalDebit: totalDebit.toFixed(4),
      totalCredit: totalCredit.toFixed(4),
      balance: balance.toFixed(4),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCOUNT LEDGER HISTORY
  // ─────────────────────────────────────────────────────────────────────────

  async getAccountLedger(organizationId: string, accountId: string, query: LedgerQueryDto) {
    await this.getAccount(organizationId, accountId);

    const where: Prisma.JournalEntryLineWhereInput = {
      accountId,
      journalEntry: {
        organizationId,
        status: JournalEntryStatus.POSTED,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.dateFrom || query.dateTo
          ? {
              entryDate: {
                ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
              },
            }
          : {}),
      },
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [lines, total] = await Promise.all([
      this.prisma.journalEntryLine.findMany({
        where,
        include: {
          journalEntry: {
            select: {
              entryNumber: true,
              entryDate: true,
              description: true,
              sourceType: true,
              sourceId: true,
              status: true,
            },
          },
          account: { select: { code: true, name: true } },
        },
        orderBy: { journalEntry: { entryDate: 'asc' } },
        skip,
        take: limit,
      }),
      this.prisma.journalEntryLine.count({ where }),
    ]);

    // Compute running balance
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    let runningBalance = new Decimal(0);
    const normalDebit = account!.type === AccountType.ASSET || account!.type === AccountType.EXPENSE;

    const transactions = lines.map((line) => {
      const debit = new Decimal(line.debit.toString());
      const credit = new Decimal(line.credit.toString());
      if (normalDebit) {
        runningBalance = runningBalance.plus(debit).minus(credit);
      } else {
        runningBalance = runningBalance.plus(credit).minus(debit);
      }

      return {
        id: line.id,
        date: line.journalEntry.entryDate,
        entryNumber: line.journalEntry.entryNumber,
        description: line.journalEntry.description,
        lineDescription: line.description,
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        debit: line.debit.toString(),
        credit: line.credit.toString(),
        runningBalance: runningBalance.toFixed(4),
        status: line.journalEntry.status,
      };
    });

    return {
      account: { id: accountId, code: account!.code, name: account!.name },
      total,
      page,
      limit,
      transactions,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER KHATA
  // ─────────────────────────────────────────────────────────────────────────

  async getCustomerKhata(organizationId: string, customerId: string, query: KhataQueryDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const where: Prisma.JournalEntryLineWhereInput = {
      customerId,
      journalEntry: {
        organizationId,
        status: JournalEntryStatus.POSTED,
        ...(query.dateFrom || query.dateTo
          ? {
              entryDate: {
                ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
              },
            }
          : {}),
      },
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [lines, total] = await Promise.all([
      this.prisma.journalEntryLine.findMany({
        where,
        include: {
          journalEntry: {
            select: { entryNumber: true, entryDate: true, description: true, sourceType: true, sourceId: true },
          },
          account: { select: { code: true, name: true, type: true } },
        },
        orderBy: { journalEntry: { entryDate: 'asc' } },
        skip,
        take: limit,
      }),
      this.prisma.journalEntryLine.count({ where }),
    ]);

    // For AR: Debit increases receivable (customer owes more), Credit decreases (customer paid)
    let runningBalance = new Decimal(customer.openingBalance.toString());

    const transactions = lines.map((line) => {
      const debit = new Decimal(line.debit.toString());
      const credit = new Decimal(line.credit.toString());
      // AR is ASSET: debit increases balance
      runningBalance = runningBalance.plus(debit).minus(credit);

      return {
        id: line.id,
        date: line.journalEntry.entryDate,
        entryNumber: line.journalEntry.entryNumber,
        description: line.journalEntry.description,
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        account: line.account.name,
        debit: debit.toFixed(4),
        credit: credit.toFixed(4),
        runningBalance: runningBalance.toFixed(4),
      };
    });

    // Total outstanding
    const aggResult = await this.prisma.journalEntryLine.aggregate({
      where: {
        customerId,
        journalEntry: { organizationId, status: JournalEntryStatus.POSTED },
      },
      _sum: { debit: true, credit: true },
    });

    const totalDebits = new Decimal(aggResult._sum.debit?.toString() || '0');
    const totalCredits = new Decimal(aggResult._sum.credit?.toString() || '0');
    const outstanding = new Decimal(customer.openingBalance.toString()).plus(totalDebits).minus(totalCredits);

    return {
      customer: { id: customer.id, name: customer.name, customerCode: customer.customerCode },
      openingBalance: customer.openingBalance.toString(),
      outstanding: outstanding.toFixed(4),
      total,
      page,
      limit,
      transactions,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUPPLIER KHATA
  // ─────────────────────────────────────────────────────────────────────────

  async getSupplierKhata(organizationId: string, supplierId: string, query: KhataQueryDto) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, organizationId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const where: Prisma.JournalEntryLineWhereInput = {
      supplierId,
      journalEntry: {
        organizationId,
        status: JournalEntryStatus.POSTED,
        ...(query.dateFrom || query.dateTo
          ? {
              entryDate: {
                ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
              },
            }
          : {}),
      },
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [lines, total] = await Promise.all([
      this.prisma.journalEntryLine.findMany({
        where,
        include: {
          journalEntry: {
            select: { entryNumber: true, entryDate: true, description: true, sourceType: true, sourceId: true },
          },
          account: { select: { code: true, name: true, type: true } },
        },
        orderBy: { journalEntry: { entryDate: 'asc' } },
        skip,
        take: limit,
      }),
      this.prisma.journalEntryLine.count({ where }),
    ]);

    // For AP: Credit increases payable (supplier owed more), Debit decreases (we paid)
    let runningBalance = new Decimal(0);

    const transactions = lines.map((line) => {
      const debit = new Decimal(line.debit.toString());
      const credit = new Decimal(line.credit.toString());
      // AP is LIABILITY: credit increases balance
      runningBalance = runningBalance.plus(credit).minus(debit);

      return {
        id: line.id,
        date: line.journalEntry.entryDate,
        entryNumber: line.journalEntry.entryNumber,
        description: line.journalEntry.description,
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        account: line.account.name,
        debit: debit.toFixed(4),
        credit: credit.toFixed(4),
        runningBalance: runningBalance.toFixed(4),
      };
    });

    const aggResult = await this.prisma.journalEntryLine.aggregate({
      where: {
        supplierId,
        journalEntry: { organizationId, status: JournalEntryStatus.POSTED },
      },
      _sum: { debit: true, credit: true },
    });

    const totalDebits = new Decimal(aggResult._sum.debit?.toString() || '0');
    const totalCredits = new Decimal(aggResult._sum.credit?.toString() || '0');
    const outstanding = totalCredits.minus(totalDebits);

    return {
      supplier: { id: supplier.id, name: supplier.name, supplierCode: supplier.supplierCode },
      outstanding: outstanding.toFixed(4),
      total,
      page,
      limit,
      transactions,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNAL ENTRIES QUERY
  // ─────────────────────────────────────────────────────────────────────────

  async listJournalEntries(organizationId: string, query: JournalQueryDto) {
    const where: Prisma.JournalEntryWhereInput = {
      organizationId,
      ...(query.sourceType ? { sourceType: query.sourceType as JournalSourceType } : {}),
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status as JournalEntryStatus } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            entryDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          lines: {
            include: { account: { select: { code: true, name: true } } },
          },
          branch: { select: { id: true, name: true, code: true } },
        },
        orderBy: { entryDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { total, page, limit, entries };
  }

  async getJournalEntry(organizationId: string, journalEntryId: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id: journalEntryId, organizationId },
      include: {
        lines: {
          include: {
            account: { select: { id: true, code: true, name: true } },
          },
        },
        branch: { select: { id: true, name: true, code: true } },
        reversalOf: { select: { id: true, entryNumber: true } },
        reversedByOf: { select: { id: true, entryNumber: true } },
      },
    });

    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MANUAL JOURNAL ENTRY
  // ─────────────────────────────────────────────────────────────────────────

  async createManualJournalEntry(organizationId: string, userId: string, dto: CreateJournalEntryDto) {
    // Validate branch if provided
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, organizationId },
      });
      if (!branch) throw new NotFoundException('Branch not found in this organization');
    }

    return this.prisma.$transaction(async (tx) => {
      return this.postJournal(
        {
          organizationId,
          branchId: dto.branchId,
          description: dto.description,
          sourceType: JournalSourceType.MANUAL,
          idempotencyKey: dto.idempotencyKey,
          createdBy: userId,
          lines: dto.lines.map((l) => ({
            accountId: l.accountId,
            description: l.description,
            debit: String(l.debit),
            credit: String(l.credit),
            customerId: l.customerId,
            supplierId: l.supplierId,
          })),
        },
        tx,
      );
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MANUAL REVERSAL via API
  // ─────────────────────────────────────────────────────────────────────────

  async reverseJournalEntry(organizationId: string, journalEntryId: string, userId: string, reason?: string) {
    const original = await this.prisma.journalEntry.findFirst({
      where: { id: journalEntryId, organizationId },
    });

    if (!original) throw new NotFoundException('Journal entry not found');

    return this.prisma.$transaction(async (tx) => {
      return this.reverseJournal(organizationId, journalEntryId, userId, tx, reason);
    });
  }
}
