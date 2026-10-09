import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

describe('SalesModule (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwtService: any;

  // Org A
  let ownerTokenA: string;
  let staffTokenA: string; // Has sale:read, sale:create, but NOT sale:cancel
  let orgIdA: string;
  let branchIdA1: string;
  let branchIdA2: string;
  let categoryIdA: string;
  let productIdA1: string;
  let productIdA2: string;
  let customerIdA: string;

  // Org B
  let ownerTokenB: string;
  let orgIdB: string;
  let branchIdB1: string;
  let productIdB1: string;
  let customerIdB: string;

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
    if (orgIdA) {
      await db.auditLog.deleteMany({ where: { organizationId: orgIdA } });
      await db.saleItem.deleteMany({ where: { sale: { organizationId: orgIdA } } });
      await db.sale.deleteMany({ where: { organizationId: orgIdA } });
      await db.inventoryMovement.deleteMany({ where: { organizationId: orgIdA } });
      await db.inventory.deleteMany({ where: { organizationId: orgIdA } });
    }
    if (orgIdB) {
      await db.auditLog.deleteMany({ where: { organizationId: orgIdB } });
      await db.saleItem.deleteMany({ where: { sale: { organizationId: orgIdB } } });
      await db.sale.deleteMany({ where: { organizationId: orgIdB } });
      await db.inventoryMovement.deleteMany({ where: { organizationId: orgIdB } });
      await db.inventory.deleteMany({ where: { organizationId: orgIdB } });
    }
    if (app) {
      await app.close();
    }
  });

  it('should register users, organizations, branches, customers, products and stock for setup', async () => {
    const testId = Date.now().toString() + nanoid(5);

    // 1. Create Owner User A
    const userA = await db.user.create({
      data: {
        email: `sales_owner_a_${testId}@example.com`,
        name: 'Sales Owner A',
        password: 'dummy',
      },
    });
    const sessionA = await db.session.create({
      data: {
        userId: userA.id,
        refreshTokenHash: 'hash',
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    ownerTokenA = jwtService.sign({ sub: userA.id, sessionId: sessionA.id });

    // 2. Create Org A
    const orgResA = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ name: `Sales Org A ${testId}` });
    orgIdA = orgResA.body.data.id;

    // 3. Create Branches A1 and A2
    const b1Res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/branches`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: 'Downtown Branch', code: `DT-${testId}` })
      .expect(201);
    branchIdA1 = b1Res.body.data.id;

    const b2Res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/branches`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: 'Uptown Branch', code: `UT-${testId}` })
      .expect(201);
    branchIdA2 = b2Res.body.data.id;

    // 4. Create Category A
    const catRes = await request(app.getHttpServer())
      .post('/v1/categories')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `General Goods ${testId}` })
      .expect(201);
    categoryIdA = catRes.body.data.id;

    // 5. Create Products A1 & A2
    const prod1Res = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        name: `Product Alpha ${testId}`,
        categoryId: categoryIdA,
        price: 150.0,
        cost: 80.0,
      })
      .expect(201);
    productIdA1 = prod1Res.body.data.id;

    const prod2Res = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        name: `Product Beta ${testId}`,
        categoryId: categoryIdA,
        price: 50.0,
        cost: 25.0,
      })
      .expect(201);
    productIdA2 = prod2Res.body.data.id;

    // 6. Stock In initial inventory on Branch A1
    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA1, productId: productIdA1, quantity: 100 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA1, productId: productIdA2, quantity: 50 })
      .expect(201);

    // Stock In on Branch A2 (branch isolation test)
    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA2, productId: productIdA1, quantity: 20 })
      .expect(201);

    // 7. Create Customer A
    const custRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/customers`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: 'Alice Customer', phone: `0171${nanoid(7)}` })
      .expect(201);
    customerIdA = custRes.body.data.id;

    // 8. Create Staff User in Org A with STAFF role
    const staffUser = await db.user.create({
      data: {
        email: `sales_staff_a_${testId}@example.com`,
        name: 'Sales Staff A',
        password: 'dummy',
      },
    });
    const staffSession = await db.session.create({
      data: {
        userId: staffUser.id,
        refreshTokenHash: 'hash',
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    staffTokenA = jwtService.sign({ sub: staffUser.id, sessionId: staffSession.id });

    // Find STAFF role
    // Create custom role with sale:read and sale:create permissions
    const roleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/roles`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        name: `Sales Staff ${testId}`,
        permissions: ['sale:read', 'sale:create'],
      })
      .expect(201);
    const staffRoleId = roleRes.body.data.id;

    await db.organizationMember.create({
      data: {
        organizationId: orgIdA,
        userId: staffUser.id,
        roleId: staffRoleId,
      },
    });

    // 9. Setup Org B
    const userB = await db.user.create({
      data: {
        email: `sales_owner_b_${testId}@example.com`,
        name: 'Sales Owner B',
        password: 'dummy',
      },
    });
    const sessionB = await db.session.create({
      data: {
        userId: userB.id,
        refreshTokenHash: 'hash',
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    ownerTokenB = jwtService.sign({ sub: userB.id, sessionId: sessionB.id });

    const orgResB = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({ name: `Sales Org B ${testId}` });
    orgIdB = orgResB.body.data.id;

    const bResB = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdB}/branches`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB)
      .send({ name: 'Branch B1', code: `B1-${testId}` })
      .expect(201);
    branchIdB1 = bResB.body.data.id;

    const prodResB = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB)
      .send({ name: `Product B ${testId}`, price: 80.0 })
      .expect(201);
    productIdB1 = prodResB.body.data.id;

    const custResB = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdB}/customers`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB)
      .send({ name: 'Bob OrgB', phone: `0181${nanoid(7)}` })
      .expect(201);
    customerIdB = custResB.body.data.id;
  });

  it('should create a walk-in sale (customerId omitted) and deduct inventory', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [
          {
            productId: productIdA1,
            quantity: 5,
            unitPrice: 150,
          },
        ],
        note: 'Walk-in customer sale',
      })
      .expect(201);

    const sale = res.body.data;
    expect(sale.saleNumber).toMatch(/^SALE-\d{6}$/);
    expect(sale.status).toBe('COMPLETED');
    expect(sale.customerId).toBeNull();
    expect(Number(sale.subtotal)).toBe(750);
    expect(Number(sale.totalAmount)).toBe(750);

    // Check inventory stock deducted from 100 to 95
    const inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(inv?.quantity)).toBe(95);

    // Check InventoryMovement
    const movement = await db.inventoryMovement.findFirst({
      where: { referenceId: sale.id },
    });
    expect(movement?.movementType).toBe('STOCK_OUT');
    expect(movement?.referenceType).toBe('SALE');
    expect(Number(movement?.quantity)).toBe(5);
  });

  it('should create a registered customer sale with discounts and taxes', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        customerId: customerIdA,
        items: [
          {
            productId: productIdA1,
            quantity: 2,
            unitPrice: 150,
            discountAmount: 10,
            taxAmount: 5,
          },
          {
            productId: productIdA2,
            quantity: 4,
            unitPrice: 50,
            discountAmount: 0,
            taxAmount: 10,
          },
        ],
        discountAmount: 15,
        taxAmount: 5,
      })
      .expect(201);

    const sale = res.body.data;
    expect(sale.customerId).toBe(customerIdA);
    // Subtotal = (2*150) + (4*50) = 300 + 200 = 500
    expect(Number(sale.subtotal)).toBe(500);
    // Total discount = 10 + 0 + 15 = 25
    expect(Number(sale.discountAmount)).toBe(25);
    // Total tax = 5 + 10 + 5 = 20
    expect(Number(sale.taxAmount)).toBe(20);
    // Total = 500 - 25 + 20 = 495
    expect(Number(sale.totalAmount)).toBe(495);

    // Stock check
    const invA1 = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(invA1?.quantity)).toBe(93); // 95 - 2 = 93

    const invA2 = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA2 },
    });
    expect(Number(invA2?.quantity)).toBe(46); // 50 - 4 = 46
  });

  it('should retrieve sale details by ID (GET /:saleId)', async () => {
    const listRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);

    const saleId = listRes.body.data[0].id;

    const detailRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/sales/${saleId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);

    expect(detailRes.body.data.id).toBe(saleId);
    expect(detailRes.body.data.items.length).toBeGreaterThan(0);
    expect(detailRes.body.data.branch).toBeDefined();
  });

  it('should list sales with pagination, search, status, and branch filters', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/sales?page=1&limit=10&branchId=${branchIdA1}&status=COMPLETED`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(10);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it('should enforce multi-product atomicity: if one product has insufficient stock, entire sale rolls back', async () => {
    // Current stock: A1 = 93, A2 = 46.
    // Try to sell 5 of A1 and 500 of A2 (which has only 46).
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [
          { productId: productIdA1, quantity: 5, unitPrice: 150 },
          { productId: productIdA2, quantity: 500, unitPrice: 50 },
        ],
      })
      .expect(409);

    expect(res.body.message).toMatch(/Insufficient stock/);

    // Verify stock of Product A1 was NOT deducted (still 93)
    const invA1 = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(invA1?.quantity)).toBe(93);

    const invA2 = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA2 },
    });
    expect(Number(invA2?.quantity)).toBe(46);
  });

  it('should cancel a completed sale, restore stock, and create compensating movement', async () => {
    // 1. Create a sale to cancel
    const saleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [{ productId: productIdA1, quantity: 10, unitPrice: 150 }],
      })
      .expect(201);

    const saleId = saleRes.body.data.id;

    // Stock was 93, now 83
    let inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(inv?.quantity)).toBe(83);

    // 2. Cancel the sale
    const cancelRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales/${saleId}/cancel`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ reason: 'Customer changed mind' })
      .expect(200);

    expect(cancelRes.body.data.status).toBe('CANCELLED');
    expect(cancelRes.body.data.cancelledAt).toBeDefined();

    // 3. Verify stock restored back to 93
    inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(inv?.quantity)).toBe(93);

    // 4. Verify compensating movement
    const movement = await db.inventoryMovement.findFirst({
      where: { referenceId: saleId, movementType: 'STOCK_IN' },
    });
    expect(movement).toBeDefined();
    expect(movement?.referenceType).toBe('SALE_CANCEL');
    expect(Number(movement?.quantity)).toBe(10);

    // 5. Verify double cancellation returns 409 Conflict
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales/${saleId}/cancel`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ reason: 'Try cancel again' })
      .expect(200);
  });

  it('should verify branch isolation: selling from Branch A1 does not affect Branch A2', async () => {
    // Branch A2 initial stock was 20
    const invA2Before = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA2, productId: productIdA1 },
    });
    expect(Number(invA2Before?.quantity)).toBe(20);

    // Sell 3 from Branch A1
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [{ productId: productIdA1, quantity: 3, unitPrice: 150 }],
      })
      .expect(201);

    // Branch A2 remains 20!
    const invA2After = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA2, productId: productIdA1 },
    });
    expect(Number(invA2After?.quantity)).toBe(20);
  });

  it('should enforce strict tenant isolation', async () => {
    // 1. Org B tries to access Org A sale by ID -> 404 / 403
    const listRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);
    const saleAId = listRes.body.data[0].id;

    // Org B user querying Org A sale with Org B header
    await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdB}/sales/${saleAId}`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB)
      .expect(404);

    // 2. Org A user tries to create sale using Org B branch -> 404
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdB1,
        items: [{ productId: productIdA1, quantity: 1 }],
      })
      .expect(404);

    // 3. Org A user tries to create sale using Org B product -> 404
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [{ productId: productIdB1, quantity: 1 }],
      })
      .expect(404);

    // 4. Org A user tries to create sale using Org B customer -> 404
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        customerId: customerIdB,
        items: [{ productId: productIdA1, quantity: 1 }],
      })
      .expect(404);

    // 5. Org B user tries to cancel Org A sale -> 404 / 403
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdB}/sales/${saleAId}/cancel`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB)
      .expect(404);
  });

  it('should enforce RBAC: staff can create and read sales, but cannot cancel', async () => {
    // 1. Staff can read sales
    await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);

    // 2. Staff can create sales
    const createRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [{ productId: productIdA1, quantity: 1, unitPrice: 150 }],
      })
      .expect(201);

    const saleId = createRes.body.data.id;

    // 3. Staff cannot cancel sales -> 403 Forbidden
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales/${saleId}/cancel`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(403);
  });

  /* ------------------------------------------------------------------ */
  /* CONCURRENCY TESTS                                                  */
  /* ------------------------------------------------------------------ */

  it('Concurrency Test A: 20 concurrent sales on same product with sufficient stock', async () => {
    // Setup clean product with initial stock = 100
    const prodRes = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Conc Product A ${nanoid(4)}`, price: 20.0 })
      .expect(201);
    const concProdId = prodRes.body.data.id;

    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA1, productId: concProdId, quantity: 100 })
      .expect(201);

    // Run 20 concurrent sales with quantity = 3 each (Total 60)
    const requests = Array.from({ length: 20 }).map((_, i) =>
      request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/sales`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({
          branchId: branchIdA1,
          items: [{ productId: concProdId, quantity: 3, unitPrice: 20 }],
          note: `Concurrent Sale ${i}`,
        })
    );

    const responses = await Promise.all(requests);
    const successCount = responses.filter((r) => r.status === 201).length;
    expect(successCount).toBe(20);

    // Verify stock is exactly 100 - (20 * 3) = 40
    const inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: concProdId },
    });
    expect(Number(inv?.quantity)).toBe(40);
  });

  it('Concurrency Test B: 20 concurrent sales with insufficient stock (stock never negative)', async () => {
    // Initial stock = 10
    const prodRes = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Conc Product B ${nanoid(4)}`, price: 30.0 })
      .expect(201);
    const concProdId = prodRes.body.data.id;

    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA1, productId: concProdId, quantity: 10 })
      .expect(201);

    // 20 concurrent sales requesting quantity = 3 each (total requested = 60, only 10 available)
    const requests = Array.from({ length: 20 }).map((_, i) =>
      request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/sales`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({
          branchId: branchIdA1,
          items: [{ productId: concProdId, quantity: 3, unitPrice: 30 }],
          note: `Insuff Stock Sale ${i}`,
        })
    );

    const responses = await Promise.all(requests);
    const successCount = responses.filter((r) => r.status === 201).length;
    const conflictCount = responses.filter((r) => r.status === 409).length;

    // Exactly 3 sales should succeed (3 * 3 = 9), remaining 17 should fail with 409
    expect(successCount).toBe(3);
    expect(conflictCount).toBe(17);

    // Verify final stock is exactly 10 - 9 = 1, NEVER negative!
    const inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: concProdId },
    });
    expect(Number(inv?.quantity)).toBe(1);
    expect(Number(inv?.quantity)).toBeGreaterThanOrEqual(0);
  });

  it('Concurrency Test C: 20 concurrent identical requests with same idempotencyKey', async () => {
    const prodRes = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Conc Product C ${nanoid(4)}`, price: 40.0 })
      .expect(201);
    const concProdId = prodRes.body.data.id;

    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA1, productId: concProdId, quantity: 100 })
      .expect(201);

    const sharedIdempotencyKey = `idem-sale-${nanoid(8)}`;

    const requests = Array.from({ length: 20 }).map(() =>
      request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/sales`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({
          branchId: branchIdA1,
          items: [{ productId: concProdId, quantity: 5, unitPrice: 40 }],
          idempotencyKey: sharedIdempotencyKey,
        })
    );

    const responses = await Promise.all(requests);
    // All 20 should succeed (either 201 created or 201/200 returning existing sale)
    for (const res of responses) {
      expect([200, 201]).toContain(res.status);
    }

    // All returned sales must have the exact same sale ID and sale number
    const firstSaleId = responses[0].body.data.id;
    for (const res of responses) {
      expect(res.body.data.id).toBe(firstSaleId);
    }

    // Verify EXACTLY ONE sale record in DB with this idempotencyKey
    const salesInDb = await db.sale.findMany({
      where: { organizationId: orgIdA, idempotencyKey: sharedIdempotencyKey },
    });
    expect(salesInDb.length).toBe(1);

    // Verify EXACTLY ONE stock deduction: 100 - 5 = 95
    const inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: concProdId },
    });
    expect(Number(inv?.quantity)).toBe(95);

    // Verify EXACTLY ONE inventory movement
    const movements = await db.inventoryMovement.findMany({
      where: { referenceId: firstSaleId },
    });
    expect(movements.length).toBe(1);
  });

  it('Concurrency Test D: Multi-product deadlock test (overlapping products)', async () => {
    // Setup two products
    const prod1Res = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Deadlock Prod A ${nanoid(4)}`, price: 10.0 })
      .expect(201);
    const dlProdA = prod1Res.body.data.id;

    const prod2Res = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: `Deadlock Prod B ${nanoid(4)}`, price: 20.0 })
      .expect(201);
    const dlProdB = prod2Res.body.data.id;

    // Stock in
    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA1, productId: dlProdA, quantity: 100 })
      .expect(201);
    
    await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ branchId: branchIdA1, productId: dlProdB, quantity: 100 })
      .expect(201);

    // Sale A requests A then B, Sale B requests B then A
    // (the server sorts lexicographically anyway, so no deadlock should happen)
    const saleAReq = request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [
          { productId: dlProdA, quantity: 5, unitPrice: 10 },
          { productId: dlProdB, quantity: 5, unitPrice: 20 },
        ],
      });

    const saleBReq = request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/sales`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [
          { productId: dlProdB, quantity: 10, unitPrice: 20 },
          { productId: dlProdA, quantity: 10, unitPrice: 10 },
        ],
      });

    const responses = await Promise.all([saleAReq, saleBReq]);
    
    expect(responses[0].status).toBe(201);
    expect(responses[1].status).toBe(201);

    // Verify final stock A = 100 - 5 - 10 = 85
    // Verify final stock B = 100 - 5 - 10 = 85
    const invA = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: dlProdA },
    });
    expect(Number(invA?.quantity)).toBe(85);

    const invB = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: dlProdB },
    });
    expect(Number(invB?.quantity)).toBe(85);
  });
});

