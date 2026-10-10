import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { GetReportQueryDto } from './dto/get-report-query.dto.js';
import { GetProductProfitabilityQueryDto } from './dto/get-product-profitability-query.dto.js';
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

  /**
   * Phase 2D: Actual Product Profit & Loss Analytics
   * Calculates actual revenue, COGS snapshots, gross profit, variable selling expense attribution,
   * contribution profit, and operational overhead distribution.
   */
  async getProductProfitability(organizationId: string, query: GetProductProfitabilityQueryDto) {
    // 1. Build Sales Filter (Completed sales only; cancelled sales excluded to prevent phantom revenue)
    const saleWhere: Prisma.SaleWhereInput = {
      organizationId,
      status: 'COMPLETED',
    };

    if (query.branchId) {
      saleWhere.branchId = query.branchId;
    }

    if (query.startDate || query.endDate) {
      saleWhere.createdAt = {};
      if (query.startDate) saleWhere.createdAt.gte = new Date(query.startDate);
      if (query.endDate) saleWhere.createdAt.lte = new Date(query.endDate);
    }

    // 2. Query SaleItems with product metadata and category
    const saleItemWhere: Prisma.SaleItemWhereInput = {
      sale: saleWhere,
    };

    if (query.productId) {
      saleItemWhere.productId = query.productId;
    }

    if (query.categoryId) {
      saleItemWhere.product = { categoryId: query.categoryId };
    }

    const saleItems = await this.prisma.saleItem.findMany({
      where: saleItemWhere,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            categoryId: true,
            purchasePrice: true,
            category: { select: { id: true, name: true } },
          },
        },
        sale: {
          select: {
            id: true,
            saleNumber: true,
            branchId: true,
            createdAt: true,
          },
        },
      },
    });

    // 3. Query Posted Actual Expenses during the same period and branch scope
    const expenseWhere: Prisma.ExpenseWhereInput = {
      organizationId,
      status: 'COMPLETED',
    };

    if (query.branchId) {
      expenseWhere.branchId = query.branchId;
    }

    if (query.startDate || query.endDate) {
      expenseWhere.expenseDate = {};
      if (query.startDate) expenseWhere.expenseDate.gte = new Date(query.startDate);
      if (query.endDate) expenseWhere.expenseDate.lte = new Date(query.endDate);
    }

    const expenses = await this.prisma.expense.findMany({
      where: expenseWhere,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            code: true,
            account: { select: { code: true, category: true } },
          },
        },
      },
    });

    // Double-counting prevention: Identify purchase capitalized expenses (e.g. linked freight/customs)
    const linkedExpensePurchases = await this.prisma.purchase.findMany({
      where: {
        organizationId,
        linkedExpenseId: { not: null },
      },
      select: { linkedExpenseId: true },
    });
    const capitalizedExpenseIds = new Set(
      linkedExpensePurchases.map((p) => p.linkedExpenseId).filter(Boolean) as string[]
    );

    // Classify non-capitalized actual expenses into variable selling vs fixed operating overhead
    let totalSellingExpenses = new Prisma.Decimal(0);
    let totalOverheadExpenses = new Prisma.Decimal(0);
    const sellingExpenseBreakdown: Array<{ id: string; categoryName: string; amount: number; reference?: string | null }> = [];
    const overheadExpenseBreakdown: Array<{ id: string; categoryName: string; amount: number; reference?: string | null }> = [];

    for (const exp of expenses) {
      // Exclude if already capitalized into inventory landed cost
      if (capitalizedExpenseIds.has(exp.id)) {
        continue;
      }

      const catName = exp.category.name.toLowerCase();
      const catCode = exp.category.code.toLowerCase();
      const isVariableSelling =
        catName.includes('ad') ||
        catName.includes('marketing') ||
        catName.includes('campaign') ||
        catName.includes('delivery') ||
        catName.includes('shipping') ||
        catName.includes('courier') ||
        catName.includes('pack') ||
        catName.includes('label') ||
        catName.includes('commission') ||
        catName.includes('gateway') ||
        catName.includes('cod') ||
        catCode.includes('sell') ||
        catCode.includes('mkt');

      if (isVariableSelling) {
        totalSellingExpenses = totalSellingExpenses.plus(exp.amount);
        sellingExpenseBreakdown.push({
          id: exp.id,
          categoryName: exp.category.name,
          amount: Number(exp.amount),
          reference: exp.reference || exp.expenseNumber,
        });
      } else {
        totalOverheadExpenses = totalOverheadExpenses.plus(exp.amount);
        overheadExpenseBreakdown.push({
          id: exp.id,
          categoryName: exp.category.name,
          amount: Number(exp.amount),
          reference: exp.reference || exp.expenseNumber,
        });
      }
    }

    // 4. Aggregate sales by product
    const productStatsMap = new Map<
      string,
      {
        productId: string;
        productName: string;
        sku: string | null;
        barcode: string | null;
        categoryId: string | null;
        categoryName: string;
        catalogReferencePrice: number;
        unitsSold: Prisma.Decimal;
        orderSet: Set<string>;
        grossRevenue: Prisma.Decimal;
        discountTotal: Prisma.Decimal;
        netRevenue: Prisma.Decimal;
        actualCogs: Prisma.Decimal;
        hasZeroCostSale: boolean;
      }
    >();

    let totalOrgUnitsSold = new Prisma.Decimal(0);
    let totalOrgNetRevenue = new Prisma.Decimal(0);
    const orgOrderSet = new Set<string>();

    for (const item of saleItems) {
      const pid = item.productId;
      if (!productStatsMap.has(pid)) {
        productStatsMap.set(pid, {
          productId: pid,
          productName: item.product.name,
          sku: item.product.sku,
          barcode: item.product.barcode,
          categoryId: item.product.categoryId,
          categoryName: item.product.category?.name || 'Uncategorized',
          catalogReferencePrice: Number(item.product.purchasePrice || 0),
          unitsSold: new Prisma.Decimal(0),
          orderSet: new Set<string>(),
          grossRevenue: new Prisma.Decimal(0),
          discountTotal: new Prisma.Decimal(0),
          netRevenue: new Prisma.Decimal(0),
          actualCogs: new Prisma.Decimal(0),
          hasZeroCostSale: false,
        });
      }

      const stat = productStatsMap.get(pid)!;
      const qty = new Prisma.Decimal(item.quantity);
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      const discount = new Prisma.Decimal(item.discountAmount || 0);
      const costPrice = new Prisma.Decimal(item.costPrice || 0);

      const grossLine = qty.mul(unitPrice);
      const netLine = new Prisma.Decimal(item.lineTotal);
      const lineCogs = qty.mul(costPrice);

      if (costPrice.isZero() && qty.gt(0)) {
        stat.hasZeroCostSale = true;
      }

      stat.unitsSold = stat.unitsSold.plus(qty);
      stat.orderSet.add(item.saleId);
      stat.grossRevenue = stat.grossRevenue.plus(grossLine);
      stat.discountTotal = stat.discountTotal.plus(discount);
      stat.netRevenue = stat.netRevenue.plus(netLine);
      stat.actualCogs = stat.actualCogs.plus(lineCogs);

      totalOrgUnitsSold = totalOrgUnitsSold.plus(qty);
      totalOrgNetRevenue = totalOrgNetRevenue.plus(netLine);
      orgOrderSet.add(item.saleId);
    }

    const totalOrdersCount = orgOrderSet.size;

    // 5. Allocation Rule Determination
    const allocationRule = query.allocationRule || 'ACTUAL_UNITS';

    // 6. Assemble Product P&L rows
    const productRows = Array.from(productStatsMap.values()).map((stat) => {
      const netRev = stat.netRevenue;
      const cogs = stat.actualCogs;
      const grossProfit = netRev.minus(cogs);
      const grossMarginPct = netRev.gt(0)
        ? grossProfit.dividedBy(netRev).mul(100).toNumber()
        : 0;

      // Attribution fraction
      let fraction = new Prisma.Decimal(0);
      if (allocationRule === 'ACTUAL_UNITS') {
        fraction = totalOrgUnitsSold.gt(0) ? stat.unitsSold.dividedBy(totalOrgUnitsSold) : new Prisma.Decimal(0);
      } else if (allocationRule === 'ORDER_COUNT') {
        fraction = totalOrdersCount > 0 ? new Prisma.Decimal(stat.orderSet.size).dividedBy(totalOrdersCount) : new Prisma.Decimal(0);
      } else if (allocationRule === 'REVENUE_SHARE') {
        fraction = totalOrgNetRevenue.gt(0) ? stat.netRevenue.dividedBy(totalOrgNetRevenue) : new Prisma.Decimal(0);
      }

      const allocatedSellingExpense = totalSellingExpenses.mul(fraction);
      const contributionProfit = grossProfit.minus(allocatedSellingExpense);
      const contributionMarginPct = netRev.gt(0)
        ? contributionProfit.dividedBy(netRev).mul(100).toNumber()
        : 0;

      const allocatedOverhead = totalOverheadExpenses.mul(fraction);
      const netProfit = contributionProfit.minus(allocatedOverhead);
      const netMarginPct = netRev.gt(0)
        ? netProfit.dividedBy(netRev).mul(100).toNumber()
        : 0;

      const unitsNum = Number(stat.unitsSold);
      const avgSellingPrice = unitsNum > 0 ? Number(stat.netRevenue.dividedBy(stat.unitsSold)) : 0;
      const avgUnitCogs = unitsNum > 0 ? Number(stat.actualCogs.dividedBy(stat.unitsSold)) : 0;
      const unitContribution = unitsNum > 0 ? Number(contributionProfit.dividedBy(stat.unitsSold)) : 0;

      return {
        productId: stat.productId,
        productName: stat.productName,
        sku: stat.sku,
        barcode: stat.barcode,
        categoryId: stat.categoryId,
        categoryName: stat.categoryName,
        catalogReferencePrice: stat.catalogReferencePrice,
        unitsSold: unitsNum,
        salesCount: stat.orderSet.size,
        grossRevenue: Number(stat.grossRevenue),
        discountTotal: Number(stat.discountTotal),
        netRevenue: Number(stat.netRevenue),
        actualCogs: Number(stat.actualCogs),
        grossProfit: Number(grossProfit),
        grossMarginPct: Number(grossMarginPct.toFixed(2)),
        allocatedSellingExpense: Number(allocatedSellingExpense),
        contributionProfit: Number(contributionProfit),
        contributionMarginPct: Number(contributionMarginPct.toFixed(2)),
        allocatedOverhead: Number(allocatedOverhead),
        netProfit: Number(netProfit),
        netMarginPct: Number(netMarginPct.toFixed(2)),
        avgSellingPrice: Number(avgSellingPrice.toFixed(2)),
        avgUnitCogs: Number(avgUnitCogs.toFixed(2)),
        unitContribution: Number(unitContribution.toFixed(2)),
        hasZeroCostSale: stat.hasZeroCostSale,
        isProfitable: contributionProfit.gte(0),
      };
    });

    // 7. Overall Summary
    let totalGrossRev = 0;
    let totalDiscounts = 0;
    let totalNetRev = 0;
    let totalActualCogs = 0;
    let totalGrossProfit = 0;
    let totalContributionProfit = 0;
    let totalNetProfit = 0;
    let profitableCount = 0;
    let lossCount = 0;
    let zeroCostCount = 0;

    for (const r of productRows) {
      totalGrossRev += r.grossRevenue;
      totalDiscounts += r.discountTotal;
      totalNetRev += r.netRevenue;
      totalActualCogs += r.actualCogs;
      totalGrossProfit += r.grossProfit;
      totalContributionProfit += r.contributionProfit;
      totalNetProfit += r.netProfit;

      if (r.contributionProfit >= 0) {
        profitableCount++;
      } else {
        lossCount++;
      }
      if (r.hasZeroCostSale) {
        zeroCostCount++;
      }
    }

    const overallGrossMarginPct = totalNetRev > 0 ? (totalGrossProfit / totalNetRev) * 100 : 0;
    const overallContributionMarginPct = totalNetRev > 0 ? (totalContributionProfit / totalNetRev) * 100 : 0;
    const overallNetMarginPct = totalNetRev > 0 ? (totalNetProfit / totalNetRev) * 100 : 0;

    return {
      summary: {
        totalProductsCount: productRows.length,
        profitableCount,
        lossCount,
        zeroCostCount,
        totalUnitsSold: Number(totalOrgUnitsSold),
        totalOrdersCount,
        grossRevenue: Number(totalGrossRev.toFixed(2)),
        discountTotal: Number(totalDiscounts.toFixed(2)),
        netRevenue: Number(totalNetRev.toFixed(2)),
        actualCogs: Number(totalActualCogs.toFixed(2)),
        grossProfit: Number(totalGrossProfit.toFixed(2)),
        grossMarginPct: Number(overallGrossMarginPct.toFixed(2)),
        allocatedSellingExpenses: Number(totalSellingExpenses),
        contributionProfit: Number(totalContributionProfit.toFixed(2)),
        contributionMarginPct: Number(overallContributionMarginPct.toFixed(2)),
        allocatedOverhead: Number(totalOverheadExpenses),
        netProfit: Number(totalNetProfit.toFixed(2)),
        netMarginPct: Number(overallNetMarginPct.toFixed(2)),
        allocationRule,
      },
      expenseAttribution: {
        totalSellingExpenses: Number(totalSellingExpenses),
        sellingBreakdown: sellingExpenseBreakdown,
        totalOverheadExpenses: Number(totalOverheadExpenses),
        overheadBreakdown: overheadExpenseBreakdown,
        capitalizedLandedExpensesExcluded: capitalizedExpenseIds.size,
      },
      products: productRows,
    };
  }
}

