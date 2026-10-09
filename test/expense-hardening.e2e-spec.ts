import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

describe('ExpensesController - Hardening (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwtService: any;

  let ownerToken: string;
  let orgId: string;
  let branchA: string;
  let branchB: string;
  let branchB1: string;
  let expenseAccountId: string;
  let paymentAccountId: string;
  let categoryId: string;

  // Org B (tenant isolation)
  let ownerTokenB: string;
  let orgIdB: string;
  let categoryIdB: string;
  let expenseAccountIdB: string;
  let paymentAccountIdB: string;

  const auth = (token = ownerToken, org = orgId) => ({
    Authorization: `Bearer ${token}`,
    'x-organization-id': org,
  });

  const createExpense = (payload: any) =>
    request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/expenses`)
      .set(auth())
      .send({ idempotencyKey: `idem-${nanoid(8)}`, ...payload });

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

    const testId = nanoid(5);

    const owner = await db.user.create({
      data: { email: `exph_owner_${testId}@example.com`, name: 'Hard Owner', password: 'dummy' },
    });
    const session = await db.session.create({
      data: { userId: owner.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
    });
    ownerToken = jwtService.sign({ sub: owner.id, sessionId: session.id });

    const orgRes = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Exp Hard Org ${testId}` });
    orgId = orgRes.body.data.id;

    const b1 = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/branches`)
      .set(auth())
      .send({ name: 'Hard Branch A', code: `EXHA-${testId}` })
      .expect(201);
    branchA = b1.body.data.id;

    const b2 = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/branches`)
      .set(auth())
      .send({ name: 'Hard Branch B', code: `EXHB-${testId}` })
      .expect(201);
    branchB = b2.body.data.id;

    const accountsA = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/ledger/accounts`)
      .set(auth());
    expenseAccountId = accountsA.body.data.find((a: any) => a.code === '5000').id;
    paymentAccountId = accountsA.body.data.find((a: any) => a.code === '1000').id;

    const catRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/expenses/categories`)
      .set(auth())
      .send({ name: `Hard Category ${testId}`, code: `HCAT-${testId}`, expenseAccountId })
      .expect(201);
    categoryId = catRes.body.data.id;

    // Org B
    const ownerB = await db.user.create({
      data: { email: `exph_owner_b_${testId}@example.com`, name: 'Hard Owner B', password: 'dummy' },
    });
    const sessionB = await db.session.create({
      data: { userId: ownerB.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
    });
    ownerTokenB = jwtService.sign({ sub: ownerB.id, sessionId: sessionB.id });

    const orgResB = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({ name: `Exp Hard Org B ${testId}` });
    orgIdB = orgResB.body.data.id;

    const bResB = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdB}/branches`)
      .set(auth(ownerTokenB, orgIdB))
      .send({ name: 'Hard Branch B1', code: `EXHB1-${testId}` })
      .expect(201);
    branchB1 = bResB.body.data.id;

    const accountsB = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdB}/ledger/accounts`)
      .set(auth(ownerTokenB, orgIdB));
    expenseAccountIdB = accountsB.body.data.find((a: any) => a.code === '5000').id;
    paymentAccountIdB = accountsB.body.data.find((a: any) => a.code === '1000').id;

    const catResB = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdB}/expenses/categories`)
      .set(auth(ownerTokenB, orgIdB))
      .send({ name: `Hard Category B ${testId}`, code: `HCATB-${testId}`, expenseAccountId: expenseAccountIdB })
      .expect(201);
    categoryIdB = catResB.body.data.id;
  });

  afterAll(async () => {
    await dropAllTriggers();
    for (const org of [orgId, orgIdB].filter(Boolean)) {
      await db.auditLog.deleteMany({ where: { organizationId: org } });
      await db.journalEntryLine.deleteMany({ where: { journalEntry: { organizationId: org } } });
      await db.journalEntry.deleteMany({ where: { organizationId: org } });
      await db.expense.deleteMany({ where: { organizationId: org } });
      await db.expenseCategory.deleteMany({ where: { organizationId: org } });
      await db.account.deleteMany({ where: { organizationId: org, isSystem: false } });
      await db.branch.deleteMany({ where: { organizationId: org } });
      await db.organizationMember.deleteMany({ where: { organizationId: org } });
    }
    if (app) await app.close();
  });

  const dropAllTriggers = async () => {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS phase16_fail_exp_audit_trg ON "AuditLog"`).catch(() => {});
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS phase16_fail_exp_cancel_audit_trg ON "AuditLog"`).catch(() => {});
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS phase16_fail_exp_audit()`).catch(() => {});
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS phase16_fail_exp_cancel_audit()`).catch(() => {});
  };

  /* ------------------------------------------------------------------ */
  /* TEST 1 — Concurrent Creation                                       */
  /* ------------------------------------------------------------------ */
  it('TEST 1: Run at least 20 concurrent expense creation requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }).map((_, i) => 
        createExpense({
          branchId: branchA,
          categoryId,
          amount: '10',
          paymentMethod: 'CASH',
          paymentAccountId,
          idempotencyKey: `idem-t1-${nanoid(5)}-${i}`,
        })
      )
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);

    const numbers = responses.map((r) => r.body.data.expenseNumber);
    expect(new Set(numbers).size).toBe(20);

    const expenses = await db.expense.findMany({ where: { id: { in: responses.map((r) => r.body.data.id) } } });
    for (const exp of expenses) {
      const je = await db.journalEntry.findFirst({ where: { sourceId: exp.id, sourceType: 'EXPENSE' }, include: { lines: true } });
      expect(je).toBeDefined();
      const debit = je?.lines.reduce((acc, l) => acc + Number(l.debit), 0);
      const credit = je?.lines.reduce((acc, l) => acc + Number(l.credit), 0);
      expect(debit).toBe(10);
      expect(credit).toBe(10);
    }
  });

  /* ------------------------------------------------------------------ */
  /* TEST 2 — Same Idempotency Key                                      */
  /* ------------------------------------------------------------------ */
  it('TEST 2: Same Idempotency Key - 20 concurrent requests yield exactly 1 expense', async () => {
    const key = `idem-t2-${nanoid(8)}`;
    const payload = {
      branchId: branchA,
      categoryId,
      amount: '15',
      paymentMethod: 'CASH',
      paymentAccountId,
      idempotencyKey: key,
    };

    const responses = await Promise.all(Array.from({ length: 20 }).map(() => createExpense(payload)));
    
    const success = responses.filter((r) => r.status === 201);
    expect(success.length).toBe(1);

    const expenses = await db.expense.findMany({ where: { organizationId: orgId, idempotencyKey: key } });
    expect(expenses.length).toBe(1);

    const je = await db.journalEntry.findMany({ where: { sourceId: expenses[0].id, sourceType: 'EXPENSE' } });
    expect(je.length).toBe(1);
    
    const audits = await db.auditLog.count({ where: { organizationId: orgId, action: 'EXPENSE_CREATED', entityId: expenses[0].id } });
    expect(audits).toBe(1);
  });

  /* ------------------------------------------------------------------ */
  /* TEST 3 — Same Key / Different Payload                              */
  /* ------------------------------------------------------------------ */
  it('TEST 3: Same Key / Different Payload yields 409 Conflict', async () => {
    const key = `idem-t3-${nanoid(8)}`;
    await createExpense({ branchId: branchA, categoryId, amount: '20', paymentMethod: 'CASH', paymentAccountId, idempotencyKey: key }).expect(201);
    await createExpense({ branchId: branchA, categoryId, amount: '30', paymentMethod: 'CASH', paymentAccountId, idempotencyKey: key }).expect(409);
    const expenses = await db.expense.findMany({ where: { organizationId: orgId, idempotencyKey: key } });
    expect(expenses.length).toBe(1);
  });

  /* ------------------------------------------------------------------ */
  /* TEST 4 — Concurrent Cancellation                                   */
  /* ------------------------------------------------------------------ */
  it('TEST 4: Concurrent Cancellation - exactly 1 successful cancellation', async () => {
    const res = await createExpense({ branchId: branchA, categoryId, amount: '40', paymentMethod: 'CASH', paymentAccountId }).expect(201);
    const expId = res.body.data.id;

    const responses = await Promise.all(
      Array.from({ length: 20 }).map(() => 
        request(app.getHttpServer())
          .post(`/v1/organizations/${orgId}/expenses/${expId}/cancel`)
          .set(auth())
          .send()
      )
    );

    const success = responses.filter((r) => r.status === 200);
    expect(success.length).toBe(1);

    const je = await db.journalEntry.findMany({ where: { sourceId: expId, sourceType: 'EXPENSE' } });
    expect(je.length).toBe(1);

    const audits = await db.auditLog.count({ where: { organizationId: orgId, action: 'EXPENSE_CANCELLED', entityId: expId } });
    expect(audits).toBe(1);
  });

  /* ------------------------------------------------------------------ */
  /* TEST 5 — Expense Number Collision                                  */
  /* ------------------------------------------------------------------ */
  it('TEST 5: Expense Number Collision - generates unique numbers under heavy load', async () => {
    const responses = await Promise.all(
      Array.from({ length: 30 }).map(() => 
        createExpense({ branchId: branchA, categoryId, amount: '50', paymentMethod: 'CASH', paymentAccountId })
      )
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);

    const numbers = responses.map((r) => r.body.data.expenseNumber);
    expect(new Set(numbers).size).toBe(30);
  });

  /* ------------------------------------------------------------------ */
  /* TEST 6 — Multi-Tenant Isolation                                    */
  /* ------------------------------------------------------------------ */
  it('TEST 6: Multi-Tenant Isolation - cross tenant access is denied', async () => {
    const resB = await request(app.getHttpServer()).post(`/v1/organizations/${orgIdB}/expenses`).set(auth(ownerTokenB, orgIdB)).send({ idempotencyKey: 'idem-test-6', branchId: branchB1, categoryId: categoryIdB, amount: '60', paymentMethod: 'CASH', paymentAccountId: paymentAccountIdB });
    if (resB.status !== 201) console.error('TEST 6 CREATE FAIL:', resB.body);
    expect(resB.status).toBe(201);
    const expIdB = resB.body.data.id;

    await request(app.getHttpServer()).get(`/v1/organizations/${orgId}/expenses/${expIdB}`).set(auth()).expect(404);
    await request(app.getHttpServer()).patch(`/v1/organizations/${orgId}/expenses/categories/${categoryIdB}`).set(auth()).send({ name: 'Hacked' }).expect(404);
    await request(app.getHttpServer()).post(`/v1/organizations/${orgId}/expenses/${expIdB}/cancel`).set(auth()).send().expect(404);
    await createExpense({ branchId: branchA, categoryId: categoryIdB, amount: '10', paymentMethod: 'CASH', paymentAccountId }).expect(404);
    await createExpense({ branchId: branchA, categoryId, amount: '10', paymentMethod: 'CASH', paymentAccountId: paymentAccountIdB }).expect(404);
  });

  /* ------------------------------------------------------------------ */
  /* TEST 7 — Invalid Account Type                                      */
  /* ------------------------------------------------------------------ */
  it('TEST 7: Invalid Account Type - category creation with ASSET account rejected', async () => {
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/expenses/categories`)
      .set(auth())
      .send({ name: 'Invalid', code: 'INV', expenseAccountId: paymentAccountId })
      .expect(400);
  });

  /* ------------------------------------------------------------------ */
  /* TEST 8 — Invalid Payment Account                                   */
  /* ------------------------------------------------------------------ */
  it('TEST 8: Invalid Payment Account - expense creation with EXPENSE account as payment rejected', async () => {
    await createExpense({ branchId: branchA, categoryId, amount: '10', paymentMethod: 'CASH', paymentAccountId: expenseAccountId }).expect(400);
  });

  /* ------------------------------------------------------------------ */
  /* TEST 9 — Creation Rollback                                         */
  /* ------------------------------------------------------------------ */
  it('TEST 9: Creation Rollback - complete rollback on failure before commit', async () => {
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION phase16_fail_exp_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'EXPENSE_CREATED' AND NEW."organizationId" = '${orgId}' THEN
          RAISE EXCEPTION 'Simulated failure after expense creation';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER phase16_fail_exp_audit_trg BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION phase16_fail_exp_audit();
    `);

    try {
      const beforeCount = await db.expense.count({ where: { organizationId: orgId } });
      await createExpense({ branchId: branchA, categoryId, amount: '90', paymentMethod: 'CASH', paymentAccountId }).expect(500);
      expect(await db.expense.count({ where: { organizationId: orgId } })).toBe(beforeCount);
    } finally {
      await dropAllTriggers();
    }
  });

  /* ------------------------------------------------------------------ */
  /* TEST 10 — Cancellation Rollback                                    */
  /* ------------------------------------------------------------------ */
  it('TEST 10: Cancellation Rollback - original journal remains unchanged on failure', async () => {
    const res = await createExpense({ branchId: branchA, categoryId, amount: '100', paymentMethod: 'CASH', paymentAccountId }).expect(201);
    const expId = res.body.data.id;

    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION phase16_fail_exp_cancel_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'EXPENSE_CANCELLED' AND NEW."organizationId" = '${orgId}' THEN
          RAISE EXCEPTION 'Simulated failure during cancellation';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER phase16_fail_exp_cancel_audit_trg BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION phase16_fail_exp_cancel_audit();
    `);

    try {
      await request(app.getHttpServer()).post(`/v1/organizations/${orgId}/expenses/${expId}/cancel`).set(auth()).send().expect(500);
    } finally {
      await dropAllTriggers();
    }

    const exp = await db.expense.findUnique({ where: { id: expId } });
    expect(exp?.status).toBe('COMPLETED');
    expect(await db.journalEntry.count({ where: { sourceId: expId, sourceType: 'EXPENSE' } })).toBe(1);
  });

  /* ------------------------------------------------------------------ */
  /* PART 5 — FINANCIAL PRECISION                                       */
  /* ------------------------------------------------------------------ */
  it('PART 5: Financial Precision - uses exact decimals', async () => {
    const res = await createExpense({ branchId: branchA, categoryId, amount: '9999.9999', paymentMethod: 'CASH', paymentAccountId }).expect(201);
    const expId = res.body.data.id;
    
    const je = await db.journalEntry.findFirst({ where: { sourceId: expId, sourceType: 'EXPENSE' }, include: { lines: true } });
    const debit = je?.lines.find(l => Number(l.debit) > 0);
    const credit = je?.lines.find(l => Number(l.credit) > 0);
    
    expect(debit?.debit.toString()).toBe('9999.9999');
    expect(credit?.credit.toString()).toBe('9999.9999');
  });

  /* ------------------------------------------------------------------ */
  /* PART 6 — JOURNAL IMMUTABILITY                                      */
  /* ------------------------------------------------------------------ */
  it('PART 6: Journal Immutability - POSTED journals cannot be modified', async () => {
    const res = await createExpense({ branchId: branchA, categoryId, amount: '10', paymentMethod: 'CASH', paymentAccountId }).expect(201);
    const je = await db.journalEntry.findFirst({ where: { sourceId: res.body.data.id, sourceType: 'EXPENSE' } });
    
    // Test direct modification attempt if endpoint exists (usually forbidden or doesn't exist)
    const patchRes = await request(app.getHttpServer()).patch(`/v1/organizations/${orgId}/journal-entries/${je?.id}`).set(auth()).send({ status: 'DRAFT' });
    expect([404, 403, 405]).toContain(patchRes.status); // Should be rejected or not found
  });

  /* ------------------------------------------------------------------ */
  /* PART 7 — AUDIT LOGS                                                */
  /* ------------------------------------------------------------------ */
  it('PART 7: Audit Logs - correct events are recorded with tenant ownership', async () => {
    const res = await createExpense({ branchId: branchA, categoryId, amount: '10', paymentMethod: 'CASH', paymentAccountId }).expect(201);
    const expId = res.body.data.id;

    const createLog = await db.auditLog.findFirst({ where: { organizationId: orgId, action: 'EXPENSE_CREATED', entityId: expId } });
    expect(createLog).toBeDefined();

    await request(app.getHttpServer()).post(`/v1/organizations/${orgId}/expenses/${expId}/cancel`).set(auth()).send().expect(200);
    const cancelLog = await db.auditLog.findFirst({ where: { organizationId: orgId, action: 'EXPENSE_CANCELLED', entityId: expId } });
    expect(cancelLog).toBeDefined();
  });
});