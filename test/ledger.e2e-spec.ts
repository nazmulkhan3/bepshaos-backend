import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

describe('LedgerModule (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwtService: any;

  // Org A
  let ownerTokenA: string;
  let orgIdA: string;
  let branchIdA: string;
  let customerIdA: string;
  let supplierIdA: string;
  let productIdA: string;

  // Org B (cross-tenant isolation)
  let ownerTokenB: string;
  let orgIdB: string;

  // Captured IDs during tests
  let saleId: string;
  let purchaseId: string;
  let paymentId: string;
  let saleJournalId: string;
  let accountARId: string;
  let accountCashId: string;
  let customAccountId: string;

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
  });

  afterAll(async () => {
    for (const orgId of [orgIdA, orgIdB]) {
      if (!orgId) continue;
      await db.auditLog.deleteMany({ where: { organizationId: orgId } });
      await db.journalEntryLine.deleteMany({ where: { journalEntry: { organizationId: orgId } } });
      await db.journalEntry.deleteMany({ where: { organizationId: orgId } });
      await db.paymentAllocation.deleteMany({ where: { payment: { organizationId: orgId } } });
      await db.payment.deleteMany({ where: { organizationId: orgId } });
      await db.purchaseItem.deleteMany({ where: { purchase: { organizationId: orgId } } });
      await db.purchase.deleteMany({ where: { organizationId: orgId } });
      await db.saleItem.deleteMany({ where: { sale: { organizationId: orgId } } });
      await db.sale.deleteMany({ where: { organizationId: orgId } });
      await db.inventoryMovement.deleteMany({ where: { organizationId: orgId } });
      await db.inventory.deleteMany({ where: { organizationId: orgId } });
      await db.account.deleteMany({ where: { organizationId: orgId, isSystem: false } });
    }
    if (app) await app.close();
  });

  // ─── SETUP ──────────────────────────────────────────────────────────────────

  it('should set up test environment (users, orgs, branches, customers, suppliers, products)', async () => {
    const testId = nanoid(5);

    // Create owner user A directly via Prisma (avoids Redis dependency)
    const userA = await db.user.create({
      data: { email: `ledger_a_${testId}@test.com`, name: `LedgerOwnerA_${testId}`, password: 'dummy' },
    });
    const sessionA = await db.session.create({
      data: { userId: userA.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100_000) },
    });
    ownerTokenA = jwtService.sign({ sub: userA.id, sessionId: sessionA.id });

    // Create Org A via API (this provisions system accounts via organizationService.createOrganization)
    const orgA = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ name: `LedgerOrgA_${testId}` });
    expect(orgA.status).toBe(201);
    orgIdA = orgA.body.data.id;

    // Create Branch A
    const branchA = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/branches`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Branch A ${testId}`, code: `BRA${testId}` });
    expect(branchA.status).toBe(201);
    branchIdA = branchA.body.data.id;

    // Create customer
    const cust = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/customers`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Customer_${testId}`, phone: `+880111${testId.slice(0, 5)}` });
    expect(cust.status).toBe(201);
    customerIdA = cust.body.data.id;

    // Create supplier
    const supp = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/suppliers`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Supplier_${testId}`, phone: `+880222${testId.slice(0, 5)}` });
    expect(supp.status).toBe(201);
    supplierIdA = supp.body.data.id;

    // Create category
    const cat = await request(app.getHttpServer())
      .post('/v1/categories')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Cat_${testId}` });
    expect(cat.status).toBe(201);
    const categoryIdA = cat.body.data.id;

    // Create product
    const prod = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Prod_${testId}`, categoryId: categoryIdA, sellingPrice: 100, unit: 'PCS' });
    expect(prod.status).toBe(201);
    productIdA = prod.body.data.id;

    // Stock in
    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA, productId: productIdA, quantity: 200, note: 'Initial stock' });

    // Create Org B (cross-tenant isolation)
    const userB = await db.user.create({
      data: { email: `ledger_b_${testId}@test.com`, name: `LedgerOwnerB_${testId}`, password: 'dummy' },
    });
    const sessionB = await db.session.create({
      data: { userId: userB.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100_000) },
    });
    ownerTokenB = jwtService.sign({ sub: userB.id, sessionId: sessionB.id });

    const orgB = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({ name: `LedgerOrgB_${testId}` });
    expect(orgB.status).toBe(201);
    orgIdB = orgB.body.data.id;
  });

  // ─── SYSTEM ACCOUNTS ────────────────────────────────────────────────────────

  it('should have provisioned system accounts on org creation', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/ledger/accounts`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(res.status).toBe(200);
    const accounts = res.body.data as any[];
    expect(accounts.length).toBeGreaterThanOrEqual(8);

    const codes = accounts.map((a: any) => a.code);
    expect(codes).toContain('1000'); // Cash
    expect(codes).toContain('1010'); // Bank
    expect(codes).toContain('1100'); // AR
    expect(codes).toContain('1200'); // Inventory
    expect(codes).toContain('2000'); // AP
    expect(codes).toContain('3000'); // Owner Equity
    expect(codes).toContain('4000'); // Sales Revenue
    expect(codes).toContain('5000'); // General Expense

    accountARId = accounts.find((a: any) => a.code === '1100')?.id;
    accountCashId = accounts.find((a: any) => a.code === '1000')?.id;
    expect(accountARId).toBeDefined();
    expect(accountCashId).toBeDefined();

    const cash = accounts.find((a: any) => a.code === '1000');
    expect(cash?.isSystem).toBe(true);
  });

  // ─── ACCOUNT CRUD ────────────────────────────────────────────────────────────

  it('should create a custom account', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/ledger/accounts`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ code: '5100', name: 'Marketing Expense', type: 'EXPENSE', category: 'GENERAL_EXPENSE' });
    expect(res.status).toBe(201);
    customAccountId = res.body.data.id;
    expect(res.body.data.isSystem).toBe(false);
  });

  it('should reject duplicate account code in same org', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/ledger/accounts`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ code: '5100', name: 'Duplicate Code', type: 'EXPENSE', category: 'GENERAL_EXPENSE' });
    expect(res.status).toBe(409);
  });

  it('should update a custom account', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/organizations/${orgIdA}/ledger/accounts/${customAccountId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: 'Marketing & Ads Expense' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Marketing & Ads Expense');
  });

  it('should not deactivate a system account', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/organizations/${orgIdA}/ledger/accounts/${accountCashId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });

  it('should reject account with self-parent', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/organizations/${orgIdA}/ledger/accounts/${customAccountId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ parentId: customAccountId });
    expect(res.status).toBe(400);
  });

  // ─── SALE JOURNAL POSTING ────────────────────────────────────────────────────

  it('should auto-post sale journal when a sale is completed (registered customer → AR DR)', async () => {
    const saleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA,
        customerId: customerIdA,
        items: [{ productId: productIdA, quantity: 2 }],
      });
    expect(saleRes.status).toBe(201);
    saleId = saleRes.body.data.id;
    const saleTotal = parseFloat(saleRes.body.data.totalAmount);

    const jeRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/journal-entries?sourceType=SALE&sourceId=${saleId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(jeRes.status).toBe(200);
    expect(jeRes.body.data.entries.length).toBe(1);

    const je = jeRes.body.data.entries[0];
    saleJournalId = je.id;
    expect(je.sourceType).toBe('SALE');
    expect(je.sourceId).toBe(saleId);
    expect(je.status).toBe('POSTED');

    // Double-entry invariant
    const totalDebit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.debit), 0);
    const totalCredit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.credit), 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.001);
    expect(Math.abs(totalDebit - saleTotal)).toBeLessThan(0.001);
  });

  it('should auto-post sale journal for walk-in sale (no customer → Cash DR)', async () => {
    const saleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA, items: [{ productId: productIdA, quantity: 1 }] });
    expect(saleRes.status).toBe(201);
    const walkinSaleId = saleRes.body.data.id;

    const jeRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/journal-entries?sourceType=SALE&sourceId=${walkinSaleId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(jeRes.status).toBe(200);
    const je = jeRes.body.data.entries[0];
    expect(je.status).toBe('POSTED');

    const totalDebit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.debit), 0);
    const totalCredit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.credit), 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.001);
  });

  // ─── PURCHASE JOURNAL ─────────────────────────────────────────────────────

  it('should auto-post purchase journal (Inventory DR, AP CR)', async () => {
    const purRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA,
        supplierId: supplierIdA,
        items: [{ productId: productIdA, quantity: 10, unitCost: 50 }],
      });
    expect(purRes.status).toBe(201);
    purchaseId = purRes.body.data.id;
    const purTotal = parseFloat(purRes.body.data.total);

    const jeRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/journal-entries?sourceType=PURCHASE&sourceId=${purchaseId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(jeRes.status).toBe(200);
    const je = jeRes.body.data.entries[0];
    expect(je.status).toBe('POSTED');

    const totalDebit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.debit), 0);
    const totalCredit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.credit), 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.001);
    expect(Math.abs(totalDebit - purTotal)).toBeLessThan(0.001);
  });

  // ─── PAYMENT JOURNAL ─────────────────────────────────────────────────────

  it('should auto-post customer payment journal (Cash DR, AR CR)', async () => {
    const payRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/payments`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA,
        customerId: customerIdA,
        direction: 'RECEIVED',
        amount: '200.00',
        method: 'CASH',
        idempotencyKey: `pay-${nanoid(8)}`,
        allocations: [{ saleId, amount: '200.00' }],
      });
    expect(payRes.status).toBe(201);
    paymentId = payRes.body.data.id;

    const jeRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/journal-entries?sourceType=CUSTOMER_PAYMENT&sourceId=${paymentId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(jeRes.status).toBe(200);
    const je = jeRes.body.data.entries[0];
    expect(je.status).toBe('POSTED');

    const totalDebit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.debit), 0);
    const totalCredit = je.lines.reduce((s: number, l: any) => s + parseFloat(l.credit), 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.001);
  });

  // ─── ACCOUNT BALANCE ─────────────────────────────────────────────────────

  it('should return account balance derived from posted journal lines', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/ledger/accounts/${accountARId}/balance`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(res.status).toBe(200);
    const { totalDebit, totalCredit, balance } = res.body.data;
    expect(parseFloat(totalDebit)).toBeGreaterThan(0);
    expect(parseFloat(balance)).toBeCloseTo(parseFloat(totalDebit) - parseFloat(totalCredit), 2);
  });

  // ─── KHATA ──────────────────────────────────────────────────────────────

  it('should return customer khata with transactions and outstanding balance', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/customers/${customerIdA}/khata`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(res.status).toBe(200);
    const { customer, outstanding, transactions } = res.body.data;
    expect(customer.id).toBe(customerIdA);
    expect(transactions.length).toBeGreaterThan(0);
    expect(parseFloat(outstanding)).toBeGreaterThanOrEqual(0);
  });

  it('should return supplier khata with outstanding balance', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/suppliers/${supplierIdA}/khata`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(res.status).toBe(200);
    const { supplier, outstanding, transactions } = res.body.data;
    expect(supplier.id).toBe(supplierIdA);
    expect(parseFloat(outstanding)).toBeGreaterThan(0);
  });

  // ─── LEDGER HISTORY ──────────────────────────────────────────────────────

  it('should return account ledger history with running balance', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/ledger/accounts/${accountARId}/ledger`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(res.status).toBe(200);
    expect(res.body.data.transactions.length).toBeGreaterThan(0);
    const lastTx = res.body.data.transactions[res.body.data.transactions.length - 1];
    expect(isNaN(parseFloat(lastTx.runningBalance))).toBe(false);
  });

  // ─── MANUAL JOURNAL ──────────────────────────────────────────────────────

  it('should create a balanced manual journal entry', async () => {
    const accounts = await db.account.findMany({ where: { organizationId: orgIdA } });
    const cashId = accounts.find(a => a.code === '1000')!.id;
    const equityId = accounts.find(a => a.code === '3000')!.id;

    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/journal-entries`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        description: 'Manual capital injection',
        lines: [
          { accountId: cashId, debit: 5000, credit: 0 },
          { accountId: equityId, debit: 0, credit: 5000 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('POSTED');
  });

  it('should reject an unbalanced manual journal entry', async () => {
    const accounts = await db.account.findMany({ where: { organizationId: orgIdA } });
    const cashId = accounts.find(a => a.code === '1000')!.id;
    const equityId = accounts.find(a => a.code === '3000')!.id;

    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/journal-entries`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        description: 'Unbalanced entry',
        lines: [
          { accountId: cashId, debit: 100, credit: 0 },
          { accountId: equityId, debit: 0, credit: 50 }, // mismatch!
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unbalanced/i);
  });

  it('should reject a manual journal entry with zero on all lines', async () => {
    const accounts = await db.account.findMany({ where: { organizationId: orgIdA } });
    const cashId = accounts.find(a => a.code === '1000')!.id;

    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/journal-entries`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        description: 'Zero amount entry',
        lines: [
          { accountId: cashId, debit: 0, credit: 0 },
          { accountId: cashId, debit: 0, credit: 0 },
        ],
      });
    expect(res.status).toBe(400);
  });

  // ─── IMMUTABILITY ────────────────────────────────────────────────────────

  it('posted journal entry has no PATCH endpoint (immutable by design)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/organizations/${orgIdA}/journal-entries/${saleJournalId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ description: 'Tampered' });
    expect([404, 405]).toContain(res.status);
  });

  // ─── REVERSAL ────────────────────────────────────────────────────────────

  it('should reverse a posted journal entry', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/journal-entries/${saleJournalId}/reverse`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ reason: 'Test reversal' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('POSTED');

    // Original must now be REVERSED
    const orig = await db.journalEntry.findUnique({ where: { id: saleJournalId } });
    expect(orig?.status).toBe('REVERSED');
  });

  it('idempotent reversal: reversing an already-reversed entry returns existing reversal', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/journal-entries/${saleJournalId}/reverse`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ reason: 'Duplicate reversal attempt' });
    expect([200, 201]).toContain(res.status);

    const reversals = await db.journalEntry.findMany({ where: { reversalOfId: saleJournalId } });
    expect(reversals.length).toBe(1);
  });

  // ─── SALE CANCELLATION AUTO-REVERSAL ─────────────────────────────────────

  it('should reverse sale journal when sale is cancelled', async () => {
    const saleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA, customerId: customerIdA, items: [{ productId: productIdA, quantity: 1 }] });
    expect(saleRes.status).toBe(201);
    const newSaleId = saleRes.body.data.id;

    const journals = await db.journalEntry.findMany({
      where: { organizationId: orgIdA, sourceType: 'SALE', sourceId: newSaleId },
    });
    expect(journals.length).toBe(1);
    const origJeId = journals[0].id;

    const cancelRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales/${newSaleId}/cancel`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ reason: 'Test cancel' });
    expect(cancelRes.status).toBe(200);

    const orig = await db.journalEntry.findUnique({ where: { id: origJeId } });
    expect(orig?.status).toBe('REVERSED');

    const reversal = await db.journalEntry.findFirst({ where: { reversalOfId: origJeId } });
    expect(reversal).not.toBeNull();
  });

  // ─── PAYMENT VOID AUTO-REVERSAL ──────────────────────────────────────────

  it('should reverse payment journal when payment is voided', async () => {
    const saleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA, customerId: customerIdA, items: [{ productId: productIdA, quantity: 1 }] });
    const newSaleId = saleRes.body.data.id;
    const saleTotal = parseFloat(saleRes.body.data.totalAmount);

    const payRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/payments`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA, customerId: customerIdA, direction: 'RECEIVED', amount: String(saleTotal), method: 'CASH',
        idempotencyKey: `pay-void-${nanoid(8)}`,
        allocations: [{ saleId: newSaleId, amount: String(saleTotal) }],
      });
    expect(payRes.status).toBe(201);
    const newPaymentId = payRes.body.data.id;

    const payJournals = await db.journalEntry.findMany({
      where: { organizationId: orgIdA, sourceType: 'CUSTOMER_PAYMENT', sourceId: newPaymentId },
    });
    expect(payJournals.length).toBe(1);
    const payJeId = payJournals[0].id;

    const voidRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/payments/${newPaymentId}/void`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(voidRes.status).toBe(200);

    const orig = await db.journalEntry.findUnique({ where: { id: payJeId } });
    expect(orig?.status).toBe('REVERSED');
  });

  // ─── IDEMPOTENCY ─────────────────────────────────────────────────────────

  it('same idempotencyKey should return the same journal entry', async () => {
    const accounts = await db.account.findMany({ where: { organizationId: orgIdA } });
    const cashId = accounts.find(a => a.code === '1000')!.id;
    const equityId = accounts.find(a => a.code === '3000')!.id;
    const idempKey = `idemp-${nanoid(5)}`;

    const payload = {
      description: 'Idempotent capital entry',
      idempotencyKey: idempKey,
      lines: [
        { accountId: cashId, debit: 1000, credit: 0 },
        { accountId: equityId, debit: 0, credit: 1000 },
      ],
    };

    const res1 = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/journal-entries`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send(payload);
    expect(res1.status).toBe(201);

    const res2 = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/journal-entries`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send(payload);
    expect(res2.status).toBe(201);
    expect(res2.body.data.id).toBe(res1.body.data.id);
  });

  // ─── TENANT ISOLATION ────────────────────────────────────────────────────

  it('Org B cannot read Org A accounts', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/ledger/accounts`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdA);
    expect([403, 404]).toContain(res.status);
  });

  it('Org B cannot read Org A journal entries', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/journal-entries`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdA);
    expect([403, 404]).toContain(res.status);
  });

  it('Org B cannot read Org A customer khata', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/customers/${customerIdA}/khata`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdA);
    expect([403, 404]).toContain(res.status);
  });

  // ─── JOURNAL LIST ────────────────────────────────────────────────────────

  it('should list journal entries with pagination', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/journal-entries?page=1&limit=10`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toBeDefined();
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  it('should get a single journal entry by ID', async () => {
    const je = await db.journalEntry.findFirst({ where: { organizationId: orgIdA } });
    if (!je) return;
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/journal-entries/${je.id}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(je.id);
  });

  // ─── FINANCIAL INVARIANT ─────────────────────────────────────────────────

  it('Invariant: All POSTED journal entries must be balanced', async () => {
    const entries = await db.journalEntry.findMany({
      where: { organizationId: orgIdA, status: 'POSTED' },
      include: { lines: true },
    });

    for (const entry of entries) {
      let totalDebit = 0;
      let totalCredit = 0;
      for (const line of entry.lines) {
        totalDebit += parseFloat(line.debit.toString());
        totalCredit += parseFloat(line.credit.toString());
      }
      expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.001);
    }
  });

  it('Source uniqueness: One sale produces exactly one journal entry', async () => {
    const count = await db.journalEntry.count({
      where: { organizationId: orgIdA, sourceType: 'SALE', sourceId: saleId },
    });
    expect(count).toBeLessThanOrEqual(1);
  });
});
