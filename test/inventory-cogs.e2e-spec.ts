import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { AccountCategory, JournalSourceType } from '@prisma/client';

describe('Inventory Costing & COGS Integration (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwtService: any;

  let ownerToken: string;
  let orgId: string;
  let branchId1: string;
  let branchId2: string;
  let productId: string;
  let supplierId: string;
  let customerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, prefix: 'v' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = moduleFixture.get<DatabaseService>(DatabaseService);
    const { JwtService } = await import('@nestjs/jwt');
    jwtService = app.get(JwtService);

    const testId = Date.now().toString() + nanoid(5);

    // 1. Create Owner User
    const owner = await db.user.create({
      data: {
        email: `costing_owner_${testId}@example.com`,
        name: 'Costing Owner',
        password: 'dummy',
      },
    });
    const session = await db.session.create({
      data: {
        userId: owner.id,
        refreshTokenHash: 'hash',
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    ownerToken = jwtService.sign({ sub: owner.id, sessionId: session.id });

    // 2. Create Org
    const orgRes = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Costing Org ${testId}` });
    orgId = orgRes.body.data.id;

    // Upgrade org to ENTERPRISE plan so branch and transaction limits do not block test
    const enterprisePlan = await db.plan.findUnique({ where: { code: 'ENTERPRISE' } });
    if (enterprisePlan) {
      await db.subscription.updateMany({
        where: { organizationId: orgId },
        data: { planId: enterprisePlan.id },
      });
    }

    // 3. Create Branches
    const b1 = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: 'Branch 1', code: `B1-${testId}` })
      .expect(201);
    branchId1 = b1.body.data.id;

    const b2 = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: 'Branch 2', code: `B2-${testId}` })
      .expect(201);
    branchId2 = b2.body.data.id;

    // 4. Create Supplier & Customer
    const supp = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/suppliers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: 'Main Supplier', phone: `0171${nanoid(7)}` })
      .expect(201);
    supplierId = supp.body.data.id;

    const cust = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/customers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: 'Loyal Customer', phone: `0181${nanoid(7)}` })
      .expect(201);
    customerId = cust.body.data.id;

    // 5. Create Product (catalog selling price 200)
    const prod = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        name: `Widget ${testId}`,
        sellingPrice: 200,
        purchasePrice: 100,
      })
      .expect(201);
    productId = prod.body.data.id;
  });

  afterAll(async () => {
    if (orgId) {
      await db.journalEntryLine.deleteMany({ where: { journalEntry: { organizationId: orgId } } });
      await db.journalEntry.deleteMany({ where: { organizationId: orgId } });
      await db.saleItem.deleteMany({ where: { sale: { organizationId: orgId } } });
      await db.sale.deleteMany({ where: { organizationId: orgId } });
      await db.purchaseItem.deleteMany({ where: { purchase: { organizationId: orgId } } });
      await db.purchase.deleteMany({ where: { organizationId: orgId } });
      await db.inventoryMovement.deleteMany({ where: { organizationId: orgId } });
      await db.inventory.deleteMany({ where: { organizationId: orgId } });
    }
    if (app) {
      await app.close();
    }
  });

  it('1. Purchase of stock at one cost, followed by a sale: verifies MWAC and balanced COGS journal', async () => {
    // Buy 10 units at BDT 100 each into Branch 1
    const p1Res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId: branchId1,
        supplierId,
        items: [{ productId, quantity: 10, unitCost: 100 }],
      })
      .expect(201);

    expect(Number(p1Res.body.data.total)).toBe(1000);

    // Verify Inventory record: quantity = 10, averageCost = 100.0000
    const inv1 = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId: branchId1, productId },
    });
    expect(Number(inv1?.quantity)).toBe(10);
    expect(Number(inv1?.averageCost)).toBe(100);

    // Sell 4 units at BDT 200 (Total = 800, expected COGS = 4 * 100 = 400)
    const sale1Res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId: branchId1,
        customerId,
        items: [{ productId, quantity: 4, unitPrice: 200 }],
      })
      .expect(201);

    const sale1 = sale1Res.body.data;
    expect(Number(sale1.totalAmount)).toBe(800);

    // Check SaleItem costPrice captured as 100
    const saleItem = await db.saleItem.findFirst({ where: { saleId: sale1.id } });
    expect(Number(saleItem?.costPrice)).toBe(100);

    // Verify balanced double-entry journal lines
    const journal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.SALE, sourceId: sale1.id },
      include: { lines: { include: { account: true } } },
    });
    expect(journal).toBeDefined();

    let totalDebit = 0;
    let totalCredit = 0;
    let cogsDebit = 0;
    let inventoryCredit = 0;

    for (const line of journal!.lines) {
      totalDebit += Number(line.debit);
      totalCredit += Number(line.credit);
      if (line.account.category === AccountCategory.COST_OF_GOODS_SOLD) {
        cogsDebit += Number(line.debit);
      }
      if (line.account.category === AccountCategory.INVENTORY) {
        inventoryCredit += Number(line.credit);
      }
    }

    expect(totalDebit).toBe(totalCredit); // Must balance exactly!
    expect(totalDebit).toBe(1200); // 800 revenue leg + 400 COGS leg
    expect(cogsDebit).toBe(400); // COGS = 4 * 100
    expect(inventoryCredit).toBe(400); // Inventory asset credited 400
  });

  it('2. Purchase at a different cost updates Moving Weighted Average Cost (MWAC)', async () => {
    // Current stock in Branch 1: 6 units remaining at average cost 100
    // Buy 4 more units at BDT 150 each
    // New total quantity = 6 + 4 = 10
    // Expected MWAC = (6 * 100 + 4 * 150) / 10 = (600 + 600) / 10 = 120.00
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId: branchId1,
        supplierId,
        items: [{ productId, quantity: 4, unitCost: 150 }],
      })
      .expect(201);

    const inv = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId: branchId1, productId },
    });
    expect(Number(inv?.quantity)).toBe(10);
    expect(Number(inv?.averageCost)).toBe(120);

    // Sell 5 units at BDT 200 (expected COGS = 5 * 120 = 600)
    const sale2Res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId: branchId1,
        customerId,
        items: [{ productId, quantity: 5, unitPrice: 200 }],
      })
      .expect(201);

    const sale2 = sale2Res.body.data;
    const sale2Item = await db.saleItem.findFirst({ where: { saleId: sale2.id } });
    expect(Number(sale2Item?.costPrice)).toBe(120);

    // Verify journal: COGS debit = 600, Inventory credit = 600
    const journal2 = await db.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.SALE, sourceId: sale2.id },
      include: { lines: { include: { account: true } } },
    });
    const cogsLine = journal2!.lines.find((l) => l.account.category === AccountCategory.COST_OF_GOODS_SOLD);
    expect(Number(cogsLine?.debit)).toBe(600);
  });

  it('3. Sale cancellation restores stock and reverses the exact original COGS and inventory amounts', async () => {
    // Create a sale of 2 units (cost is 120 each -> COGS = 240)
    const saleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId: branchId1,
        customerId,
        items: [{ productId, quantity: 2, unitPrice: 200 }],
      })
      .expect(201);

    const saleId = saleRes.body.data.id;

    // Stock before cancel was 3 units
    const invBefore = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId: branchId1, productId },
    });
    expect(Number(invBefore?.quantity)).toBe(3);

    // Cancel the sale
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales/${saleId}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ reason: 'Customer returned immediately' })
      .expect(200);

    // Stock restored to 5
    const invAfter = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId: branchId1, productId },
    });
    expect(Number(invAfter?.quantity)).toBe(5);

    // Verify reversal journal entry
    const originalJournal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.SALE, sourceId: saleId },
    });
    expect(originalJournal?.status).toBe('REVERSED');

    const reversalJournal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, reversalOfId: originalJournal!.id },
      include: { lines: { include: { account: true } } },
    });
    expect(reversalJournal).toBeDefined();

    // In reversal: COGS is CREDITED 240, Inventory is DEBITED 240
    const cogsReversal = reversalJournal!.lines.find((l) => l.account.category === AccountCategory.COST_OF_GOODS_SOLD);
    const invReversal = reversalJournal!.lines.find((l) => l.account.category === AccountCategory.INVENTORY);

    expect(Number(cogsReversal?.credit)).toBe(240);
    expect(Number(invReversal?.debit)).toBe(240);
  });

  it('4. Multi-branch isolation: Branch 2 maintains completely independent stock and MWAC', async () => {
    // Buy 20 units at BDT 80 into Branch 2
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId: branchId2,
        supplierId,
        items: [{ productId, quantity: 20, unitCost: 80 }],
      })
      .expect(201);

    const invB2 = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId: branchId2, productId },
    });
    expect(Number(invB2?.quantity)).toBe(20);
    expect(Number(invB2?.averageCost)).toBe(80);

    // Sell 5 units from Branch 2 -> COGS must be 5 * 80 = 400 (not affected by Branch 1's 120 cost)
    const saleB2Res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId: branchId2,
        items: [{ productId, quantity: 5, unitPrice: 200 }],
      })
      .expect(201);

    const saleB2Item = await db.saleItem.findFirst({ where: { saleId: saleB2Res.body.data.id } });
    expect(Number(saleB2Item?.costPrice)).toBe(80);
  });

  it('5. ReportService calculates Gross Profit, COGS, and Margins accurately', async () => {
    const reportRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/profit-loss`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .expect(200);

    const report = reportRes.body.data;
    expect(report.cogs).toBeGreaterThan(0);
    expect(report.grossProfit).toBe(report.revenue.total - report.cogs);
    expect(report.grossMarginPercent).toBeGreaterThan(0);
    expect(report.netProfit).toBe(report.grossProfit - report.operatingExpense);
  });
});
