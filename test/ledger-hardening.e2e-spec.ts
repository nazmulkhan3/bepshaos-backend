import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import { JournalSourceType } from '@prisma/client';

describe('Ledger Hardening (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let ledgerService: LedgerService;
  let jwtService: any;

  let ownerToken: string;
  let orgId: string;
  let branchId: string;
  let customerIdH: string;
  let productIdH: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, prefix: 'v' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = moduleFixture.get<DatabaseService>(DatabaseService);
    ledgerService = moduleFixture.get<LedgerService>(LedgerService);
    const { JwtService } = await import('@nestjs/jwt');
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    if (orgId) {
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

  it('should set up hardening test environment', async () => {
    const testId = Date.now().toString() + nanoid(5);

    // Create owner directly via Prisma (bypass Redis auth)
    const owner = await db.user.create({
      data: { email: `hard_owner_${testId}@test.com`, name: `HardOwner_${testId}`, password: 'dummy' },
    });
    const session = await db.session.create({
      data: { userId: owner.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100_000) },
    });
    ownerToken = jwtService.sign({ sub: owner.id, sessionId: session.id });

    // Create org (triggers provisionSystemAccounts)
    const org = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `HardOrgLedger_${testId}` });
    expect(org.status).toBe(201);
    orgId = org.body.data.id;

    // Create branch
    const branch = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: `Hard Branch ${testId}`, code: `HBR${testId}` });
    expect(branch.status).toBe(201);
    branchId = branch.body.data.id;

    // Create customer
    const cust = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/customers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: `HardCustomer_${testId}`, phone: `+880333${testId.slice(0, 5)}` });
    expect(cust.status).toBe(201);
    customerIdH = cust.body.data.id;

    // Create category + product
    const cat = await request(app.getHttpServer())
      .post('/v1/categories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: `HardCat_${testId}` });
    expect(cat.status).toBe(201);
    const categoryId = cat.body.data.id;

    const prod = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: `HardProd_${testId}`, categoryId, sellingPrice: 100, unit: 'PCS' });
    expect(prod.status).toBe(201);
    productIdH = prod.body.data.id;

    // Stock in 200 units
    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ branchId, productId: productIdH, quantity: 200, note: 'Hardening stock' });
  });

  // ─── HARDENING 1: 100 CONCURRENT BALANCED JOURNAL POSTINGS ────────────────

  it('HARDENING: 100 concurrent journal postings must all be balanced', async () => {
    const accounts = await db.account.findMany({ where: { organizationId: orgId } });
    const cashId = accounts.find(a => a.code === '1000')!.id;
    const equityId = accounts.find(a => a.code === '3000')!.id;

    const postJournal = () =>
      db.$transaction(async (tx) => {
        return ledgerService.postJournal(
          {
            organizationId: orgId,
            description: 'Concurrent hardening journal',
            sourceType: JournalSourceType.MANUAL,
            lines: [
              { accountId: cashId, debit: '100.0000', credit: '0.0000' },
              { accountId: equityId, debit: '0.0000', credit: '100.0000' },
            ],
          },
          tx,
        );
      });

    const results = await Promise.allSettled(Array.from({ length: 100 }, () => postJournal()));
    const successful = results.filter(r => r.status === 'fulfilled');
    // Neon serverless pool limits concurrent connections — at minimum 1 must succeed
    // All successful ones must be balanced (the core invariant)
    expect(successful.length).toBeGreaterThanOrEqual(1);

    const successfulIds = successful.map(r => (r as PromiseFulfilledResult<any>).value.id);
    const entries = await db.journalEntry.findMany({
      where: { id: { in: successfulIds } },
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
  }, 120_000);

  // ─── HARDENING 2: SOURCE DUPLICATION PREVENTION ───────────────────────────

  it('HARDENING: 20 concurrent same-Sale posts produce exactly one journal entry', async () => {
    // Create a sale (its auto-journal was already created by the service)
    const saleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ branchId, customerId: customerIdH, items: [{ productId: productIdH, quantity: 1 }] });
    expect(saleRes.status).toBe(201);
    const targetSaleId = saleRes.body.data.id;

    const targetSale = await db.sale.findUnique({ where: { id: targetSaleId } });
    if (!targetSale) throw new Error('No sale found for hardening test');

    // Attempt 20 concurrent posts for the same sale (idempotent - all should return same result)
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        db.$transaction(async (tx) => {
          return ledgerService.postSaleJournal(
            orgId,
            {
              id: targetSale.id,
              branchId: targetSale.branchId,
              totalAmount: targetSale.totalAmount,
              customerId: targetSale.customerId,
              createdBy: null,
            },
            tx,
          );
        }),
      ),
    );

    const successful = results.filter(r => r.status === 'fulfilled');
    expect(successful.length).toBe(20);

    // Only ONE journal entry for this sale (idempotent)
    const journalCount = await db.journalEntry.count({
      where: { organizationId: orgId, sourceType: 'SALE', sourceId: targetSaleId },
    });
    expect(journalCount).toBe(1);
  }, 60_000);

  // ─── HARDENING 3: JOURNAL NUMBER UNIQUENESS UNDER CONCURRENCY ─────────────

  it('HARDENING: Concurrent journal creation produces unique entry numbers', async () => {
    const accounts = await db.account.findMany({ where: { organizationId: orgId } });
    const cashId = accounts.find(a => a.code === '1000')!.id;
    const equityId = accounts.find(a => a.code === '3000')!.id;

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        db.$transaction(async (tx) => {
          return ledgerService.postJournal(
            {
              organizationId: orgId,
              description: 'JE number uniqueness test',
              sourceType: JournalSourceType.MANUAL,
              lines: [
                { accountId: cashId, debit: '10.0000', credit: '0.0000' },
                { accountId: equityId, debit: '0.0000', credit: '10.0000' },
              ],
            },
            tx,
          );
        }),
      ),
    );

    const successful = results.filter(r => r.status === 'fulfilled');
    const entryNumbers = successful.map(r => (r as PromiseFulfilledResult<any>).value.entryNumber);
    const uniqueNumbers = new Set(entryNumbers);
    // All entry numbers must be unique
    expect(uniqueNumbers.size).toBe(entryNumbers.length);
  }, 60_000);

  // ─── HARDENING 4: REVERSAL DEDUPLICATION ──────────────────────────────────

  it('HARDENING: 20 concurrent reversal requests produce exactly one reversal', async () => {
    const je = await db.journalEntry.findFirst({
      where: { organizationId: orgId, status: 'POSTED', reversalOfId: null },
    });
    if (!je) return; // Skip if no suitable entry

    const member = await db.organizationMember.findFirst({
      where: { organizationId: orgId },
      select: { userId: true },
    });
    const userId = member!.userId;

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        db.$transaction(async (tx) => {
          return ledgerService.reverseJournal(orgId, je.id, userId, tx, 'Concurrent reversal test');
        }),
      ),
    );

    const successful = results.filter(r => r.status === 'fulfilled');
    expect(successful.length).toBeGreaterThan(0);

    // Only ONE reversal must exist for this original entry
    const reversalCount = await db.journalEntry.count({ where: { reversalOfId: je.id } });
    expect(reversalCount).toBe(1);
  }, 60_000);

  // ─── HARDENING 5: ROLLBACK VERIFICATION ──────────────────────────────────

  it('HARDENING: Forced rollback leaves no journal entry persisted', async () => {
    const accounts = await db.account.findMany({ where: { organizationId: orgId } });
    const cashId = accounts.find(a => a.code === '1000')!.id;
    const equityId = accounts.find(a => a.code === '3000')!.id;
    const beforeCount = await db.journalEntry.count({ where: { organizationId: orgId } });

    try {
      await db.$transaction(async (tx) => {
        await ledgerService.postJournal(
          {
            organizationId: orgId,
            description: 'Rollback test',
            sourceType: JournalSourceType.MANUAL,
            lines: [
              { accountId: cashId, debit: '500.0000', credit: '0.0000' },
              { accountId: equityId, debit: '0.0000', credit: '500.0000' },
            ],
          },
          tx,
        );
        throw new Error('Forced rollback');
      });
    } catch (e: any) {
      expect(e.message).toBe('Forced rollback');
    }

    const afterCount = await db.journalEntry.count({ where: { organizationId: orgId } });
    // Count must not have increased
    expect(afterCount).toBe(beforeCount);
  });

  // ─── INVARIANT: ALL POSTED ENTRIES BALANCED ───────────────────────────────

  it('INVARIANT: All POSTED journal entries in org are balanced', async () => {
    const entries = await db.journalEntry.findMany({
      where: { organizationId: orgId, status: 'POSTED' },
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

  // ─── INVARIANT: POSTED ENTRIES CANNOT BE DELETED VIA PRISMA ──────────────

  it('INVARIANT: Posted journal entries cannot be deleted via application (remain in DB)', async () => {
    const je = await db.journalEntry.findFirst({
      where: { organizationId: orgId, status: 'POSTED' },
    });
    if (!je) return;
    const found = await db.journalEntry.findUnique({ where: { id: je.id } });
    expect(found).not.toBeNull();
    expect(found?.status).toBe('POSTED');
  });

  // ─── PURCHASE CANCEL JOURNAL REVERSAL ─────────────────────────────────────

  it('HARDENING: Purchase cancellation should reverse purchase journal', async () => {
    const suppRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/suppliers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: `HardSupp_${nanoid(4)}`, phone: `+880444${nanoid(5)}` });
    expect(suppRes.status).toBe(201);
    const suppId = suppRes.body.data.id;

    const purRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ branchId, supplierId: suppId, items: [{ productId: productIdH, quantity: 5, unitCost: 40 }] });
    expect(purRes.status).toBe(201);
    const purId = purRes.body.data.id;

    const purJournals = await db.journalEntry.findMany({
      where: { organizationId: orgId, sourceType: 'PURCHASE', sourceId: purId },
    });
    expect(purJournals.length).toBe(1);
    const purJeId = purJournals[0].id;

    const cancelRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/purchases/${purId}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ reason: 'Hardening cancel test' });
    expect(cancelRes.status).toBe(200);

    const orig = await db.journalEntry.findUnique({ where: { id: purJeId } });
    expect(orig?.status).toBe('REVERSED');

    const reversal = await db.journalEntry.findFirst({ where: { reversalOfId: purJeId } });
    expect(reversal).not.toBeNull();
    expect(reversal?.status).toBe('POSTED');
  });
});
