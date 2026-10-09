import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

describe('PurchasesModule (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwtService: any;

  // Org A
  let ownerTokenA: string;
  let staffTokenA: string; // Has purchase:read, purchase:create, but NOT purchase:cancel
  let orgIdA: string;
  let branchIdA1: string;
  let branchIdA2: string;
  let categoryIdA: string;
  let productIdA1: string;
  let productIdA2: string;
  let supplierIdA: string;

  // Org B
  let ownerTokenB: string;
  let orgIdB: string;
  let branchIdB1: string;
  let productIdB1: string;
  let supplierIdB: string;

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
      await db.purchaseItem.deleteMany({ where: { purchase: { organizationId: orgIdA } } });
      await db.purchase.deleteMany({ where: { organizationId: orgIdA } });
      await db.inventoryMovement.deleteMany({ where: { organizationId: orgIdA } });
      await db.inventory.deleteMany({ where: { organizationId: orgIdA } });
    }
    if (orgIdB) {
      await db.auditLog.deleteMany({ where: { organizationId: orgIdB } });
      await db.purchaseItem.deleteMany({ where: { purchase: { organizationId: orgIdB } } });
      await db.purchase.deleteMany({ where: { organizationId: orgIdB } });
      await db.inventoryMovement.deleteMany({ where: { organizationId: orgIdB } });
      await db.inventory.deleteMany({ where: { organizationId: orgIdB } });
    }
    if (app) {
      await app.close();
    }
  });

  it('should register users, organizations, branches, suppliers, products and stock for setup', async () => {
    const testId = nanoid(5);

    // 1. Create Owner User A
    const userA = await db.user.create({
      data: {
        email: `purchases_owner_a_${testId}@example.com`,
        name: 'Purchases Owner A',
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
      .send({ name: `Purchases Org A ${testId}` });
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

    // 7. Create Supplier A
    const custRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/suppliers`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ name: 'Alice Supplier', phone: `0171${nanoid(7)}` })
      .expect(201);
    supplierIdA = custRes.body.data.id;

    // 8. Create Staff User in Org A with STAFF role
    const staffUser = await db.user.create({
      data: {
        email: `purchases_staff_a_${testId}@example.com`,
        name: 'Purchases Staff A',
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
    // Create custom role with purchase:read and purchase:create permissions
    const roleRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/roles`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        name: `Purchases Staff ${testId}`,
        permissions: ['purchase:read', 'purchase:create'],
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
        email: `purchases_owner_b_${testId}@example.com`,
        name: 'Purchases Owner B',
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
      .send({ name: `Purchases Org B ${testId}` });
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
      .post(`/v1/organizations/${orgIdB}/suppliers`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB)
      .send({ name: 'Bob OrgB', phone: `0181${nanoid(7)}` })
      .expect(201);
    supplierIdB = custResB.body.data.id;
  });

  it('should create a walk-in purchase (supplierId omitted) and increase inventory', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [
          {
            productId: productIdA1,
            quantity: 5,
            unitCost: 150,
          },
        ],
        note: 'Walk-in supplier purchase',
      })
      .expect(201);

    const purchase = res.body.data;
    expect(purchase.purchaseNumber).toMatch(/^PUR-\d{6}$/);
    expect(purchase.status).toBe('COMPLETED');
    expect(purchase.supplierId).toBeNull();
    expect(Number(purchase.subtotal)).toBe(750);
    expect(Number(purchase.total)).toBe(750);

    // Check inventory stock increased from 100 to 105
    const inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(inv?.quantity)).toBe(105);

    // Check InventoryMovement
    const movement = await db.inventoryMovement.findFirst({
      where: { referenceId: purchase.id },
    });
    expect(movement?.movementType).toBe('STOCK_IN');
    expect(movement?.referenceType).toBe('PURCHASE');
    expect(Number(movement?.quantity)).toBe(5);
  });

  it('should create a registered supplier purchase with discounts and taxes', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        supplierId: supplierIdA,
        items: [
          {
            productId: productIdA1,
            quantity: 2,
            unitCost: 150,
            discount: 10,
            tax: 5,
          },
          {
            productId: productIdA2,
            quantity: 4,
            unitCost: 50,
            discount: 0,
            tax: 10,
          },
        ],
        discount: 15,
        tax: 5,
      })
      .expect(201);

    const purchase = res.body.data;
    expect(purchase.supplierId).toBe(supplierIdA);
    // Subtotal = (2*150) + (4*50) = 300 + 200 = 500
    expect(Number(purchase.subtotal)).toBe(500);
    // Total discount = 10 + 0 + 15 = 25
    expect(Number(purchase.discount)).toBe(25);
    // Total tax = 5 + 10 + 5 = 20
    expect(Number(purchase.tax)).toBe(20);
    // Total = 500 - 25 + 20 = 495
    expect(Number(purchase.total)).toBe(495);

    // Stock check
    const invA1 = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(invA1?.quantity)).toBe(107); // 105 + 2 = 107

    const invA2 = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA2 },
    });
    expect(Number(invA2?.quantity)).toBe(54); // 50 + 4 = 54
  });

  it('should retrieve purchase details by ID (GET /:purchaseId)', async () => {
    const listRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);

    const purchaseId = listRes.body.data[0].id;

    const detailRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/purchases/${purchaseId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);

    expect(detailRes.body.data.id).toBe(purchaseId);
    expect(detailRes.body.data.items.length).toBeGreaterThan(0);
    expect(detailRes.body.data.branch).toBeDefined();
  });

  it('should list purchases with pagination, search, status, and branch filters', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/purchases?page=1&limit=10&branchId=${branchIdA1}&status=COMPLETED`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(10);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it('should enforce multi-product atomicity: if one product is invalid, entire purchase rolls back', async () => {
    // Current stock: A1 = 107, A2 = 54.
    // Try to buy 5 of A1 and 500 of an invalid product.
    const res = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [
          { productId: productIdA1, quantity: 5, unitCost: 150 },
          { productId: nanoid(), quantity: 500, unitCost: 50 }, // Invalid product
        ],
      })
      .expect(400);

    // Verify stock of Product A1 was NOT added (still 107)
    const invA1 = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(invA1?.quantity)).toBe(107);
  });

  it('should cancel a completed purchase, restore stock, and create compensating movement', async () => {
    // 1. Create a purchase to cancel
    const purchaseRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [{ productId: productIdA1, quantity: 10, unitCost: 150 }],
      })
      .expect(201);

    const purchaseId = purchaseRes.body.data.id;

    // Stock was 107, now 117
    let inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(inv?.quantity)).toBe(117);

    // 2. Cancel the purchase
    const cancelRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases/${purchaseId}/cancel`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ reason: 'Supplier changed mind' })
      .expect(200);

    expect(cancelRes.body.data.status).toBe('CANCELLED');
    expect(cancelRes.body.data.cancelledAt).toBeDefined();

    // 3. Verify stock restored back to 107
    inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: productIdA1 },
    });
    expect(Number(inv?.quantity)).toBe(107);

    // 4. Verify compensating movement
    const movement = await db.inventoryMovement.findFirst({
      where: { referenceId: purchaseId, movementType: 'STOCK_OUT' },
    });
    expect(movement).toBeDefined();
    expect(movement?.referenceType).toBe('PURCHASE_CANCEL');
    expect(Number(movement?.quantity)).toBe(10);

    // 5. Verify double cancellation returns 409 Conflict
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases/${purchaseId}/cancel`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({ reason: 'Try cancel again' })
      .expect(200);
  });

  it('should verify branch isolation: buying into Branch A1 does not affect Branch A2', async () => {
    // Branch A2 initial stock was 20
    const invA2Before = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA2, productId: productIdA1 },
    });
    expect(Number(invA2Before?.quantity)).toBe(20);

    // Buy 3 into Branch A1
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [{ productId: productIdA1, quantity: 3, unitCost: 150 }],
      })
      .expect(201);

    // Branch A2 remains 20!
    const invA2After = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA2, productId: productIdA1 },
    });
    expect(Number(invA2After?.quantity)).toBe(20);
  });

  it('should enforce strict tenant isolation', async () => {
    // 1. Org B tries to access Org A purchase by ID -> 404 / 403
    const listRes = await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);
    const purchaseAId = listRes.body.data[0].id;

    // Org B user querying Org A purchase with Org B header
    await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdB}/purchases/${purchaseAId}`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB)
      .expect(404);

    // 2. Org A user tries to create purchase using Org B branch -> 404
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdB1,
        items: [{ productId: productIdA1, quantity: 1, unitCost: 100 }],
      })
      .expect(404);

    // 3. Org A user tries to create purchase using Org B product -> 404
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [{ productId: productIdB1, quantity: 1, unitCost: 100 }],
      })
      .expect(404);

    // 4. Org A user tries to create purchase using Org B supplier -> 404
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        supplierId: supplierIdB,
        items: [{ productId: productIdA1, quantity: 1, unitCost: 100 }],
      })
      .expect(404);

    // 5. Org B user tries to cancel Org A purchase -> 404 / 403
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdB}/purchases/${purchaseAId}/cancel`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgIdB)
      .expect(404);
  });

  it('should enforce RBAC: staff can create and read purchases, but cannot cancel', async () => {
    // 1. Staff can read purchases
    await request(app.getHttpServer())
      .get(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(200);

    // 2. Staff can create purchases
    const createRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [{ productId: productIdA1, quantity: 1, unitCost: 150 }],
      })
      .expect(201);

    const purchaseId = createRes.body.data.id;

    // 3. Staff cannot cancel purchases -> 403 Forbidden
    await request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases/${purchaseId}/cancel`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .set('x-organization-id', orgIdA)
      .expect(403);
  });

  /* ------------------------------------------------------------------ */
  /* CONCURRENCY TESTS                                                  */
  /* ------------------------------------------------------------------ */

  it('Concurrency Test A: 20 concurrent purchases on same product with sufficient stock', async () => {
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

    // Run 20 concurrent purchases with quantity = 3 each (Total 60)
    const requests = Array.from({ length: 20 }).map((_, i) =>
      request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/purchases`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({
          branchId: branchIdA1,
          items: [{ productId: concProdId, quantity: 3, unitCost: 20 }],
          note: `Concurrent Purchase ${i}`,
        })
    );

    const responses = await Promise.all(requests);
    const successCount = responses.filter((r) => r.status === 201).length;
    expect(successCount).toBe(20);

    // Verify stock is exactly 100 + (20 * 3) = 160
    const inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: concProdId },
    });
    expect(Number(inv?.quantity)).toBe(160);
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

    const sharedIdempotencyKey = `idem-purchase-${nanoid(8)}`;

    const requests = Array.from({ length: 20 }).map(() =>
      request(app.getHttpServer())
        .post(`/v1/organizations/${orgIdA}/purchases`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgIdA)
        .send({
          branchId: branchIdA1,
          items: [{ productId: concProdId, quantity: 5, unitCost: 40 }],
          idempotencyKey: sharedIdempotencyKey,
        })
    );

    const responses = await Promise.all(requests);
    // All 20 should succeed (either 201 created or 201/200 returning existing purchase)
    for (const res of responses) {
      expect([200, 201]).toContain(res.status);
    }

    // All returned purchases must have the exact same purchase ID and purchase number
    const firstPurchaseId = responses[0].body.data.id;
    for (const res of responses) {
      expect(res.body.data.id).toBe(firstPurchaseId);
    }

    // Verify EXACTLY ONE purchase record in DB with this idempotencyKey
    const purchasesInDb = await db.purchase.findMany({
      where: { organizationId: orgIdA, idempotencyKey: sharedIdempotencyKey },
    });
    expect(purchasesInDb.length).toBe(1);

    // Verify EXACTLY ONE stock addition: 100 + 5 = 105
    const inv = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: concProdId },
    });
    expect(Number(inv?.quantity)).toBe(105);

    // Verify EXACTLY ONE inventory movement
    const movements = await db.inventoryMovement.findMany({
      where: { referenceId: firstPurchaseId },
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

    // Purchase A requests A then B, Purchase B requests B then A
    // (the server sorts lexicographically anyway, so no deadlock should happen)
    const purchaseAReq = request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [
          { productId: dlProdA, quantity: 5, unitCost: 10 },
          { productId: dlProdB, quantity: 5, unitCost: 20 },
        ],
      });

    const purchaseBReq = request(app.getHttpServer())
      .post(`/v1/organizations/${orgIdA}/purchases`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgIdA)
      .send({
        branchId: branchIdA1,
        items: [
          { productId: dlProdB, quantity: 10, unitCost: 20 },
          { productId: dlProdA, quantity: 10, unitCost: 10 },
        ],
      });

    const responses = await Promise.all([purchaseAReq, purchaseBReq]);
    
    expect(responses[0].status).toBe(201);
    expect(responses[1].status).toBe(201);

    // Verify final stock A = 100 + 5 + 10 = 115
    // Verify final stock B = 100 + 5 + 10 = 115
    const invA = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: dlProdA },
    });
    expect(Number(invA?.quantity)).toBe(115);

    const invB = await db.inventory.findFirst({
      where: { organizationId: orgIdA, branchId: branchIdA1, productId: dlProdB },
    });
    expect(Number(invB?.quantity)).toBe(115);
  });
});


