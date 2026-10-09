import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { nanoid } from 'nanoid';

describe('BusinessModule (e2e)', () => {
  let app: INestApplication<any>;
  let prisma: DatabaseService;
  
  let user1Token: string;
  let user2Token: string;
  let org1Id: string;
  let org2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: 0, // VersioningType.URI is 0
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    
    prisma = moduleFixture.get<DatabaseService>(DatabaseService);
  });

  afterAll(async () => {
    await prisma.business.deleteMany({}).catch(() => {});
    await prisma.organization.deleteMany({}).catch(() => {});
    await prisma.user.deleteMany({}).catch(() => {});
    await app.close();
  });

  describe('Setup Users and Organizations', () => {
    it('should register users and orgs', async () => {
      const testId = nanoid(5);
      const user1 = await prisma.user.create({
        data: { email: `bizuser1_${testId}@example.com`, name: 'Biz User One', password: 'pw' },
      });
      const user2 = await prisma.user.create({
        data: { email: `bizuser2_${testId}@example.com`, name: 'Biz User Two', password: 'pw' },
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

      // Create Orgs
      const res1 = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Org 1' });
      org1Id = res1.body.data.id;

      const res2 = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Org 2' });
      org2Id = res2.body.data.id;
    });
  });

  describe('Business API', () => {
    it('POST /organizations/:id/business - Create business', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/business`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Biz 1 Profile',
          currency: 'USD',
          timezone: 'America/New_York'
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.name).toBe('Biz 1 Profile');
          expect(res.body.data.currency).toBe('USD');
        });
    });

    it('POST /organizations/:id/business - Prevent duplicate business', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/business`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Biz 1 Another Profile',
        })
        .expect(409); // Conflict
    });

    it('GET /organizations/:id/business - Get business', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/business`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.name).toBe('Biz 1 Profile');
        });
    });

    it('PATCH /organizations/:id/business - Update business', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/business`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          taxEnabled: true,
          taxNumber: '123456789'
        })
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.taxEnabled).toBe(true);
          expect(res.body.data.taxNumber).toBe('123456789');
        });
    });

    it('Cross-Tenant: User 2 tries to GET Org 1 business', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/business`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org1Id)
        .expect(403);
    });

    it('Cross-Tenant: User 2 tries to PATCH Org 1 business', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/business`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org1Id)
        .send({ name: 'Hacked' })
        .expect(403);
    });
  });
});
