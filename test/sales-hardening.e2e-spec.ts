import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

describe('Sales Phase 12 Hardening (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwtService: any;

  let ownerToken: string;
  let orgId: string;
  let branchA: string;
  let branchB: string;
  let categoryId: string;

  // Org B (tenant isolation)
  let ownerTokenB: string;
  let orgIdB: string;
  let branchB1: string;
  let productB1: string;
  let customerB1: string;

  const auth = (token = ownerToken, org = orgId) => ({
    Authorization: `Bearer ${token}`,
    'x-organization-id': org,
  });

  const createProduct = async (name: string, price: number, token = ownerToken, org = orgId) => {
    const res = await request(app.getHttpServer())
      .post('/v1/products')
      .set(auth(token, org))
      .send({ name: `${name} ${nanoid(5)}`, categoryId, sellingPrice: price, purchasePrice: price / 2 })
      .expect(201);
    return res.body.data.id as string;
  };

  const stockIn = async (branchId: string, productId: string, quantity: number, token = ownerToken, org = orgId) => {
    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set(auth(token, org))
      .send({ branchId, productId, quantity })
      .expect(201);
  };

  const stockOf = async (branchId: string, productId: string) => {
    const inv = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId },
    });
    return inv ? Number(inv.quantity) : 0;
  };

  const createSale = (payload: any) =>
    request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales`)
      .set(auth())
      .send(payload);

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

    const owner = await db.user.create({
      data: { email: `hard_owner_${testId}@example.com`, name: 'Hard Owner', password: 'dummy' },
    });
    const session = await db.session.create({
      data: { userId: owner.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
    });
    ownerToken = jwtService.sign({ sub: owner.id, sessionId: session.id });

    const orgRes = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Hard Org ${testId}` });
    orgId = orgRes.body.data.id;

    const catRes = await request(app.getHttpServer())
      .post('/v1/categories')
      .set(auth())
      .send({ name: `Hard Category ${testId}` })
      .expect(201);
    categoryId = catRes.body.data.id;

    const b1 = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/branches`)
      .set(auth())
      .send({ name: 'Hard Branch A', code: `HA-${testId}` })
      .expect(201);
    branchA = b1.body.data.id;

    const b2 = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/branches`)
      .set(auth())
      .send({ name: 'Hard Branch B', code: `HB-${testId}` })
      .expect(201);
    branchB = b2.body.data.id;

    // Org B
    const ownerB = await db.user.create({
      data: { email: `hard_owner_b_${testId}@example.com`, name: 'Hard Owner B', password: 'dummy' },
    });
    const sessionB = await db.session.create({
      data: { userId: ownerB.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
    });
    ownerTokenB = jwtService.sign({ sub: ownerB.id, sessionId: sessionB.id });
    const orgResB = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({ name: `Hard Org B ${testId}` });
    orgIdB = orgResB.body.data.id;
    const bResB = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdB}/branches`)
      .set(auth(ownerTokenB, orgIdB))
      .send({ name: 'Hard Branch B1', code: `HBB-${testId}` })
      .expect(201);
    branchB1 = bResB.body.data.id;
    const prodResB = await request(app.getHttpServer())
      .post('/v1/products')
      .set(auth(ownerTokenB, orgIdB))
      .send({ name: `Hard Product B ${testId}`, price: 80 })
      .expect(201);
    productB1 = prodResB.body.data.id;
    const custResB = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdB}/customers`)
      .set(auth(ownerTokenB, orgIdB))
      .send({ name: 'Hard Bob', phone: `0191${nanoid(7)}` })
      .expect(201);
    customerB1 = custResB.body.data.id;
  });

  afterAll(async () => {
    await dropAllTriggers();
    for (const org of [orgId, orgIdB].filter(Boolean)) {
      await db.auditLog.deleteMany({ where: { organizationId: org } });
      await db.journalEntryLine.deleteMany({ where: { journalEntry: { organizationId: org } } });
      await db.journalEntry.deleteMany({ where: { organizationId: org } });
      await db.saleItem.deleteMany({ where: { sale: { organizationId: org } } });
      await db.sale.deleteMany({ where: { organizationId: org } });
      await db.inventoryMovement.deleteMany({ where: { organizationId: org } });
      await db.inventory.deleteMany({ where: { organizationId: org } });
      await db.product.deleteMany({ where: { organizationId: org } });
      await db.category.deleteMany({ where: { organizationId: org } });
      await db.customer.deleteMany({ where: { organizationId: org } });
      await db.branch.deleteMany({ where: { organizationId: org } });
      await db.organizationMember.deleteMany({ where: { organizationId: org } });
    }
    if (app) await app.close();
  });

  const dropAllTriggers = async () => {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS phase12_fail_sale_audit_trg ON "AuditLog"`).catch(() => {});
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS phase12_fail_cancel_audit_trg ON "AuditLog"`).catch(() => {});
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS phase12_fail_sale_audit()`).catch(() => {});
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS phase12_fail_cancel_audit()`).catch(() => {});
  };

  /* ------------------------------------------------------------------ */
  /* 4. SALE CREATION ROLLBACK                                          */
  /* ------------------------------------------------------------------ */
  it('rolls back the entire sale when a failure occurs after inventory update and before commit', async () => {
    const product = await createProduct('Rollback Sale P', 100);
    await stockIn(branchA, product, 50);

    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION phase12_fail_sale_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'SALE_CREATED' AND NEW."organizationId" = '${orgId}' THEN
          RAISE EXCEPTION 'Simulated failure after inventory update';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER phase12_fail_sale_audit_trg BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION phase12_fail_sale_audit();
    `);

    const saleNumberBefore = await db.sale.count({ where: { organizationId: orgId } });
    try {
      const res = await createSale({
        branchId: branchA,
        items: [{ productId: product, quantity: 5, unitPrice: 100 }],
      });
      expect(res.status).toBe(500);
    } finally {
      await dropAllTriggers();
    }

    // Sale / SaleItem / Movement / AuditLog absent
    expect(await db.sale.count({ where: { organizationId: orgId } })).toBe(saleNumberBefore);
    expect(
      await db.saleItem.count({ where: { sale: { organizationId: orgId }, productId: product } })
    ).toBe(0);
    expect(await db.inventoryMovement.count({ where: { organizationId: orgId, productId: product, movementType: 'STOCK_OUT' } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { organizationId: orgId, action: 'SALE_CREATED', entityId: { in: (await db.sale.findMany({ where: { organizationId: orgId }, select: { id: true } })).map((s) => s.id) } } })
    ).toBe(0);
    // Inventory unchanged
    expect(await stockOf(branchA, product)).toBe(50);
  });

  /* ------------------------------------------------------------------ */
  /* 5. CANCELLATION ROLLBACK                                           */
  /* ------------------------------------------------------------------ */
  it('rolls back cancellation when a failure occurs before commit', async () => {
    const product = await createProduct('Rollback Cancel P', 100);
    await stockIn(branchA, product, 30);

    const saleRes = await createSale({
      branchId: branchA,
      items: [{ productId: product, quantity: 4, unitPrice: 100 }],
    }).expect(201);
    const saleId = saleRes.body.data.id;
    expect(await stockOf(branchA, product)).toBe(26);

    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION phase12_fail_cancel_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'SALE_CANCELLED' AND NEW."organizationId" = '${orgId}' THEN
          RAISE EXCEPTION 'Simulated failure during cancellation';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER phase12_fail_cancel_audit_trg BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION phase12_fail_cancel_audit();
    `);

    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales/${saleId}/cancel`)
      .set(auth())
      .send({ reason: 'should roll back' });
    expect(res.status).toBe(500);

    await dropAllTriggers();

    const sale = await db.sale.findUnique({ where: { id: saleId } });
    expect(sale?.status).toBe('COMPLETED');
    expect(sale?.cancelledAt).toBeNull();
    expect(sale?.cancelledBy).toBeNull();
    expect(await stockOf(branchA, product)).toBe(26);
    expect(
      await db.inventoryMovement.count({ where: { organizationId: orgId, referenceId: saleId, movementType: 'STOCK_IN' } })
    ).toBe(0);
    expect(
      await db.auditLog.count({ where: { organizationId: orgId, action: 'SALE_CANCELLED', entityId: saleId } })
    ).toBe(0);
  });

  /* ------------------------------------------------------------------ */
  /* 6. CANCELLATION MOVEMENT IMMUTABILITY                              */
  /* ------------------------------------------------------------------ */
  it('does not mutate the original STOCK_OUT movement on cancellation', async () => {
    const product = await createProduct('Immutable Movement P', 100);
    await stockIn(branchA, product, 20);

    const saleRes = await createSale({
      branchId: branchA,
      items: [{ productId: product, quantity: 6, unitPrice: 100 }],
    }).expect(201);
    const saleId = saleRes.body.data.id;

    const original = await db.inventoryMovement.findFirst({
      where: { organizationId: orgId, referenceId: saleId, movementType: 'STOCK_OUT' },
    });
    expect(original).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales/${saleId}/cancel`)
      .set(auth())
      .send({ reason: 'immutability check' })
      .expect(200);

    const after = await db.inventoryMovement.findUnique({ where: { id: original!.id } });
    expect(after?.movementType).toBe('STOCK_OUT');
    expect(Number(after?.quantity)).toBe(6);
    expect(Number(after?.beforeQuantity)).toBe(20);
    expect(Number(after?.afterQuantity)).toBe(14);
    expect(after?.referenceType).toBe('SALE');

    const compensating = await db.inventoryMovement.findMany({
      where: { organizationId: orgId, referenceId: saleId, movementType: 'STOCK_IN' },
    });
    expect(compensating.length).toBe(1);
    expect(compensating[0].referenceType).toBe('SALE_CANCEL');
  });

  /* ------------------------------------------------------------------ */
  /* 7. IDEMPOTENCY                                                      */
  /* ------------------------------------------------------------------ */
  it('same idempotency key + different payload => 409, even concurrently', async () => {
    const product = await createProduct('Idem Conflict P', 100);
    await stockIn(branchA, product, 100);
    const key = `hard-idem-${nanoid(8)}`;

    const responses = await Promise.all([
      createSale({ branchId: branchA, items: [{ productId: product, quantity: 1, unitPrice: 100 }], idempotencyKey: key }),
      createSale({ branchId: branchA, items: [{ productId: product, quantity: 2, unitPrice: 100 }], idempotencyKey: key }),
      createSale({ branchId: branchA, items: [{ productId: product, quantity: 3, unitPrice: 100 }], idempotencyKey: key }),
    ]);

    const success = responses.filter((r) => r.status === 201);
    const conflict = responses.filter((r) => r.status === 409);
    expect(success.length).toBe(1);
    expect(conflict.length).toBe(2);

    const sales = await db.sale.findMany({ where: { organizationId: orgId, idempotencyKey: key } });
    expect(sales.length).toBe(1);
    const movements = await db.inventoryMovement.findMany({ where: { organizationId: orgId, referenceId: sales[0].id } });
    expect(movements.length).toBe(1);
    expect(
      await db.auditLog.count({ where: { organizationId: orgId, action: 'SALE_CREATED', entityId: sales[0].id } })
    ).toBe(1);
  });

  /* ------------------------------------------------------------------ */
  /* 8. SALE NUMBER CONCURRENCY                                         */
  /* ------------------------------------------------------------------ */
  it('generates unique sale numbers for 10 concurrent independent sales', async () => {
    const products = await Promise.all(
      Array.from({ length: 10 }).map((_, i) => createProduct(`SaleNum P${i}`, 10))
    );
    await Promise.all(products.map((p) => stockIn(branchA, p, 5)));

    const responses = await Promise.all(
      products.map((p) => createSale({ branchId: branchA, items: [{ productId: p, quantity: 1, unitPrice: 10 }] }))
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);

    const numbers = responses.map((r) => r.body.data.saleNumber);
    expect(new Set(numbers).size).toBe(10);
    for (const n of numbers) expect(n).toMatch(/^SALE-\d{6,}$/);
  });

  /* ------------------------------------------------------------------ */
  /* 9. MULTI-PRODUCT DEADLOCK                                          */
  /* ------------------------------------------------------------------ */
  it('handles overlapping multi-product sales without deadlock or lost stock', async () => {
    const pA = await createProduct('Deadlock A', 10);
    const pB = await createProduct('Deadlock B', 10);
    await stockIn(branchA, pA, 1000);
    await stockIn(branchA, pB, 1000);

    const saleA = () =>
      createSale({
        branchId: branchA,
        items: [
          { productId: pA, quantity: 3, unitPrice: 10 },
          { productId: pB, quantity: 3, unitPrice: 10 },
        ],
      });
    const saleB = () =>
      createSale({
        branchId: branchA,
        items: [
          { productId: pB, quantity: 3, unitPrice: 10 },
          { productId: pA, quantity: 3, unitPrice: 10 },
        ],
      });

    const requests = Array.from({ length: 10 }).map((_, i) => (i % 2 === 0 ? saleA() : saleB()));
    const responses = await Promise.all(requests);
    expect(responses.every((r) => r.status === 201)).toBe(true);

    // 5 sales of each ordering => 10 sales total. Each sale has 3 units of pA and 3 units of pB. Total = 30 units of each.
    expect(await stockOf(branchA, pA)).toBe(970);
    expect(await stockOf(branchA, pB)).toBe(970);
  });

  /* ------------------------------------------------------------------ */
  /* 10. MONEY CALCULATION                                              */
  /* ------------------------------------------------------------------ */
  it('calculates money server-side with Decimal and ignores client totals', async () => {
    const p1 = await createProduct('Money P1', 150.5);
    const p2 = await createProduct('Money P2', 33.3333);
    await stockIn(branchA, p1, 100);
    await stockIn(branchA, p2, 100);

    const res = await createSale({
      branchId: branchA,
      items: [
        { productId: p1, quantity: 2, unitPrice: 150.5, discountAmount: 10.25, taxAmount: 5.5 },
        { productId: p2, quantity: 3, unitPrice: 33.3333, discountAmount: 0, taxAmount: 0 },
      ],
      discountAmount: 5,
      taxAmount: 2.25,
      totalAmount: 1, // ignored by server
      subtotal: 1, // ignored by server
    }).expect(201);

    const sale = res.body.data;
    // subtotal = 2*150.5 + 3*33.3333 = 301 + 99.9999 = 400.9999
    expect(Number(sale.subtotal)).toBeCloseTo(400.9999, 4);
    // discount = 10.25 + 0 + 5 = 15.25
    expect(Number(sale.discountAmount)).toBeCloseTo(15.25, 4);
    // tax = 5.5 + 0 + 2.25 = 7.75
    expect(Number(sale.taxAmount)).toBeCloseTo(7.75, 4);
    // total = 400.9999 - 15.25 + 7.75 = 393.4999
    expect(Number(sale.totalAmount)).toBeCloseTo(393.4999, 4);

    // lineTotal for item1 = 301 - 10.25 + 5.5 = 296.25
    const item1 = sale.items.find((i: any) => i.productId === p1);
    expect(Number(item1.lineTotal)).toBeCloseTo(296.25, 4);
  });

  it('uses canonical product selling price when unitPrice is omitted', async () => {
    const p = await createProduct('Canonical Price P', 77.5);
    await stockIn(branchA, p, 10);

    const res = await createSale({
      branchId: branchA,
      items: [{ productId: p, quantity: 2 }],
    }).expect(201);

    expect(Number(res.body.data.items[0].unitPrice)).toBeCloseTo(77.5, 4);
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(155, 4);
  });

  /* ------------------------------------------------------------------ */
  /* 11. DUPLICATE PRODUCT                                              */
  /* ------------------------------------------------------------------ */
  it('rejects duplicate products with 400, not an uncontrolled DB error', async () => {
    const p = await createProduct('Dup P', 10);
    await stockIn(branchA, p, 100);

    const res = await createSale({
      branchId: branchA,
      items: [
        { productId: p, quantity: 2, unitPrice: 10 },
        { productId: p, quantity: 3, unitPrice: 10 },
      ],
    });
    expect(res.status).toBe(400);
    expect(await stockOf(branchA, p)).toBe(100);
  });

  /* ------------------------------------------------------------------ */
  /* 12. CUSTOMER ISOLATION                                             */
  /* ------------------------------------------------------------------ */
  it('supports walk-in and registered customers, rejects inactive and cross-tenant customers', async () => {
    const p = await createProduct('Customer Iso P', 10);
    await stockIn(branchA, p, 100);

    // walk-in
    await createSale({ branchId: branchA, items: [{ productId: p, quantity: 1, unitPrice: 10 }] }).expect(201);

    const custRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/customers`)
      .set(auth())
      .send({ name: 'Hard Alice', phone: `0171${nanoid(7)}` })
      .expect(201);
    const customerId = custRes.body.data.id;

    // registered
    const reg = await createSale({ branchId: branchA, customerId, items: [{ productId: p, quantity: 1, unitPrice: 10 }] }).expect(201);
    expect(reg.body.data.customerId).toBe(customerId);

    // inactive customer
    await db.customer.update({ where: { id: customerId }, data: { status: 'INACTIVE' } });
    await createSale({ branchId: branchA, customerId, items: [{ productId: p, quantity: 1, unitPrice: 10 }] }).expect(409);

    // cross-tenant customer
    await createSale({ branchId: branchA, customerId: customerB1, items: [{ productId: p, quantity: 1, unitPrice: 10 }] }).expect(404);
  });

  /* ------------------------------------------------------------------ */
  /* 13. PRODUCT / BRANCH VALIDATION                                    */
  /* ------------------------------------------------------------------ */
  it('rejects cross-tenant branch and product combinations', async () => {
    const pA = await createProduct('Tenant Valid A', 10);
    await stockIn(branchA, pA, 10);

    // Org A branch + Org B product
    await createSale({ branchId: branchA, items: [{ productId: productB1, quantity: 1 }] }).expect(404);
    // Org B branch used with Org A token
    await createSale({ branchId: branchB1, items: [{ productId: pA, quantity: 1 }] }).expect(404);
    // Org B branch + Org B product under Org A header (branch not in org A)
    await createSale({ branchId: branchB1, items: [{ productId: productB1, quantity: 1 }] }).expect(404);
  });

  /* ------------------------------------------------------------------ */
  /* 14. BRANCH STOCK ISOLATION                                         */
  /* ------------------------------------------------------------------ */
  it('isolates stock per branch and movement records are branch-specific', async () => {
    const p = await createProduct('Branch Iso P', 10);
    await stockIn(branchA, p, 10);
    await stockIn(branchB, p, 20);

    const saleRes = await createSale({ branchId: branchA, items: [{ productId: p, quantity: 3, unitPrice: 10 }] }).expect(201);
    const saleId = saleRes.body.data.id;

    expect(await stockOf(branchA, p)).toBe(7);
    expect(await stockOf(branchB, p)).toBe(20);

    const movements = await db.inventoryMovement.findMany({ where: { referenceId: saleId } });
    expect(movements.every((m) => m.branchId === branchA)).toBe(true);

    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/sales/${saleId}/cancel`)
      .set(auth())
      .send({})
      .expect(200);
    expect(await stockOf(branchA, p)).toBe(10);
    expect(await stockOf(branchB, p)).toBe(20);
  });

  /* ------------------------------------------------------------------ */
  /* 17. HISTORY IMMUTABILITY                                           */
  /* ------------------------------------------------------------------ */
  it('exposes no route to mutate a completed sale', async () => {
    const p = await createProduct('Immutable P', 10);
    await stockIn(branchA, p, 10);
    const saleRes = await createSale({ branchId: branchA, items: [{ productId: p, quantity: 1, unitPrice: 10 }] }).expect(201);
    const saleId = saleRes.body.data.id;

    for (const method of ['patch', 'put', 'delete'] as const) {
      const res = await (request(app.getHttpServer()) as any)[method](
        `/v1/organizations/${orgId}/sales/${saleId}`
      )
        .set(auth())
        .send({ quantity: 999, totalAmount: 0 });
      expect([404, 405]).toContain(res.status);
    }
  });

  /* ------------------------------------------------------------------ */
  /* 18. LIST / FILTER / SORT ALLOWLIST                                 */
  /* ------------------------------------------------------------------ */
  it('rejects unknown sort fields with 400 instead of an uncontrolled error', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/sales?sortBy=password&sortOrder=desc`)
      .set(auth());
    expect(res.status).toBe(400);
  });

  it('supports pagination, search, filters and safe sorting', async () => {
    const list = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/sales?page=1&limit=5&sortBy=totalAmount&sortOrder=asc&status=COMPLETED`)
      .set(auth())
      .expect(200);
    expect(list.body.data.length).toBeLessThanOrEqual(5);
    expect(list.body.meta.page).toBe(1);
    expect(list.body.meta.limit).toBe(5);

    const bad = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgId}/sales?dateFrom=not-a-date`)
      .set(auth());
    expect(bad.status).toBe(400);
  });

  /* ------------------------------------------------------------------ */
  /* 19/20. CANCELLATION RULES + IDEMPOTENT CONCURRENT CANCELLATION     */
  /* ------------------------------------------------------------------ */
  it('restores stock exactly once for 10 concurrent cancellations sharing one cancellation key', async () => {
    const p = await createProduct('Concurrent Cancel P', 10);
    await stockIn(branchA, p, 100);
    const saleRes = await createSale({ branchId: branchA, items: [{ productId: p, quantity: 7, unitPrice: 10 }] }).expect(201);
    const saleId = saleRes.body.data.id;
    expect(await stockOf(branchA, p)).toBe(93);

    const key = `hard-cancel-${nanoid(8)}`;
    const responses = await Promise.all(
      Array.from({ length: 10 }).map(() =>
        request(app.getHttpServer())
          .post(`/v1/organizations/${orgId}/sales/${saleId}/cancel`)
          .set(auth())
          .send({ reason: 'concurrent', idempotencyKey: key })
      )
    );

    // Every request must resolve successfully (idempotent success), never 5xx.
    for (const r of responses) {
      expect([200]).toContain(r.status);
    }

    expect(await stockOf(branchA, p)).toBe(100);
    const movements = await db.inventoryMovement.findMany({
      where: { organizationId: orgId, referenceId: saleId, movementType: 'STOCK_IN' },
    });
    expect(movements.length).toBe(1);
    expect(
      await db.auditLog.count({ where: { organizationId: orgId, action: 'SALE_CANCELLED', entityId: saleId } })
    ).toBe(1);

    const sale = await db.sale.findUnique({ where: { id: saleId } });
    expect(sale?.status).toBe('CANCELLED');
    expect(sale?.cancelledAt).toBeTruthy();
    expect(sale?.cancelledBy).toBeTruthy();
  });
});