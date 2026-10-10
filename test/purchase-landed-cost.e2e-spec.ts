import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { AccountCategory, JournalSourceType, PaymentMethod } from '@prisma/client';

describe('Phase 2B: Purchase Landed Cost & Inventory Valuation (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwtService: any;

  let ownerToken: string;
  let orgId: string;
  let branchId: string;
  let supplierId: string;
  let expenseCategoryId: string;
  let cashAccountId: string;

  let productAId: string;
  let productBId: string;
  let productCId: string;

  const auth = () => ({
    Authorization: `Bearer ${ownerToken}`,
    'x-organization-id': orgId,
  });

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
        email: `landed_owner_${testId}@example.com`,
        name: 'Landed Cost Owner',
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

    // 2. Create Organization
    const orgRes = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Landed Cost Org ${testId}` })
      .expect(201);
    orgId = orgRes.body.data.id;

    // Upgrade plan to ENTERPRISE so no quota constraints
    const enterprisePlan = await db.plan.findUnique({ where: { code: 'ENTERPRISE' } });
    if (enterprisePlan) {
      await db.subscription.updateMany({
        where: { organizationId: orgId },
        data: { planId: enterprisePlan.id },
      });
    }

    // 3. Create Branch
    const branchRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/branches`)
      .set(auth())
      .send({ name: 'Central Branch', code: `CB-${testId}` })
      .expect(201);
    branchId = branchRes.body.data.id;

    // 4. Create Supplier
    const suppRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/suppliers`)
      .set(auth())
      .send({ name: 'Apex Wholesalers', phone: `0171${nanoid(7)}` })
      .expect(201);
    supplierId = suppRes.body.data.id;

    // 5. Create Expense Category for Freight
    const freightAcct = await db.account.findFirst({
      where: { organizationId: orgId, category: AccountCategory.GENERAL_EXPENSE },
    });
    const cashAcct = await db.account.findFirst({
      where: { organizationId: orgId, category: AccountCategory.CASH },
    });
    cashAccountId = cashAcct!.id;

    const expCat = await db.expenseCategory.create({
      data: {
        organizationId: orgId,
        name: 'Freight Inwards',
        code: `FREIGHT-${testId}`,
        expenseAccountId: freightAcct!.id,
      },
    });
    expenseCategoryId = expCat.id;

    // 6. Create Products
    const pA = await request(app.getHttpServer())
      .post('/v1/products')
      .set(auth())
      .send({ name: `Product Alpha ${testId}`, sellingPrice: 200, purchasePrice: 100 })
      .expect(201);
    productAId = pA.body.data.id;

    const pB = await request(app.getHttpServer())
      .post('/v1/products')
      .set(auth())
      .send({ name: `Product Beta ${testId}`, sellingPrice: 350, purchasePrice: 200 })
      .expect(201);
    productBId = pB.body.data.id;

    const pC = await request(app.getHttpServer())
      .post('/v1/products')
      .set(auth())
      .send({ name: `Product Gamma ${testId}`, sellingPrice: 50, purchasePrice: 20 })
      .expect(201);
    productCId = pC.body.data.id;
  });

  afterAll(async () => {
    if (orgId) {
      await db.auditLog.deleteMany({ where: { organizationId: orgId } });
      await db.journalEntryLine.deleteMany({ where: { journalEntry: { organizationId: orgId } } });
      await db.journalEntry.deleteMany({ where: { organizationId: orgId } });
      await db.expense.deleteMany({ where: { organizationId: orgId } });
      await db.expenseCategory.deleteMany({ where: { organizationId: orgId } });
      await db.purchaseItem.deleteMany({ where: { purchase: { organizationId: orgId } } });
      await db.purchase.deleteMany({ where: { organizationId: orgId } });
      await db.inventoryMovement.deleteMany({ where: { organizationId: orgId } });
      await db.inventory.deleteMany({ where: { organizationId: orgId } });
      await db.product.deleteMany({ where: { organizationId: orgId } });
      await db.supplier.deleteMany({ where: { organizationId: orgId } });
      await db.branch.deleteMany({ where: { organizationId: orgId } });
    }
    if (app) {
      await app.close();
    }
  });

  it('1. Purchase with no additional acquisition costs: verifies standard baseline and journal', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [{ productId: productAId, quantity: 10, unitCost: 100 }],
      })
      .expect(201);

    const purchase = res.body.data;
    expect(Number(purchase.subtotal)).toBe(1000);
    expect(Number(purchase.total)).toBe(1000);
    expect(Number(purchase.landedCostTotal)).toBe(0);
    expect(Number(purchase.capitalizableCost)).toBe(1000);

    // Verify Inventory record: quantity = 10, averageCost = 100
    const inv = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId: productAId },
    });
    expect(Number(inv?.quantity)).toBe(10);
    expect(Number(inv?.averageCost)).toBe(100);

    // Verify journal: balanced 2-line entry
    const journal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.PURCHASE, sourceId: purchase.id },
      include: { lines: { include: { account: true } } },
    });
    expect(journal).toBeDefined();
    const invLine = journal!.lines.find((l) => l.account.category === AccountCategory.INVENTORY);
    const apLine = journal!.lines.find((l) => l.account.category === AccountCategory.ACCOUNTS_PAYABLE);
    expect(Number(invLine?.debit)).toBe(1000);
    expect(Number(apLine?.credit)).toBe(1000);
  });

  it('2. Purchase with freight and handling allocated across multiple items: verifies proportional cost allocation', async () => {
    // Buy Product B (5 units @ 200 = 1000) and Product C (25 units @ 40 = 1000)
    // Total merchandise = 2000 (each has 50% line total share)
    // Additional costs: freight = 150, handling = 50 -> landedCostTotal = 200
    // Total capitalizable cost = 2200
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [
          { productId: productBId, quantity: 5, unitCost: 200 },
          { productId: productCId, quantity: 25, unitCost: 40 },
        ],
        freight: 150,
        handling: 50,
      })
      .expect(201);

    const purchase = res.body.data;
    expect(Number(purchase.total)).toBe(2000); // Payable to supplier
    expect(Number(purchase.landedCostTotal)).toBe(200);
    expect(Number(purchase.capitalizableCost)).toBe(2200);

    // Verify item allocations: exactly 100 each (50% of 200)
    const itemB = purchase.items.find((i: any) => i.productId === productBId);
    const itemC = purchase.items.find((i: any) => i.productId === productCId);

    expect(Number(itemB.landedCostAllocation)).toBe(100);
    expect(Number(itemB.totalCapitalizableCost)).toBe(1100); // 1000 + 100
    expect(Number(itemC.landedCostAllocation)).toBe(100);
    expect(Number(itemC.totalCapitalizableCost)).toBe(1100); // 1000 + 100

    // Sum of item capitalizable costs equals purchase capitalizable cost
    expect(Number(itemB.totalCapitalizableCost) + Number(itemC.totalCapitalizableCost)).toBe(2200);

    // Verify stock MWAC:
    // Product B: 5 units with total capitalizable cost 1100 -> average cost = 1100 / 5 = 220.00
    const invB = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId: productBId },
    });
    expect(Number(invB?.quantity)).toBe(5);
    expect(Number(invB?.averageCost)).toBe(220);

    // Product C: 25 units with total capitalizable cost 1100 -> average cost = 1100 / 25 = 44.00
    const invC = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId: productCId },
    });
    expect(Number(invC?.quantity)).toBe(25);
    expect(Number(invC?.averageCost)).toBe(44);
  });

  it('3. Different item quantities and prices: verifies proportional allocation preserves unit-cost economics', async () => {
    // New test product D and E
    const pD = await db.product.create({
      data: { organizationId: orgId, name: 'Product Delta', purchasePrice: 50, sellingPrice: 100 },
    });
    const pE = await db.product.create({
      data: { organizationId: orgId, name: 'Product Echo', purchasePrice: 300, sellingPrice: 600 },
    });

    // Buy:
    // Delta: 20 units @ 50 = 1000 (25% of subtotal)
    // Echo:  10 units @ 300 = 3000 (75% of subtotal)
    // Subtotal = 4000
    // Freight = 400 -> Delta gets 100, Echo gets 300
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [
          { productId: pD.id, quantity: 20, unitCost: 50 },
          { productId: pE.id, quantity: 10, unitCost: 300 },
        ],
        freight: 400,
      })
      .expect(201);

    const purchase = res.body.data;
    const itemD = purchase.items.find((i: any) => i.productId === pD.id);
    const itemE = purchase.items.find((i: any) => i.productId === pE.id);

    expect(Number(itemD.landedCostAllocation)).toBe(100);
    expect(Number(itemD.totalCapitalizableCost)).toBe(1100);
    expect(Number(itemE.landedCostAllocation)).toBe(300);
    expect(Number(itemE.totalCapitalizableCost)).toBe(3300);

    // Unit capitalizable costs:
    // Delta unit cost: 1100 / 20 = 55.00
    // Echo unit cost:  3300 / 10 = 330.00
    const invD = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId: pD.id },
    });
    const invE = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId: pE.id },
    });
    expect(Number(invD?.averageCost)).toBe(55);
    expect(Number(invE?.averageCost)).toBe(330);
  });

  it('4. Discounts and applicable taxes: verifies net line totals reconcile with totalAmount and capitalizableCost', async () => {
    const pF = await db.product.create({
      data: { organizationId: orgId, name: 'Product Foxtrot', purchasePrice: 100, sellingPrice: 200 },
    });

    // Foxtrot: 10 units @ 100 = 1000
    // Overall discount: 100 -> merchandise = 900
    // Overall tax: 50 -> total payable = 950
    // Freight: 50 -> capitalizable cost = 1000
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [{ productId: pF.id, quantity: 10, unitCost: 100 }],
        discount: 100,
        tax: 50,
        freight: 50,
      })
      .expect(201);

    const purchase = res.body.data;
    expect(Number(purchase.subtotal)).toBe(1000);
    expect(Number(purchase.discount)).toBe(100);
    expect(Number(purchase.tax)).toBe(50);
    expect(Number(purchase.total)).toBe(950);
    expect(Number(purchase.capitalizableCost)).toBe(1000);

    // Net line total after discount and tax is 950, plus 50 freight = 1000
    const item = purchase.items[0];
    expect(Number(item.lineTotal)).toBe(950);
    expect(Number(item.landedCostAllocation)).toBe(50);
    expect(Number(item.totalCapitalizableCost)).toBe(1000);

    // Stock average cost = 1000 / 10 = 100.0000
    const invF = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId: pF.id },
    });
    expect(Number(invF?.averageCost)).toBe(100);

    // Journal entry: Debit Inventory 1000, Credit AP 950, Credit Cash 50
    const journal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.PURCHASE, sourceId: purchase.id },
      include: { lines: { include: { account: true } } },
    });
    const invLine = journal!.lines.find((l) => l.account.category === AccountCategory.INVENTORY);
    const apLine = journal!.lines.find((l) => l.account.category === AccountCategory.ACCOUNTS_PAYABLE);
    const cashLine = journal!.lines.find((l) => l.account.category === AccountCategory.CASH);

    expect(Number(invLine?.debit)).toBe(1000);
    expect(Number(apLine?.credit)).toBe(950);
    expect(Number(cashLine?.credit)).toBe(50);
  });

  it('5. A purchase cost paid separately to a third-party carrier: keeps supplier payable and carrier payment distinct', async () => {
    const pG = await db.product.create({
      data: { organizationId: orgId, name: 'Product Golf', purchasePrice: 500, sellingPrice: 1000 },
    });

    // Buy 2 units @ 500 = 1000
    // Separate clearing & customs fee: 200
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [{ productId: pG.id, quantity: 2, unitCost: 500 }],
        clearingCharges: 200,
      })
      .expect(201);

    const purchase = res.body.data;
    // Supplier is only owed 1000 (clearing was paid to customs agent)
    expect(Number(purchase.total)).toBe(1000);
    expect(Number(purchase.capitalizableCost)).toBe(1200);

    // AP is credited 1000, Cash is credited 200
    const journal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.PURCHASE, sourceId: purchase.id },
      include: { lines: { include: { account: true } } },
    });
    const apLine = journal!.lines.find((l) => l.account.category === AccountCategory.ACCOUNTS_PAYABLE);
    const cashLine = journal!.lines.find((l) => l.account.category === AccountCategory.CASH);
    expect(Number(apLine?.credit)).toBe(1000);
    expect(Number(cashLine?.credit)).toBe(200);
  });

  it('6. MWAC updates after a second purchase at a different price: blends existing stock and incoming landed cost', async () => {
    // Current Product A stock in Central Branch: 10 units at averageCost 100 (from test 1)
    // Valuation = 10 * 100 = 1000
    // Buy 10 MORE units at unit cost 120 + freight 100:
    // Incoming merchandise = 1200, freight = 100 -> incoming capitalizable cost = 1300
    // Incoming cost per unit = 130
    // New total quantity = 10 + 10 = 20
    // New MWAC = (1000 + 1300) / 20 = 2300 / 20 = 115.00
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [{ productId: productAId, quantity: 10, unitCost: 120 }],
        freight: 100,
      })
      .expect(201);

    const inv = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId: productAId },
    });
    expect(Number(inv?.quantity)).toBe(20);
    expect(Number(inv?.averageCost)).toBe(115);
  });

  it('7. Cancellation and reversal of purchases: reverses stock, restores MWAC, and reverses journal', async () => {
    const pH = await db.product.create({
      data: { organizationId: orgId, name: 'Product Hotel', purchasePrice: 80, sellingPrice: 150 },
    });

    // 1st purchase: 10 units @ 80 = 800
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [{ productId: pH.id, quantity: 10, unitCost: 80 }],
      })
      .expect(201);

    // 2nd purchase: 10 units @ 120 = 1200 -> blended MWAC = (800 + 1200) / 20 = 100
    const p2Res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [{ productId: pH.id, quantity: 10, unitCost: 120 }],
      })
      .expect(201);

    const p2Id = p2Res.body.data.id;
    let invH = await db.inventory.findFirst({ where: { organizationId: orgId, branchId, productId: pH.id } });
    expect(Number(invH?.averageCost)).toBe(100);
    expect(Number(invH?.quantity)).toBe(20);

    // Cancel 2nd purchase
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases/${p2Id}/cancel`)
      .set(auth())
      .send({ reason: 'Shipment rejected at dock' })
      .expect(200);

    invH = await db.inventory.findFirst({ where: { organizationId: orgId, branchId, productId: pH.id } });
    // Stock restored to 10 units, cost restored to 80
    expect(Number(invH?.quantity)).toBe(10);
    expect(Number(invH?.averageCost)).toBe(80);

    // Reversal journal exists and reverses exact amounts
    const origJournal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.PURCHASE, sourceId: p2Id },
    });
    expect(origJournal?.status).toBe('REVERSED');
    const revJournal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, reversalOfId: origJournal!.id },
      include: { lines: { include: { account: true } } },
    });
    expect(revJournal).toBeDefined();
    const invRev = revJournal!.lines.find((l) => l.account.category === AccountCategory.INVENTORY);
    const apRev = revJournal!.lines.find((l) => l.account.category === AccountCategory.ACCOUNTS_PAYABLE);
    expect(Number(invRev?.credit)).toBe(1200);
    expect(Number(apRev?.debit)).toBe(1200);
  });

  it('8. Reconciliation of inventory valuation, journals, and payables: verifies strict mathematical equality', async () => {
    const pI = await db.product.create({
      data: { organizationId: orgId, name: 'Product India', purchasePrice: 250, sellingPrice: 500 },
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [{ productId: pI.id, quantity: 4, unitCost: 250 }],
        freight: 120,
        loading: 30,
      })
      .expect(201);

    const purchase = res.body.data;
    const invI = await db.inventory.findFirst({ where: { organizationId: orgId, branchId, productId: pI.id } });

    // Mathematical reconciliation:
    // Quantity * averageCost == Capitalizable Cost
    const stockValuation = Number(invI?.quantity) * Number(invI?.averageCost);
    expect(stockValuation).toBe(1150); // (4 * 250) + 150 = 1150
    expect(stockValuation).toBe(Number(purchase.capitalizableCost));

    // Journal debit to Inventory == Stock Valuation
    const journal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.PURCHASE, sourceId: purchase.id },
      include: { lines: { include: { account: true } } },
    });
    const invDebit = Number(journal!.lines.find((l) => l.account.category === AccountCategory.INVENTORY)?.debit);
    const apCredit = Number(journal!.lines.find((l) => l.account.category === AccountCategory.ACCOUNTS_PAYABLE)?.credit);
    const cashCredit = Number(journal!.lines.find((l) => l.account.category === AccountCategory.CASH)?.credit);

    expect(invDebit).toBe(stockValuation);
    expect(apCredit).toBe(Number(purchase.total));
    expect(cashCredit).toBe(Number(purchase.landedCostTotal));
    expect(invDebit).toBe(apCredit + cashCredit); // Journal is 100% balanced
  });

  it('9. Prevention of duplicate expense recognition: linking an expense reclassifies it and prevents double-counting', async () => {
    // 1. Record an operating expense for 200 BDT freight paid to third-party carrier
    const expRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/expenses`)
      .set(auth())
      .send({
        branchId,
        categoryId: expenseCategoryId,
        amount: '200',
        paymentMethod: PaymentMethod.CASH,
        paymentAccountId: cashAccountId,
        reference: 'Carrier Bill #9921',
        idempotencyKey: `exp-${nanoid(8)}`,
      })
      .expect(201);
    const expenseId = expRes.body.data.id;

    // Check P&L before purchase: operating expense includes 200
    const plBefore = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/profit-loss`)
      .set(auth())
      .expect(200);
    const opExpBefore = plBefore.body.data.operatingExpense;
    expect(opExpBefore).toBeGreaterThanOrEqual(200);

    // 2. Create purchase of goods (10 units @ 100 = 1000) linking this expense
    const pJ = await db.product.create({
      data: { organizationId: orgId, name: 'Product Juliet', purchasePrice: 100, sellingPrice: 200 },
    });

    const purRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set(auth())
      .send({
        branchId,
        supplierId,
        items: [{ productId: pJ.id, quantity: 10, unitCost: 100 }],
        freight: 200,
        linkedExpenseId: expenseId,
      })
      .expect(201);

    const purchase = purRes.body.data;
    expect(purchase.linkedExpenseId).toBe(expenseId);
    expect(Number(purchase.capitalizableCost)).toBe(1200);

    // Verify journal: credits the Expense account (reclassification) instead of Cash!
    const journal = await db.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.PURCHASE, sourceId: purchase.id },
      include: { lines: { include: { account: true } } },
    });
    const invLine = journal!.lines.find((l) => l.account.category === AccountCategory.INVENTORY);
    const apLine = journal!.lines.find((l) => l.account.category === AccountCategory.ACCOUNTS_PAYABLE);
    const expCreditLine = journal!.lines.find((l) => l.account.category === AccountCategory.GENERAL_EXPENSE);

    expect(Number(invLine?.debit)).toBe(1200);
    expect(Number(apLine?.credit)).toBe(1000);
    expect(Number(expCreditLine?.credit)).toBe(200); // Reclassified!

    // Check P&L after purchase: the 200 freight operating expense has been capitalized!
    // Net operating expense reduced by 200 (not duplicated in P&L)
    const plAfter = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/reports/profit-loss`)
      .set(auth())
      .expect(200);
    expect(plAfter.body.data.operatingExpense).toBe(opExpBefore - 200);
  });

  it('10. Legacy stock valuation dry-run without modifying records: verifies safe audit and reconciliation decisions', async () => {
    // Create an uncosted legacy product and inventory with averageCost = 0
    const pK = await db.product.create({
      data: { organizationId: orgId, name: 'Product Kilo', purchasePrice: 150, sellingPrice: 300 },
    });
    const invK = await db.inventory.create({
      data: {
        organizationId: orgId,
        branchId,
        productId: pK.id,
        quantity: 15,
        averageCost: 0,
      },
    });

    // Call dry-run endpoint
    const dryRunRes = await request(app.getHttpServer())
      .get(`/v1/inventory/valuation-dry-run`)
      .set(auth())
      .expect(200);

    const report = dryRunRes.body.data || dryRunRes.body;
    expect(report.dryRun).toBe(true);
    expect(report.summary.totalAffectedItems).toBeGreaterThanOrEqual(1);

    const affectedK = report.affectedStock.find((s: any) => s.productId === pK.id || s.inventoryId === invK.id);
    expect(affectedK).toBeDefined();
    expect(affectedK.currentAverageCost).toBe('0.0000');
    expect(Number(affectedK.proposedAverageCost)).toBe(150);
    expect(Number(affectedK.proposedValuation)).toBe(15 * 150); // 2250
    expect(affectedK.reconciliationDecision.action).toBe('MANUAL_RECONCILIATION_JOURNAL_REQUIRED');

    // CRITICAL: Verify DB record was NOT modified by the dry run!
    const checkInvK = await db.inventory.findUnique({ where: { id: invK.id } });
    expect(Number(checkInvK?.averageCost)).toBe(0); // Still 0
    expect(Number(checkInvK?.quantity)).toBe(15);
  });
});
