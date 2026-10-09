import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('Report Management (e2e)', () => {
  let app: INestApplication;
  let prisma: DatabaseService;
  let token: string;
  let orgId: string;
  let branchId: string;
  let user: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: 0 });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    
    prisma = app.get(DatabaseService);

    // Setup Test Organization, Branch, User, and Permissions
    user = await prisma.user.upsert({
      where: { email: 'reportuser@example.com' },
      update: {},
      create: {
        email: 'reportuser@example.com',
        name: 'Report User',
        password: 'password',
      },
    });

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: 'mock-hash',
        expiresAt: new Date(Date.now() + 1000000),
      },
    });

    const { JwtService } = await import('@nestjs/jwt');
    const jwtService = app.get(JwtService);
    token = jwtService.sign({ sub: user.id, sessionId: session.id });

    const orgRes = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Report Test Org' });
      
    orgId = orgRes.body.data.id;

    const branch = await prisma.branch.create({
      data: {
        organizationId: orgId,
        name: 'Report Branch',
        code: 'BR-001',
        isDefault: true,
      }
    });
    branchId = branch.id;

    // Seed Data
    const customer = await prisma.customer.create({
      data: {
        organizationId: orgId,
        customerCode: 'CUST-001',
        name: 'Test Customer',
        openingBalance: 100,
      }
    });

    const sale = await prisma.sale.create({
      data: {
        organizationId: orgId,
        branchId,
        customerId: customer.id,
        saleNumber: 'SALE-001',
        status: 'COMPLETED',
        totalAmount: 500,
        paidAmount: 200,
        createdAt: new Date('2026-01-01T10:00:00Z')
      }
    });

    await prisma.payment.create({
      data: {
        organizationId: orgId,
        branchId,
        customerId: customer.id,
        direction: 'RECEIVED',
        paymentNumber: 'PAY-001',
        amount: 200,
        method: 'CASH',
        status: 'COMPLETED',
        createdAt: new Date('2026-01-01T10:00:00Z')
      }
    });

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: orgId,
        branchId,
        supplierCode: 'SUP-001',
        name: 'Test Supplier'
      }
    });

    await prisma.purchase.create({
      data: {
        organizationId: orgId,
        branchId,
        supplierId: supplier.id,
        purchaseNumber: 'PUR-001',
        status: 'COMPLETED',
        total: 800,
        paidAmount: 300,
        createdAt: new Date('2026-01-01T10:00:00Z')
      }
    });

    await prisma.payment.create({
      data: {
        organizationId: orgId,
        branchId,
        supplierId: supplier.id,
        direction: 'PAID',
        paymentNumber: 'PAY-002',
        amount: 300,
        method: 'BANK',
        status: 'COMPLETED',
        createdAt: new Date('2026-01-01T10:00:00Z')
      }
    });

    const expAcc1 = await prisma.account.create({
      data: { organizationId: orgId, code: `T6000-${Date.now()}`, name: 'Supplies', type: 'EXPENSE', category: 'GENERAL_EXPENSE' }
    });

    const expCat = await prisma.expenseCategory.create({
      data: {
        organizationId: orgId,
        name: 'Office Supplies',
        code: 'CAT-001',
        expenseAccountId: expAcc1.id
      }
    });

    await prisma.expense.create({
      data: {
        organizationId: orgId,
        branchId,
        categoryId: expCat.id,
        paymentAccountId: expAcc1.id,
        amount: 150,
        status: 'COMPLETED',
        expenseNumber: 'EXP-001',
        paymentMethod: 'CASH',
        expenseDate: new Date('2026-01-01T10:00:00Z')
      }
    });

    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        name: 'Test Product',
        sku: 'SKU-001',
        purchasePrice: 50,
        sellingPrice: 100
      }
    });

    await prisma.inventory.create({
      data: {
        organizationId: orgId,
        branchId,
        productId: product.id,
        quantity: 10
      }
    });

    await prisma.inventoryMovement.create({
      data: {
        organizationId: orgId,
        branchId,
        productId: product.id,
        movementType: 'STOCK_IN',
        quantity: 10,
        beforeQuantity: 0,
        afterQuantity: 10,
        createdAt: new Date('2026-01-01T10:00:00Z')
      }
    });

    const revAcc = await prisma.account.create({
      data: { organizationId: orgId, code: `T4000-${Date.now()}`, name: 'Revenue', type: 'REVENUE', category: 'SALES_REVENUE' }
    });
    const expAcc = await prisma.account.create({
      data: { organizationId: orgId, code: `T5000-${Date.now()}`, name: 'Expense', type: 'EXPENSE', category: 'GENERAL_EXPENSE' }
    });

    const je = await prisma.journalEntry.create({
      data: {
        organizationId: orgId,
        branchId,
        entryNumber: 'JE-001',
        description: 'Test',
        sourceType: 'SALE',
        status: 'POSTED',
      }
    });
    await prisma.journalEntryLine.create({
      data: { journalEntryId: je.id, accountId: revAcc.id, debit: 0, credit: 500 }
    });
    await prisma.journalEntryLine.create({
      data: { journalEntryId: je.id, accountId: expAcc.id, debit: 300, credit: 0 }
    });
  });

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntry: { organizationId: orgId } } });
    await prisma.journalEntry.deleteMany({ where: { organizationId: orgId } });
    await prisma.inventoryMovement.deleteMany({ where: { organizationId: orgId } });
    await prisma.inventory.deleteMany({ where: { organizationId: orgId } });
    await prisma.product.deleteMany({ where: { organizationId: orgId } });
    await prisma.expense.deleteMany({ where: { organizationId: orgId } });
    await prisma.expenseCategory.deleteMany({ where: { organizationId: orgId } });
    await prisma.payment.deleteMany({ where: { organizationId: orgId } });
    await prisma.purchaseItem.deleteMany({ where: { purchase: { organizationId: orgId } } });
    await prisma.purchase.deleteMany({ where: { organizationId: orgId } });
    await prisma.supplier.deleteMany({ where: { organizationId: orgId } });
    await prisma.saleItem.deleteMany({ where: { sale: { organizationId: orgId } } });
    await prisma.sale.deleteMany({ where: { organizationId: orgId } });
    await prisma.customer.deleteMany({ where: { organizationId: orgId } });
    await prisma.account.deleteMany({ where: { organizationId: orgId } });
    await prisma.branch.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.role.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { email: 'reportuser@example.com' } });
    await app.close();
  });

  it('GET /v1/organizations/:id/reports/sales', () => {
    return request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/sales`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data.summary.totalSales).toBe(500);
        expect(res.body.data.summary.totalPaid).toBe(200);
        expect(res.body.data.summary.totalDue).toBe(300);
      });
  });

  it('GET /v1/organizations/:id/reports/outstanding', () => {
    return request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/outstanding`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        // Opening balance(100) + Sale(500) - Payment(200) = 400
        expect(res.body.data.customerOutstanding).toBe(400);
      });
  });

  it('GET /v1/organizations/:id/reports/profit-loss', () => {
    return request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/profit-loss`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        // Revenue (500) - Expense (300) = 200
        expect(res.body.data.revenue.total).toBe(500);
        expect(res.body.data.expense.total).toBe(300);
        expect(res.body.data.netProfit).toBe(200);
      });
  });
  it('GET /v1/organizations/:id/reports/purchases', () => {
    return request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/purchases`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data.summary.totalPurchases).toBe(800);
        expect(res.body.data.summary.totalPaid).toBe(300);
        expect(res.body.data.summary.totalDue).toBe(500);
      });
  });

  it('GET /v1/organizations/:id/reports/payments', () => {
    return request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/payments`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data.collections.total).toBe(200);
        expect(res.body.data.payments.total).toBe(300);
      });
  });

  it('GET /v1/organizations/:id/reports/expenses', () => {
    return request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/expenses`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data.summary.totalExpenses).toBe(150);
      });
  });

  it('GET /v1/organizations/:id/reports/inventory', () => {
    return request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/inventory`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data.current.totalQuantity).toBe(10);
        expect(res.body.data.current.estimatedValue).toBe(500); // 10 * 50
      });
  });

  it('GET /v1/organizations/:id/reports/dashboard', () => {
    return request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/dashboard`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data.totalSales).toBe(500);
        expect(res.body.data.totalCollections).toBe(200);
        expect(res.body.data.totalReceivables).toBe(400);
        expect(res.body.data.estimatedInventoryValue).toBe(500);
      });
  });
});
