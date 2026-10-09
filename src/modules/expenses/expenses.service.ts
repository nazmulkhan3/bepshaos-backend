import { NotificationQueueService } from '../notification/notification.queue.service.js';
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { QueryExpenseDto } from './dto/query-expense.dto.js';
import { CreateExpenseCategoryDto } from './dto/create-category.dto.js';
import { UpdateExpenseCategoryDto } from './dto/update-category.dto.js';
import { Prisma, ExpenseStatus, JournalSourceType } from '@prisma/client';
import crypto from 'crypto';
import { Decimal } from 'decimal.js';

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(private readonly prisma: DatabaseService,
    private readonly ledgerService: LedgerService,private readonly notificationQueue: NotificationQueueService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CATEGORY MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────

  async createCategory(organizationId: string, dto: CreateExpenseCategoryDto) {
    const existing = await this.prisma.expenseCategory.findUnique({
      where: {
        organizationId_code: { organizationId, code: dto.code },
      },
    });

    if (existing) {
      throw new ConflictException(`Expense category with code ${dto.code} already exists`);
    }

    // Verify account exists and is an expense account
    const account = await this.ledgerService.getAccount(organizationId, dto.expenseAccountId);
    if (account.type !== 'EXPENSE') {
      throw new BadRequestException('Selected account must be an EXPENSE account');
    }

    return this.prisma.expenseCategory.create({
      data: {
        organizationId,
        name: dto.name,
        code: dto.code,
        description: dto.description,
        expenseAccountId: dto.expenseAccountId,
        isActive: dto.isActive ?? true,
        isSystem: false,
      },
    });
  }

  async findAllCategories(organizationId: string) {
    return this.prisma.expenseCategory.findMany({
      where: { organizationId },
      include: {
        account: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getCategoryById(organizationId: string, id: string) {
    const category = await this.prisma.expenseCategory.findUnique({
      where: { id },
      include: {
        account: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    if (!category || category.organizationId !== organizationId) {
      throw new NotFoundException('Expense category not found');
    }

    return category;
  }

  async updateCategory(organizationId: string, id: string, dto: UpdateExpenseCategoryDto) {
    const category = await this.getCategoryById(organizationId, id);

    if (category.isSystem) {
      throw new BadRequestException('Cannot update a system category');
    }

    if (dto.code && dto.code !== category.code) {
      const existing = await this.prisma.expenseCategory.findUnique({
        where: {
          organizationId_code: { organizationId, code: dto.code },
        },
      });

      if (existing) {
        throw new ConflictException(`Expense category with code ${dto.code} already exists`);
      }
    }

    if (dto.expenseAccountId && dto.expenseAccountId !== category.expenseAccountId) {
      const account = await this.ledgerService.getAccount(organizationId, dto.expenseAccountId);
      if (account.type !== 'EXPENSE') {
        throw new BadRequestException('Selected account must be an EXPENSE account');
      }
    }

    return this.prisma.expenseCategory.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        expenseAccountId: dto.expenseAccountId,
        isActive: dto.isActive,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPENSE MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────

  private generateRequestHash(dto: CreateExpenseDto): string {
    const normalized = {
      branchId: dto.branchId,
      categoryId: dto.categoryId,
      amount: Number(dto.amount),
      paymentMethod: dto.paymentMethod,
      paymentAccountId: dto.paymentAccountId,
      reference: dto.reference || null,
      note: dto.note || null,
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private async generateExpenseNumber(organizationId: string, tx: Prisma.TransactionClient): Promise<string> {
    const lastExpense = await tx.expense.findFirst({
      where: { organizationId },
      orderBy: { expenseNumber: 'desc' },
      select: { expenseNumber: true },
    });

    if (!lastExpense || !lastExpense.expenseNumber) {
      return 'EXP-000001';
    }

    const match = lastExpense.expenseNumber.match(/EXP-(\d+)/);
    if (!match) return 'EXP-000001';

    const lastNumber = parseInt(match[1], 10);
    return `EXP-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  async createExpense(organizationId: string, userId: string, dto: CreateExpenseDto) {
    const amount = new Decimal(dto.amount);
    if (amount.lte(0) || amount.isNaN()) {
      throw new BadRequestException('Expense amount must be greater than 0');
    }

    const requestHash = this.generateRequestHash(dto);

    // Idempotency check
    const existing = await this.prisma.expense.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: dto.idempotencyKey } },
      include: {
        category: { select: { name: true } },
        paymentAccount: { select: { name: true, code: true } },
      }
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException('Idempotency key used with different request parameters');
      }
      return existing;
    }

    // Verify category
    const category = await this.getCategoryById(organizationId, dto.categoryId);
    if (!category.isActive) {
      throw new BadRequestException('Selected expense category is inactive');
    }

    // Verify payment account
    const paymentAccount = await this.ledgerService.getAccount(organizationId, dto.paymentAccountId);
    if (paymentAccount.type !== 'ASSET' && paymentAccount.type !== 'LIABILITY') {
      throw new BadRequestException('Payment account must be ASSET or LIABILITY');
    }

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, organizationId },
      });
      if (!branch) throw new NotFoundException('Branch not found');
    }

    let retryCount = 0;
    const maxRetries = 50;

    while (retryCount < maxRetries) {
      try {
        const expense = await this.prisma.$transaction(async (tx) => {
          const expenseNumber = await this.generateExpenseNumber(organizationId, tx);

          const expense = await tx.expense.create({
            data: {
              organizationId,
              branchId: dto.branchId,
              categoryId: dto.categoryId,
              expenseNumber,
              amount: amount.toString(),
              paymentMethod: dto.paymentMethod,
              paymentAccountId: dto.paymentAccountId,
              expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
              reference: dto.reference,
              note: dto.note,
              status: ExpenseStatus.COMPLETED,
              idempotencyKey: dto.idempotencyKey,
              requestHash,
            },
            include: {
              category: { select: { name: true } },
              paymentAccount: { select: { name: true, code: true } },
            },
          });

          // Audit Log
          await tx.auditLog.create({
            data: {
              organizationId,
              userId,
              action: 'EXPENSE_CREATED',
              entity: 'Expense',
              entityId: expense.id,
              newData: { expenseNumber, amount: amount.toString() } as any,
            },
          });

          // Post Ledger Journal
          // Debit: Expense Account (from Category)
          // Credit: Payment Account
          await this.ledgerService.postJournal(
            {
              organizationId,
              branchId: dto.branchId,
              description: `Expense ${expenseNumber}: ${category.name}`,
              sourceType: JournalSourceType.EXPENSE,
              sourceId: expense.id,
              idempotencyKey: `journal-expense-${expense.id}`,
              createdBy: userId,
              lines: [
                {
                  accountId: category.expenseAccountId,
                  description: dto.note || `Expense - ${category.name}`,
                  debit: amount.toString(),
                  credit: '0',
                },
                {
                  accountId: dto.paymentAccountId,
                  description: dto.note || `Payment for ${category.name}`,
                  debit: '0',
                  credit: amount.toString(),
                },
              ],
            },
            tx,
          );

          return expense;
        });
        
        await this.notificationQueue.enqueue({
          userId,
          organizationId,
          type: 'EXPENSE_CREATED',
          title: 'Expense Created',
          message: `Expense ${expense.expenseNumber} has been successfully recorded.`,
          entityType: 'Expense',
          entityId: expense.id,
        });

        return expense;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw new ConflictException('Failed to generate a unique expense number after multiple attempts. Please try again.');
          }
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20)); // Jitter
          continue;
        }
        throw error;
      }
    }
  }

  async findAllExpenses(organizationId: string, query: QueryExpenseDto) {
    const where: Prisma.ExpenseWhereInput = {
      organizationId,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [expenses, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, code: true } },
          paymentAccount: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return { total, page, limit, expenses };
  }

  async getExpenseById(organizationId: string, id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, code: true } },
        paymentAccount: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    if (!expense || expense.organizationId !== organizationId) {
      throw new NotFoundException('Expense not found');
    }

    return expense;
  }

  async cancelExpense(organizationId: string, id: string, userId: string) {
    const expense = await this.getExpenseById(organizationId, id);

    if (expense.status === ExpenseStatus.CANCELLED) {
      throw new BadRequestException('Expense is already cancelled');
    }

    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.expense.updateMany({
        where: { id, status: ExpenseStatus.COMPLETED },
        data: {
          status: ExpenseStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: userId,
        },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException('Expense is already cancelled or cannot be cancelled');
      }

      const cancelledExpense = await tx.expense.findUnique({
        where: { id },
        include: {
          category: { select: { id: true, name: true, code: true } },
          paymentAccount: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true } },
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'EXPENSE_CANCELLED',
          entity: 'Expense',
          entityId: id,
        },
      });

      // Reverse Journal
      await this.ledgerService.reverseExpenseJournal(organizationId, id, userId, tx);

      return cancelledExpense;
    });
  }
}
