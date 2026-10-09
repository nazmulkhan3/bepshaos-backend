import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { ProductStatus } from '@prisma/client';
import { nanoid } from 'nanoid';

describe('ProductModule (e2e)', () => {
  let app: INestApplication<any>;
  let prisma: DatabaseService;
  
  let user1Token: string;
  let user2Token: string;
  let org1Id: string;
  let org2Id: string;
  let product1Id: string;
  let category1Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: 0,
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    
    prisma = moduleFixture.get<DatabaseService>(DatabaseService);
  });

  afterAll(async () => {
    await prisma.inventory.deleteMany({}).catch(() => {});
    await prisma.purchaseItem.deleteMany({}).catch(() => {});
    await prisma.product.deleteMany({}).catch(() => {});
    await prisma.category.deleteMany({}).catch(() => {});
    await prisma.organization.deleteMany({}).catch(() => {});
    await prisma.user.deleteMany({}).catch(() => {});
    await app.close();
  });

  describe('Setup Users and Organizations', () => {
    it('should register users and orgs', async () => {
      const testId = nanoid(5);
      const user1 = await prisma.user.create({
        data: { email: `produser1_${testId}@example.com`, name: 'Prod User One', password: 'pw' },
      });
      const user2 = await prisma.user.create({
        data: { email: `produser2_${testId}@example.com`, name: 'Prod User Two', password: 'pw' },
      });

      const { JwtService } = await import('@nestjs/jwt');
      const jwtService = app.get(JwtService);

      const session1 = await prisma.session.create({
        data: { userId: user1.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) }
      });
      user1Token = jwtService.sign({ sub: user1.id, sessionId: session1.id });

      const session2 = await prisma.session.create({
        data: { userId: user2.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) }
      });
      user2Token = jwtService.sign({ sub: user2.id, sessionId: session2.id });

      const res1 = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Org Product 1' });
      org1Id = res1.body.data.id;

      const res2 = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Org Product 2' });
      org2Id = res2.body.data.id;
    });

    it('should create category', async () => {
       const cat = await prisma.category.create({
          data: {
             organizationId: org1Id,
             name: 'Test Category',
             slug: 'test-category'
          }
       });
       category1Id = cat.id;
    });
  });

  describe('Product API', () => {
    it('POST /v1/products - Create product', () => {
      return request(app.getHttpServer())
        .post(`/v1/products`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Laptop X1',
          categoryId: category1Id,
          sellingPrice: 1000
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.sku).toBeDefined();
          expect(res.body.data.barcode).toBeDefined();
          product1Id = res.body.data.id;
        });
    });

    it('GET /v1/products - List products', () => {
      return request(app.getHttpServer())
        .get(`/v1/products?search=Laptop`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.length).toBe(1);
          expect(res.body.data[0].name).toBe('Laptop X1');
        });
    });

    it('PATCH /v1/products/:id - Update product', () => {
      return request(app.getHttpServer())
        .patch(`/v1/products/${product1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          sellingPrice: 1200
        })
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(Number(res.body.data.sellingPrice)).toBe(1200);
        });
    });

    it('Cross-Tenant: User 2 tries to GET Org 1 product', () => {
      return request(app.getHttpServer())
        .get(`/v1/products/${product1Id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org1Id)
        .expect(403);
    });
  });
});
