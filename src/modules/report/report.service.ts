import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { GetReportQueryDto } from './dto/get-report-query.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class ReportService {
  constructor(private prisma: DatabaseService) {}

  private getDateFilter(query: GetReportQueryDto) {
    const filter: any = {};
    if (query.startDate) {
      filter.gte = new Date(query.startDate);
    }
    if (query.endDate) {
      filter.lte = new Date(query.endDate);
    }
    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  async getSalesSummary(organizationId: string, query: GetReportQueryDto) {
    const where: Prisma.SaleWhereInput = {
      organizationId,
      status: 'COMPLETED',
    };

    if (query.branchId) {
      where.branchId = query.branchId;
    }
    const dateFilter = this.getDateFilter(query);
    if (dateFilter) {
      where.createdAt = dateFilter;
    }

    const aggregations = await this.prisma.sale.aggregate({
      where,
      _sum: {
        totalAmount: true,
        paidAmount: true,
        discountAmount: true,
        taxAmount: true,
      },
      _count: {
        id: true,
      },
    });

    const totalSales = aggregations._sum.totalAmount || new Prisma.Decimal(0);
    const totalPaid = aggregations._sum.paidAmount || new Prisma.Decimal(0);
    const totalDiscount = aggregations._sum.discountAmount || new Prisma.Decimal(0);
    const totalTax = aggregations._sum.taxAmount || new Prisma.Decimal(0);
    const totalDue = totalSales.sub(totalPaid);

    // Sales Trend by Date
    // Note: Doing precise date truncation in Prisma requires raw SQL. We can retrieve the data and map it.
    // For simplicity and to avoid raw SQL quirks across DBs, we fetch grouped by date on application side or use a raw query.
    const rawTrends = await this.prisma.$queryRaw`
      SELECT DATE(DATE_TRUNC('day', "createdAt")) as "date", 
             SUM("total") as "amount", 
             COUNT(id) as "count"
      FROM "Sale"
      WHERE "organizationId" = ${organizationId}
        AND "status" = 'COMPLETED'
        ${query.branchId ? Prisma.sql`AND "branchId" = ${query.branchId}` : Prisma.empty}
        ${query.startDate ? Prisma.sql`AND "createdAt" >= ${new Date(query.startDate)}` : Prisma.empty}
        ${query.endDate ? Prisma.sql`AND "createdAt" <= ${new Date(query.endDate)}` : Prisma.empty}
      GROUP BY DATE(DATE_TRUNC('day', "createdAt"))
      ORDER BY "date" ASC
    ` as any[];

    const trend = rawTrends.map(t => ({
      date: t.date,
      amount: new Prisma.Decimal(t.amount || 0).toNumber(),
      count: Number(t.count),
    }));

    return {
      summary: {
        totalSales: totalSales.toNumber(),
        totalPaid: totalPaid.toNumber(),
        totalDue: totalDue.toNumber(),
        totalDiscount: totalDiscount.toNumber(),
        totalTax: totalTax.toNumber(),
        count: aggregations._count.id,
      },
      trend,
    };
  }

  async getPurchasesSummary(organizationId: string, query: GetReportQueryDto) {
    const where: Prisma.PurchaseWhereInput = {
      organizationId,
      status: 'COMPLETED',
    };

    if (query.branchId) {
      where.branchId = query.branchId;
    }
    const dateFilter = this.getDateFilter(query);
    if (dateFilter) {
      where.createdAt = dateFilter;
    }

    const aggregations = await this.prisma.purchase.aggregate({
      where,
      _sum: {
        total: true,
        paidAmount: true,
        discount: true,
        tax: true,
      },
      _count: {
        id: true,
      },
    });

    const totalPurchases = aggregations._sum.total || new Prisma.Decimal(0);
    const totalPaid = aggregations._sum.paidAmount || new Prisma.Decimal(0);
    const totalDue = totalPurchases.sub(totalPaid);

    // Supplier Breakdown
    const supplierBreakdown = await this.prisma.purchase.groupBy({
      by: ['supplierId'],
      where,
      _sum: {
        total: true,
        paidAmount: true,
      },
    });

    // Populate supplier names
    const supplierIds = supplierBreakdown.map((s) => s.supplierId).filter(Boolean) as string[];
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true },
    });
    
    const breakdown = supplierBreakdown.map((s) => {
      const supplier = suppliers.find((sup) => sup.id === s.supplierId);
      return {
        supplierId: s.supplierId,
        supplierName: supplier?.name || 'Unknown/Walk-in',
        total: (s._sum.total || new Prisma.Decimal(0)).toNumber(),
        paidAmount: (s._sum.paidAmount || new Prisma.Decimal(0)).toNumber(),
        due: (s._sum.total || new Prisma.Decimal(0)).sub(s._sum.paidAmount || new Prisma.Decimal(0)).toNumber(),
      };
    });

    return {
      summary: {
        totalPurchases: totalPurchases.toNumber(),
        totalPaid: totalPaid.toNumber(),
        totalDue: totalDue.toNumber(),
        totalDiscount: (aggregations._sum.discount || new Prisma.Decimal(0)).toNumber(),
        totalTax: (aggregations._sum.tax || new Prisma.Decimal(0)).toNumber(),
        count: aggregations._count.id,
      },
      breakdown,
    };
  }

  async getPaymentsSummary(organizationId: string, query: GetReportQueryDto) {
    const where: Prisma.PaymentWhereInput = {
      organizationId,
      status: 'COMPLETED',
    };

    if (query.branchId) {
      where.branchId = query.branchId;
    }
    const dateFilter = this.getDateFilter(query);
    if (dateFilter) {
      where.createdAt = dateFilter;
    }

    const collectionsAggr = await this.prisma.payment.aggregate({
      where: { ...where, direction: 'RECEIVED' },
      _sum: { amount: true },
      _count: { id: true },
    });

    const paymentsAggr = await this.prisma.payment.aggregate({
      where: { ...where, direction: 'PAID' },
      _sum: { amount: true },
      _count: { id: true },
    });

    const collectionsByMethod = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { ...where, direction: 'RECEIVED' },
      _sum: { amount: true },
    });

    const paymentsByMethod = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { ...where, direction: 'PAID' },
      _sum: { amount: true },
    });

    return {
      collections: {
        total: (collectionsAggr._sum.amount || new Prisma.Decimal(0)).toNumber(),
        count: collectionsAggr._count.id,
        byMethod: collectionsByMethod.map(m => ({ method: m.method, amount: (m._sum.amount || new Prisma.Decimal(0)).toNumber() })),
      },
      payments: {
        total: (paymentsAggr._sum.amount || new Prisma.Decimal(0)).toNumber(),
        count: paymentsAggr._count.id,
        byMethod: paymentsByMethod.map(m => ({ method: m.method, amount: (m._sum.amount || new Prisma.Decimal(0)).toNumber() })),
      },
    };
  }

  async getExpensesSummary(organizationId: string, query: GetReportQueryDto) {
    const where: Prisma.ExpenseWhereInput = {
      organizationId,
      status: 'COMPLETED',
    };

    if (query.branchId) {
      where.branchId = query.branchId;
    }
    const dateFilter = this.getDateFilter(query);
    if (dateFilter) {
      where.expenseDate = dateFilter;
    }

    const aggregations = await this.prisma.expense.aggregate({
      where,
      _sum: { amount: true },
      _count: { id: true },
    });

    const breakdown = await this.prisma.expense.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amount: true },
    });

    const categoryIds = breakdown.map(b => b.categoryId);
    const categories = await this.prisma.expenseCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });

    return {
      summary: {
        totalExpenses: (aggregations._sum.amount || new Prisma.Decimal(0)).toNumber(),
        count: aggregations._count.id,
      },
      breakdown: breakdown.map(b => {
        const cat = categories.find(c => c.id === b.categoryId);
        return {
          categoryId: b.categoryId,
          categoryName: cat?.name || 'Unknown',
          amount: (b._sum.amount || new Prisma.Decimal(0)).toNumber(),
        };
      }),
    };
  }

  async getInventorySummary(organizationId: string, query: GetReportQueryDto) {
    const where: Prisma.InventoryWhereInput = { organizationId };
    if (query.branchId) {
      where.branchId = query.branchId;
    }
    
    // Inventory current values don't use date filter for exact current snapshot, 
    // but if requested, we could compute historical. We'll just return current snapshot.
    const inventory = await this.prisma.inventory.findMany({
      where,
      include: {
        product: { select: { purchasePrice: true } }
      }
    });

    let totalQuantity = new Prisma.Decimal(0);
    let estimatedValue = new Prisma.Decimal(0);

    for (const item of inventory) {
      totalQuantity = totalQuantity.add(item.quantity);
      estimatedValue = estimatedValue.add(item.quantity.mul(item.product.purchasePrice));
    }

    const movementWhere: Prisma.InventoryMovementWhereInput = { organizationId };
    if (query.branchId) {
      movementWhere.branchId = query.branchId;
    }
    const dateFilter = this.getDateFilter(query);
    if (dateFilter) {
      movementWhere.createdAt = dateFilter;
    }

    const movements = await this.prisma.inventoryMovement.groupBy({
      by: ['movementType'],
      where: movementWhere,
      _sum: { quantity: true },
      _count: { id: true }
    });

    return {
      current: {
        totalQuantity: totalQuantity.toNumber(),
        estimatedValue: estimatedValue.toNumber(),
      },
      movements: movements.map(m => ({
        type: m.movementType,
        quantity: (m._sum.quantity || new Prisma.Decimal(0)).toNumber(),
        count: m._count.id,
      })),
    };
  }

  async getOutstandingSummary(organizationId: string, query: GetReportQueryDto) {
    // For customers
    const customerWhere: Prisma.CustomerWhereInput = { organizationId };
    if (query.branchId) {
      customerWhere.branchId = query.branchId;
    }
    
    const customers = await this.prisma.customer.findMany({
      where: customerWhere,
      select: { openingBalance: true, id: true }
    });
    
    const customerIds = customers.map(c => c.id);

    const saleAgg = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        organizationId,
        customerId: { in: customerIds },
        status: 'COMPLETED'
      },
      _sum: { totalAmount: true, paidAmount: true }
    });

    const paymentAgg = await this.prisma.payment.groupBy({
      by: ['customerId'],
      where: {
        organizationId,
        customerId: { in: customerIds },
        status: 'COMPLETED',
        direction: 'RECEIVED'
      },
      _sum: { amount: true }
    });

    let totalCustomerOutstanding = new Prisma.Decimal(0);
    customers.forEach(customer => {
      let balance = customer.openingBalance;
      const s = saleAgg.find(x => x.customerId === customer.id);
      if (s) {
        balance = balance.add(s._sum.totalAmount || new Prisma.Decimal(0));
      }
      const p = paymentAgg.find(x => x.customerId === customer.id);
      if (p) {
        balance = balance.sub(p._sum.amount || new Prisma.Decimal(0));
      }
      totalCustomerOutstanding = totalCustomerOutstanding.add(balance);
    });

    // For suppliers
    const supplierWhere: Prisma.SupplierWhereInput = { organizationId };
    if (query.branchId) {
      supplierWhere.branchId = query.branchId;
    }
    
    const suppliers = await this.prisma.supplier.findMany({
      where: supplierWhere,
      select: { id: true }
    });
    const supplierIds = suppliers.map(s => s.id);

    const purchaseAgg = await this.prisma.purchase.groupBy({
      by: ['supplierId'],
      where: {
        organizationId,
        supplierId: { in: supplierIds },
        status: 'COMPLETED'
      },
      _sum: { total: true, paidAmount: true }
    });

    const supplierPaymentAgg = await this.prisma.payment.groupBy({
      by: ['supplierId'],
      where: {
        organizationId,
        supplierId: { in: supplierIds },
        status: 'COMPLETED',
        direction: 'PAID'
      },
      _sum: { amount: true }
    });

    let totalSupplierOutstanding = new Prisma.Decimal(0);
    suppliers.forEach(supplier => {
      let balance = new Prisma.Decimal(0);
      const p = purchaseAgg.find(x => x.supplierId === supplier.id);
      if (p) {
        balance = balance.add(p._sum.total || new Prisma.Decimal(0));
      }
      const sp = supplierPaymentAgg.find(x => x.supplierId === supplier.id);
      if (sp) {
        balance = balance.sub(sp._sum.amount || new Prisma.Decimal(0));
      }
      totalSupplierOutstanding = totalSupplierOutstanding.add(balance);
    });

    return {
      customerOutstanding: totalCustomerOutstanding.toNumber(),
      supplierOutstanding: totalSupplierOutstanding.toNumber(),
    };
  }

  async getProfitAndLoss(organizationId: string, query: GetReportQueryDto) {
    const where: Prisma.JournalEntryLineWhereInput = {
      journalEntry: {
        organizationId,
        status: 'POSTED',
      },
    };

    if (query.branchId) {
      (where.journalEntry as Prisma.JournalEntryWhereInput).branchId = query.branchId;
    }
    const dateFilter = this.getDateFilter(query);
    if (dateFilter) {
      where.createdAt = dateFilter;
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where,
      include: {
        account: { select: { type: true, name: true, code: true, category: true } }
      }
    });

    let totalRevenue = new Prisma.Decimal(0);
    let totalExpense = new Prisma.Decimal(0);
    let totalCogs = new Prisma.Decimal(0);
    let operatingExpense = new Prisma.Decimal(0);

    const revenueDetails: Record<string, { name: string, code: string, amount: Prisma.Decimal }> = {};
    const expenseDetails: Record<string, { name: string, code: string, amount: Prisma.Decimal, isCogs: boolean }> = {};

    for (const line of lines) {
      if (line.account.type === 'REVENUE') {
        const amt = line.credit.sub(line.debit);
        totalRevenue = totalRevenue.add(amt);
        if (!revenueDetails[line.accountId]) {
          revenueDetails[line.accountId] = { name: line.account.name, code: line.account.code, amount: new Prisma.Decimal(0) };
        }
        revenueDetails[line.accountId].amount = revenueDetails[line.accountId].amount.add(amt);
      } else if (line.account.type === 'EXPENSE') {
        const amt = line.debit.sub(line.credit);
        totalExpense = totalExpense.add(amt);
        const isCogs = line.account.category === 'COST_OF_GOODS_SOLD' || line.account.code === '5100';
        if (isCogs) {
          totalCogs = totalCogs.add(amt);
        } else {
          operatingExpense = operatingExpense.add(amt);
        }

        if (!expenseDetails[line.accountId]) {
          expenseDetails[line.accountId] = { name: line.account.name, code: line.account.code, amount: new Prisma.Decimal(0), isCogs };
        }
        expenseDetails[line.accountId].amount = expenseDetails[line.accountId].amount.add(amt);
      }
    }

    const grossProfit = totalRevenue.sub(totalCogs);
    const netProfit = totalRevenue.sub(totalExpense);
    const grossMarginPercent = totalRevenue.gt(0)
      ? grossProfit.dividedBy(totalRevenue).mul(100).toNumber()
      : 0;

    return {
      revenue: {
        total: totalRevenue.toNumber(),
        breakdown: Object.values(revenueDetails).map(x => ({ ...x, amount: x.amount.toNumber() })),
      },
      expense: {
        total: totalExpense.toNumber(),
        breakdown: Object.values(expenseDetails).map(x => ({ ...x, amount: x.amount.toNumber() })),
      },
      cogs: totalCogs.toNumber(),
      operatingExpense: operatingExpense.toNumber(),
      grossProfit: grossProfit.toNumber(),
      grossMarginPercent: Number(grossMarginPercent.toFixed(2)),
      netProfit: netProfit.toNumber(),
    };
  }

  async getDashboard(organizationId: string, query: GetReportQueryDto) {
    const [sales, collections, inventory, outstanding] = await Promise.all([
      this.getSalesSummary(organizationId, query),
      this.getPaymentsSummary(organizationId, query),
      this.getInventorySummary(organizationId, query),
      this.getOutstandingSummary(organizationId, query)
    ]);

    return {
      totalSales: sales.summary.totalSales,
      totalCollections: collections.collections.total,
      totalReceivables: outstanding.customerOutstanding,
      estimatedInventoryValue: inventory.current.estimatedValue,
    };
  }
}
