import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { BranchStatus } from '@prisma/client';

describe('BranchModule (e2e)', () => {
  let app: INestApplication<any>;
  let prisma: DatabaseService;
  
  let user1Token: string;
  let user2Token: string;
  let org1Id: string;
  let org2Id: string;
  let branch1Id: string;

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
    await prisma.branch.deleteMany({}).catch(() => {});
    await prisma.organization.deleteMany({}).catch(() => {});
    await prisma.user.deleteMany({}).catch(() => {});
    await app.close();
  });

  describe('Setup Users and Organizations', () => {
    it('should register users and orgs', async () => {
      const testId = Date.now().toString() + nanoid(5);
      const user1 = await prisma.user.create({
        data: { email: `bruser1_${testId}@example.com`, name: 'Br User One', password: 'pw' },
      });
      const user2 = await prisma.user.create({
        data: { email: `bruser2_${testId}@example.com`, name: 'Br User Two', password: 'pw' },
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
        .send({ name: 'Org Branch 1' });
      org1Id = res1.body.data.id;

      const res2 = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Org Branch 2' });
      org2Id = res2.body.data.id;
    });
  });

  describe('Branch API', () => {
    it('POST /organizations/:id/branches - Create first branch (becomes default)', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/branches`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Main Branch',
          code: 'MAIN',
          address: 'Dhaka'
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.code).toBe('MAIN');
          expect(res.body.data.isDefault).toBe(true);
          branch1Id = res.body.data.id;
        });
    });

    it('POST /organizations/:id/branches - Prevent duplicate code in same org', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/branches`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Main Branch Copy',
          code: 'MAIN'
        })
        .expect(409);
    });

    it('POST /organizations/:id/branches - Allow same code in different org', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org2Id}/branches`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org2Id)
        .send({
          name: 'Main Branch Org 2',
          code: 'MAIN'
        })
        .expect(201);
    });

    it('GET /organizations/:id/branches - List branches', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/branches?limit=10`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.length).toBe(1);
          expect(res.body.meta.total).toBe(1);
        });
    });

    it('GET /organizations/:id/branches/:branchId - Get single branch', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/branches/${branch1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.id).toBe(branch1Id);
        });
    });

    it('PATCH /organizations/:id/branches/:branchId - Update branch', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/branches/${branch1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Updated Main Branch'
        })
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.name).toBe('Updated Main Branch');
        });
    });

    it('DELETE /organizations/:id/branches/:branchId - Archive default branch should fail', () => {
      return request(app.getHttpServer())
        .delete(`/v1/organizations/${org1Id}/branches/${branch1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(400); // Bad Request because it's default
    });

    it('POST /organizations/:id/branches - Create second branch as default', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/branches`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Second Branch',
          code: 'SEC',
          isDefault: true
        })
        .expect(201)
        .then(async (res) => {
          expect(res.body.data.isDefault).toBe(true);
          // verify first branch is no longer default
          const firstBranch = await prisma.branch.findUnique({ where: { id: branch1Id } });
          expect(firstBranch?.isDefault).toBe(false);
        });
    });

    it('Cross-Tenant: User 2 tries to GET Org 1 branch', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/branches/${branch1Id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org1Id)
        .expect(403);
    });

    it('Cross-Tenant: User 2 tries to PATCH Org 1 branch', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/branches/${branch1Id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org1Id)
        .send({ name: 'Hacked' })
        .expect(403);
    });
  });
});
