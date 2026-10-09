import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { CategoryStatus } from '@prisma/client';

describe('CategoryModule (e2e)', () => {
  let app: INestApplication<any>;
  let prisma: DatabaseService;
  
  let user1Token: string;
  let user2Token: string;
  let org1Id: string;
  let org2Id: string;
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
        data: { email: `catuser1_${testId}@example.com`, name: 'Cat User One', password: 'pw' },
      });
      const user2 = await prisma.user.create({
        data: { email: `catuser2_${testId}@example.com`, name: 'Cat User Two', password: 'pw' },
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
        .send({ name: 'Org Category 1' });
      org1Id = res1.body.data.id;

      const res2 = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Org Category 2' });
      org2Id = res2.body.data.id;
    });
  });

  describe('Category API', () => {
    it('POST /v1/categories - Create category', () => {
      return request(app.getHttpServer())
        .post(`/v1/categories`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Electronics'
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.slug).toBe('electronics');
          category1Id = res.body.data.id;
        });
    });

    it('GET /v1/categories - List categories', () => {
      return request(app.getHttpServer())
        .get(`/v1/categories?search=electronic`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.length).toBe(1);
          expect(res.body.data[0].name).toBe('Electronics');
        });
    });

    it('PATCH /v1/categories/:id - Update category', () => {
      return request(app.getHttpServer())
        .patch(`/v1/categories/${category1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          description: 'Updated desc'
        })
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.description).toBe('Updated desc');
        });
    });

    it('Cross-Tenant: User 2 tries to GET Org 1 category', () => {
      return request(app.getHttpServer())
        .get(`/v1/categories/${category1Id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org1Id)
        .expect(403);
    });
  });
});
