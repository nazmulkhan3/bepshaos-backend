import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

describe('ExpensesModule (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwtService: any;

  // Org A
  let ownerTokenA: string;
  let staffTokenA: string; // Has expense:read, expense:create, but NOT expense:cancel
  let orgIdA: string;
  let branchIdA: string;
  let expenseAccountIdA: string;
  let paymentAccountIdA: string;
  let categoryIdA: string;
  let expenseIdA: string;

  // Org B
  let ownerTokenB: string;
  let orgIdB: string;
  let branchIdB: string;
  let expenseAccountIdB: string;
  let categoryIdB: string;
  let expenseIdB: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.enableVersioning({
      type: VersioningType.URI,
      prefix: 'v',
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

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
      await db.expense.deleteMany({ where: { organizationId: orgId } });
      await db.expenseCategory.deleteMany({ where: { organizationId: orgId } });
      await db.account.deleteMany({ where: { organizationId: orgId, isSystem: false } });
    }
    if (app) await app.close();
  });

  it('should register users, organizations, branches, and accounts for setup', async () => {
    const testId = nanoid(5);

    // 1. Create Owner User A
    const userA = await db.user.create({
      data: { email: `expense_owner_a_${testId}@example.com`, name: 'Expense Owner A', password: 'dummy' },
    });
    const sessionA = await db.session.create({
      data: { userId: userA.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
    });
    ownerTokenA = jwtService.sign({ sub: userA.id, sessionId: sessionA.id });

    // 2. Create Org A
    const orgResA = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ name: `Expense Org A ${testId}` });
    orgIdA = orgResA.body.data.id;

    // 3. Create Branch A
    const b1Res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/branches`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: 'Expense Branch A', code: `EX-${testId}` });
    branchIdA = b1Res.body.data.id;

    // 4. Setup Accounts A
    const accountsA = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/ledger/accounts`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA);
    
    expenseAccountIdA = accountsA.body.data.find((a: any) => a.code === '5000').id;
    paymentAccountIdA = accountsA.body.data.find((a: any) => a.code === '1000').id;

    // 5. Create Staff User in Org A
    const staffUser = await db.user.create({
      data: { email: `expense_staff_a_${testId}@example.com`, name: 'Expense Staff A', password: 'dummy' },
    });
    const staffSession = await db.session.create({
      data: { userId: staffUser.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
    });
    staffTokenA = jwtService.sign({ sub: staffUser.id, sessionId: staffSession.id });

    const roleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/roles`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        name: `Expense Staff ${testId}`,
        permissions: ['expense:read', 'expense:create', 'expense-category:read'],
      });
    const staffRoleId = roleRes.body.data.id;

    await db.organizationMember.create({
      data: { organizationId: orgIdA, userId: staffUser.id, roleId: staffRoleId },
    });

    // 6. Setup Org B
    const userB = await db.user.create({
      data: { email: `expense_owner_b_${testId}@example.com`, name: 'Expense Owner B', password: 'dummy' },
    });
    const sessionB = await db.session.create({
      data: { userId: userB.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
    });
    ownerTokenB = jwtService.sign({ sub: userB.id, sessionId: sessionB.id });

    const orgResB = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({ name: `Expense Org B ${testId}` });
    orgIdB = orgResB.body.data.id;

    const bResB = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdB}/branches`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB)
      .send({ name: 'Branch B', code: `EXB-${testId}` });
    branchIdB = bResB.body.data.id;

    const accountsB = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdB}/ledger/accounts`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB);
    expenseAccountIdB = accountsB.body.data.find((a: any) => a.code === '5000').id;
  });

  describe('Authentication & RBAC', () => {
    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer()).get(`/v1/organizations/${orgIdA}/expenses`).expect(401);
    });

    it('should reject unauthorized category creation (staff)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/expenses/categories`)
        .set('Authorization', `Bearer ${staffTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({ name: 'Test', code: 'T', expenseAccountId: expenseAccountIdA })
        .expect(403);
    });

    it('should reject unauthorized expense cancellation (staff)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/expenses/dummy/cancel`)
        .set('Authorization', `Bearer ${staffTokenA}`)
        .set('x-organization-id', orgIdA)
        .expect(403);
    });
  });

  describe('Categories', () => {
    it('should reject creating category with non-expense account', async () => {
      await request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/expenses/categories`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({ name: 'Bad Cat', code: 'BAD', expenseAccountId: paymentAccountIdA })
        .expect(400);
    });

    it('should create category', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/expenses/categories`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({ name: 'Office Supplies', code: 'OFFICE', expenseAccountId: expenseAccountIdA })
        .expect(201);
      categoryIdA = res.body.data.id;
      expect(res.body.data.name).toBe('Office Supplies');
    });

    it('should reject duplicate category code', async () => {
      await request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/expenses/categories`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({ name: 'Office Supplies 2', code: 'OFFICE', expenseAccountId: expenseAccountIdA })
        .expect(409);
    });

    it('should list categories', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/organizations/${orgIdA}/expenses/categories`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .expect(200);
      expect(res.body.data.length).toBe(1);
    });

    it('should update category', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/organizations/${orgIdB}/expenses/categories/${categoryIdA}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({ name: 'Office & General Supplies' })
        .expect(200);
      expect(res.body.data.name).toBe('Office & General Supplies');
    });

    it('should reject cross-tenant category update', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/organizations/${orgIdB}/expenses/categories/${categoryIdA}`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .set('x-organization-id', orgIdB)
        .send({ name: 'Hacked' })
        .expect(404);
    });
  });

  describe('Expenses Creation & Ledger', () => {
    it('should reject creation with inactive category', async () => {
      await db.expenseCategory.update({ where: { id: categoryIdA }, data: { isActive: false } });
      await request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/expenses`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({
          branchId: branchIdA,
          categoryId: categoryIdA,
          amount: '100.50',
          paymentMethod: 'CASH',
          paymentAccountId: paymentAccountIdA,
        })
        .expect(400);
      await db.expenseCategory.update({ where: { id: categoryIdA }, data: { isActive: true } });
    });

    it('should create expense successfully', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/expenses`)
        .set('Authorization', `Bearer ${staffTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({
          branchId: branchIdA,
          categoryId: categoryIdA,
          amount: '100.50',
          paymentMethod: 'CASH',
          paymentAccountId: paymentAccountIdA,
          note: 'Pens and paper',
          idempotencyKey: 'test-idem-' + Date.now(),
        })
        .expect(201);
      
      const expense = res.body.data;
      expenseIdA = expense.id;
      expect(expense.expenseNumber).toMatch(/^EXP-\d+$/);
      expect(expense.status).toBe('COMPLETED');
      expect(Number(expense.amount)).toBe(100.50);
      expect(expense.branchId).toBe(branchIdA);
      expect(expense.categoryId).toBe(categoryIdA);
    });

    it('should have created balanced journal entries', async () => {
      const jeRes = await request(app.getHttpServer())
        .get(`/v1/organizations/${orgIdA}/journal-entries?sourceType=EXPENSE&sourceId=${expenseIdA}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .expect(200);

      expect(jeRes.body.data.entries.length).toBe(1);
      const je = jeRes.body.data.entries[0];
      expect(je.status).toBe('POSTED');
      
      const debitLine = je.lines.find((l: any) => l.accountId === expenseAccountIdA);
      const creditLine = je.lines.find((l: any) => l.accountId === paymentAccountIdA);
      
      expect(debitLine).toBeDefined();
      expect(creditLine).toBeDefined();
      expect(Number(debitLine.debit)).toBe(100.50);
      expect(Number(creditLine.credit)).toBe(100.50);
      expect(Number(debitLine.credit)).toBe(0);
      expect(Number(creditLine.debit)).toBe(0);
    });

    it('should list expenses with filters', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/organizations/${orgIdA}/expenses?page=1&limit=10&branchId=${branchIdA}&categoryId=${categoryIdA}&status=COMPLETED`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .expect(200);

      expect(res.body.data.expenses.length).toBe(1);
      expect(res.body.data.total).toBe(1);
    });

    it('should reject cross-tenant expense detail read', async () => {
      await request(app.getHttpServer())
        .get(`/v1/organizations/${orgIdB}/expenses/${expenseIdA}`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .set('x-organization-id', orgIdB)
        .expect(404);
    });
  });

  describe('Cancellation', () => {
    it('should cancel expense and create reversal journal', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/expenses/${expenseIdA}/cancel`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .expect(200);
      
      expect(res.body.data.status).toBe('CANCELLED');

      const jeRes = await request(app.getHttpServer())
        .get(`/v1/organizations/${orgIdA}/journal-entries?sourceId=${expenseIdA}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .expect(200);

      // Should have 1 journal for the original expense
      expect(jeRes.body.data.entries.length).toBe(1);
      
      const original = jeRes.body.data.entries[0];
      
      expect(original).toBeDefined();
      expect(original.status).toBe('REVERSED'); // Original is reversed
      expect(original.reversedById).toBeDefined();

      const revRes = await request(app.getHttpServer())
        .get(`/v1/organizations/${orgIdA}/journal-entries/${original.reversedById}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .expect(200);

      const reversal = revRes.body.data;
      
      expect(reversal).toBeDefined();
      expect(reversal.status).toBe('POSTED');

      // Reversal lines: Debit Payment, Credit Expense
      const revDebit = reversal.lines.find((l: any) => l.accountId === paymentAccountIdA);
      const revCredit = reversal.lines.find((l: any) => l.accountId === expenseAccountIdA);
      
      expect(Number(revDebit.debit)).toBe(100.50);
      expect(Number(revCredit.credit)).toBe(100.50);
    });
  });
});
