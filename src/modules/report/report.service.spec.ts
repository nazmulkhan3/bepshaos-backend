import { Test, TestingModule } from '@nestjs/testing';
import { ReportService } from './report.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { Prisma } from '@prisma/client';

describe('ReportService - Product Profitability & Loss Analytics (Phase 2D)', () => {
  let service: ReportService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      saleItem: {
        findMany: vi.fn(),
      },
      expense: {
        findMany: vi.fn(),
      },
      purchase: {
        findMany: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: DatabaseService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
  });

  it('should accurately calculate gross, contribution, and net profit with variable selling attribution', async () => {
    // Product 1: 10 units sold @ 100 BDT, costPrice = 60 BDT (COGS = 600, NetRev = 1000, Gross = 400)
    // Product 2: 20 units sold @ 50 BDT, costPrice = 40 BDT (COGS = 800, NetRev = 1000, Gross = 200)
    // Total Units = 30 units
    const mockSaleItems = [
      {
        saleId: 'sale-1',
        productId: 'prod-1',
        quantity: new Prisma.Decimal(10),
        unitPrice: new Prisma.Decimal(100),
        discountAmount: new Prisma.Decimal(0),
        costPrice: new Prisma.Decimal(60),
        lineTotal: new Prisma.Decimal(1000),
        product: {
          id: 'prod-1',
          name: 'Polo Shirt',
          sku: 'SKU-POLO',
          barcode: '123456',
          categoryId: 'cat-apparel',
          purchasePrice: new Prisma.Decimal(55),
          category: { id: 'cat-apparel', name: 'Apparel' },
        },
        sale: { id: 'sale-1', saleNumber: 'S-001', branchId: 'b-1', createdAt: new Date() },
      },
      {
        saleId: 'sale-2',
        productId: 'prod-2',
        quantity: new Prisma.Decimal(20),
        unitPrice: new Prisma.Decimal(50),
        discountAmount: new Prisma.Decimal(0),
        costPrice: new Prisma.Decimal(40),
        lineTotal: new Prisma.Decimal(1000),
        product: {
          id: 'prod-2',
          name: 'Socks Pack',
          sku: 'SKU-SOCK',
          barcode: '789012',
          categoryId: 'cat-apparel',
          purchasePrice: new Prisma.Decimal(35),
          category: { id: 'cat-apparel', name: 'Apparel' },
        },
        sale: { id: 'sale-2', saleNumber: 'S-002', branchId: 'b-1', createdAt: new Date() },
      },
    ];

    // Expenses:
    // 1. Delivery & Courier subsidy = 300 BDT (Variable Selling)
    // 2. Office rent overhead = 600 BDT (Fixed Overhead)
    // 3. Purchase freight already capitalized = 200 BDT (Must be excluded to prevent double counting!)
    const mockExpenses = [
      {
        id: 'exp-delivery',
        amount: new Prisma.Decimal(300),
        expenseNumber: 'EXP-001',
        reference: 'Pathao Courier Invoice',
        category: {
          id: 'cat-del',
          name: 'Delivery Subsidy Courier',
          code: 'EXP-DELIV',
          account: { code: '5200', category: 'GENERAL_EXPENSE' },
        },
      },
      {
        id: 'exp-rent',
        amount: new Prisma.Decimal(600),
        expenseNumber: 'EXP-002',
        reference: 'HQ Rent',
        category: {
          id: 'cat-rent',
          name: 'Office Rent & Utilities',
          code: 'EXP-RENT',
          account: { code: '5300', category: 'GENERAL_EXPENSE' },
        },
      },
      {
        id: 'exp-capitalized-freight',
        amount: new Prisma.Decimal(200),
        expenseNumber: 'EXP-003',
        reference: 'Freight on Raw Goods',
        category: {
          id: 'cat-freight',
          name: 'Inward Freight Cargo',
          code: 'EXP-FREIGHT',
          account: { code: '1300', category: 'INVENTORY' },
        },
      },
    ];

    // Capitalized purchase with linked expense
    const mockPurchases = [{ linkedExpenseId: 'exp-capitalized-freight' }];

    mockPrisma.saleItem.findMany.mockResolvedValueOnce(mockSaleItems);
    mockPrisma.expense.findMany.mockResolvedValueOnce(mockExpenses);
    mockPrisma.purchase.findMany.mockResolvedValueOnce(mockPurchases);

    const result = await service.getProductProfitability('org-1', {
      allocationRule: 'ACTUAL_UNITS',
    });

    // 1. Excluded capitalized expenses verification
    expect(result.expenseAttribution.capitalizedLandedExpensesExcluded).toBe(1);
    expect(result.expenseAttribution.totalSellingExpenses).toBe(300);
    expect(result.expenseAttribution.totalOverheadExpenses).toBe(600);

    // 2. Summary verification:
    // Total Units = 30
    // Total Net Rev = 2000
    // Total COGS = 600 + 800 = 1400
    // Total Gross Profit = 600
    // Total Selling Expenses = 300
    // Total Contribution Profit = 600 - 300 = 300
    // Total Overhead = 600
    // Total Net Profit = 300 - 600 = -300
    expect(result.summary.totalUnitsSold).toBe(30);
    expect(result.summary.netRevenue).toBe(2000);
    expect(result.summary.actualCogs).toBe(1400);
    expect(result.summary.grossProfit).toBe(600);
    expect(result.summary.grossMarginPct).toBe(30);
    expect(result.summary.contributionProfit).toBe(300);
    expect(result.summary.contributionMarginPct).toBe(15);
    expect(result.summary.netProfit).toBe(-300);

    // 3. Product Row attribution check (Polo: 10/30 = 33.33% of units sold)
    // Polo Selling Exp = 300 * (10/30) = 100
    // Polo Gross = 1000 - 600 = 400
    // Polo Contribution = 400 - 100 = 300
    // Polo Overhead = 600 * (10/30) = 200
    // Polo Net Profit = 300 - 200 = 100 (Profitable!)
    const polo = result.products.find((p) => p.productId === 'prod-1')!;
    expect(polo.unitsSold).toBe(10);
    expect(polo.grossProfit).toBe(400);
    expect(polo.allocatedSellingExpense).toBeCloseTo(100, 1);
    expect(polo.contributionProfit).toBeCloseTo(300, 1);
    expect(polo.netProfit).toBeCloseTo(100, 1);
    expect(polo.isProfitable).toBe(true);

    // Socks: 20/30 = 66.67% of units sold
    // Socks Selling Exp = 300 * (20/30) = 200
    // Socks Gross = 1000 - 800 = 200
    // Socks Contribution = 200 - 200 = 0
    // Socks Overhead = 600 * (20/30) = 400
    // Socks Net Profit = 0 - 400 = -400 (Loss-making after overhead!)
    const socks = result.products.find((p) => p.productId === 'prod-2')!;
    expect(socks.unitsSold).toBe(20);
    expect(socks.grossProfit).toBe(200);
    expect(socks.allocatedSellingExpense).toBeCloseTo(200, 1);
    expect(socks.contributionProfit).toBeCloseTo(0, 1);
    expect(socks.netProfit).toBeCloseTo(-400, 1);
  });

  it('should flag products with zero cost sale (uninitialized or missing historical COGS)', async () => {
    const mockSaleItems = [
      {
        saleId: 'sale-1',
        productId: 'prod-legacy',
        quantity: new Prisma.Decimal(5),
        unitPrice: new Prisma.Decimal(200),
        discountAmount: new Prisma.Decimal(0),
        costPrice: new Prisma.Decimal(0), // zero cost snapshot!
        lineTotal: new Prisma.Decimal(1000),
        product: {
          id: 'prod-legacy',
          name: 'Legacy Untracked Widget',
          sku: 'SKU-LEGACY',
          barcode: null,
          categoryId: null,
          purchasePrice: new Prisma.Decimal(150),
          category: null,
        },
        sale: { id: 'sale-1', saleNumber: 'S-001', branchId: 'b-1', createdAt: new Date() },
      },
    ];

    mockPrisma.saleItem.findMany.mockResolvedValueOnce(mockSaleItems);
    mockPrisma.expense.findMany.mockResolvedValueOnce([]);
    mockPrisma.purchase.findMany.mockResolvedValueOnce([]);

    const result = await service.getProductProfitability('org-1', {});

    expect(result.summary.zeroCostCount).toBe(1);
    const legacy = result.products[0];
    expect(legacy.hasZeroCostSale).toBe(true);
    expect(legacy.actualCogs).toBe(0);
  });
});
