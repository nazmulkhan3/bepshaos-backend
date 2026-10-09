import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { nanoid } from 'nanoid';

describe('OrganizationModule (e2e)', () => {
  let app: INestApplication<any>;
  let prisma: DatabaseService;
  let user1Token: string;
  let user2Token: string;
  let org1Id: string;

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
    // Cleanup created data
    await prisma.organization.deleteMany({}).catch(() => {});
    await prisma.user.deleteMany({}).catch(() => {});
    await app.close();
  });

  describe('Setup Users', () => {
    it('should register two users', async () => {
      const testId = nanoid(5);
      // Create user 1
      const user1 = await prisma.user.create({
        data: {
          email: `user1_${testId}@example.com`,
          name: 'User One',
          password: 'hashed_password_for_test',
        },
      });

      // Create user 2
      const user2 = await prisma.user.create({
        data: {
          email: `user2_${testId}@example.com`,
          name: 'User Two',
          password: 'hashed_password_for_test',
        },
      });

      // Issue tokens (mocking JWT for simplicity or creating real ones)
      // Since it's an E2E test on the full app, let's use the JwtService
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
    });
  });

  describe('Organization API', () => {
    it('/organizations (POST) - Create org', () => {
      return request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Acme Corp Test',
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.name).toBe('Acme Corp Test');
          org1Id = res.body.data.id;
        });
    });

    it('/organizations (GET) - List my orgs', () => {
      return request(app.getHttpServer())
        .get('/v1/organizations')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toHaveLength(1);
          expect(res.body.data[0].id).toBe(org1Id);
        });
    });

    it('/organizations/:id (GET) - Get my org', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.id).toBe(org1Id);
        });
    });

    it('Cross-Tenant IDOR: User 2 tries to access User 1 org', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org1Id)
        .expect(403);
    });
    
    it('Cross-Tenant IDOR: User 2 tries to list members of User 1 org', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/members`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org1Id)
        .expect(403);
    });

    it('/organizations/:id/members (GET) - User 1 lists members', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/members`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toHaveLength(1);
          expect(res.body.data[0].role.name).toBe('OWNER');
        });
    });
  });
});
