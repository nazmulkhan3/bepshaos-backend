import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { nanoid } from 'nanoid';

describe('InventoryModule (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwtService: any;

  let ownerToken: string;
  let orgId: string;
  let branchId: string;
  let productId: string;
  let categoryId: string;

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
    // Only clean up inventory data to avoid parallel test conflicts
    if (orgId) {
      await db.inventoryMovement.deleteMany({
        where: { organizationId: orgId }
      });
      await db.inventory.deleteMany({
        where: { organizationId: orgId }
      });
    }
    await app.close();
  });

  it('should register user and organization for setup', async () => {
    const testId = Date.now().toString() + nanoid(5);
    const email = `inventory${testId}@example.com`;

    // 1. Create User
    const user = await db.user.create({
      data: {
        email,
        name: 'Inventory Owner',
        password: 'dummy',
      }
    });
    const userId = user.id;

    // 2. Create Session & Token
    const session = await db.session.create({
      data: {
        userId,
        refreshTokenHash: 'hash',
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    ownerToken = jwtService.sign({ sub: userId, sessionId: session.id });

    // 3. Create Organization
    const orgRes = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Inventory Org ${testId}` });
    orgId = orgRes.body.data.id;

    // 4. Create Branch
    const branchRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${orgId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: 'Main Branch', code: `MB-${testId}` })
      .expect(201);
    branchId = branchRes.body.data.id;

    // 5. Create Category
    const catRes = await request(app.getHttpServer())
      .post('/v1/categories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ name: 'Electronics' })
      .expect(201);
    categoryId = catRes.body.data.id;

    // 6. Create Product
    const prodRes = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        name: 'Smartphone X',
        categoryId,
        price: 999.99,
        cost: 500,
        type: 'STANDARD'
      })
      .expect(201);
    productId = prodRes.body.data.id;
  });

  it('should process STOCK_IN and create movement', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId,
        productId,
        quantity: 100,
        note: 'Initial Stock'
      })
      .expect(201);

    expect(res.body.data.movementType).toBe('STOCK_IN');
    expect(res.body.data.afterQuantity).toBe('100');

    // Verify inventory row
    const inventory = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId }
    });
    expect(inventory?.quantity.toNumber()).toBe(100);
  });

  it('should process STOCK_OUT successfully', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/inventory/stock-out')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId,
        productId,
        quantity: 20,
        note: 'Sold'
      })
      .expect(201);

    expect(res.body.data.movementType).toBe('STOCK_OUT');
    expect(res.body.data.afterQuantity).toBe('80');
  });

  it('should reject STOCK_OUT if insufficient stock', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/inventory/stock-out')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId,
        productId,
        quantity: 90, // We have 80 left
      })
      .expect(409);

    expect(res.body.message).toContain('Insufficient stock');
  });

  it('should handle ADJUSTMENT properly (Increase)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/inventory/adjust')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId,
        productId,
        newQuantity: 85, // Current is 80, difference +5
      })
      .expect(201);

    expect(res.body.data.movementType).toBe('ADJUSTMENT');
    expect(res.body.data.quantity).toBe('5');
    expect(res.body.data.afterQuantity).toBe('85');
  });

  it('should handle ADJUSTMENT properly (Decrease)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/inventory/adjust')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId,
        productId,
        newQuantity: 70, // Current is 85, difference -15
      })
      .expect(201);

    expect(res.body.data.movementType).toBe('ADJUSTMENT');
    expect(res.body.data.quantity).toBe('15'); // Absolute quantity is recorded
    expect(res.body.data.afterQuantity).toBe('70');
  });

  it('should handle idempotency correctly', async () => {
    const idempotencyKey = nanoid(10);
    
    // First request
    const res1 = await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId,
        productId,
        quantity: 10,
        idempotencyKey
      })
      .expect(201);
      
    // Second exact request
    const res2 = await request(app.getHttpServer())
      .post('/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({
        branchId,
        productId,
        quantity: 10,
        idempotencyKey
      })
      .expect(201);

    expect(res1.body.data.id).toBe(res2.body.data.id); // Should return same movement

    // Verify inventory only increased by 10 once (70 -> 80)
    const inventory = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId }
    });
    expect(inventory?.quantity.toNumber()).toBe(80);
  });

  it('should handle concurrent STOCK_OUT operations safely', async () => {
    // Current stock: 80
    // Launch 15 concurrent stock-out of 3 units each = 45 units out
    const requests = Array.from({ length: 15 }).map(() =>
      request(app.getHttpServer())
        .post('/v1/inventory/stock-out')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', orgId)
        .send({
          branchId,
          productId,
          quantity: 3,
        })
    );

    const results = await Promise.all(requests);
    
    // All should be successful
    results.forEach(res => {
      expect(res.status).toBe(201);
    });

    // Final stock should be 80 - 45 = 35
    const inventory = await db.inventory.findFirst({
      where: { organizationId: orgId, branchId, productId }
    });
    expect(inventory?.quantity.toNumber()).toBe(35);
  });
});
