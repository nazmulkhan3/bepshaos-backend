import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { nanoid } from 'nanoid';

describe('Roles & Permissions (e2e)', () => {
  let app: INestApplication<any>;
  let prisma: DatabaseService;
  let ownerToken: string;
  let staffToken: string;
  let orgId: string;
  let ownerUserId: string;
  let staffUserId: string;
  let staffMemberId: string;
  let customRoleId: string;

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
    if (orgId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    if (ownerUserId) await prisma.user.delete({ where: { id: ownerUserId } });
    if (staffUserId) await prisma.user.delete({ where: { id: staffUserId } });
    await app.close();
  });

  describe('Setup organization and users', () => {
    it('should setup test environment', async () => {
      const testId = Date.now().toString() + nanoid(5);
      const owner = await prisma.user.create({ data: { name: 'Owner', email: `owner_${testId}@roles.com`, password: 'hash' } });
      const staff = await prisma.user.create({ data: { name: 'Staff', email: `staff_${testId}@roles.com`, password: 'hash' } });
      ownerUserId = owner.id;
      staffUserId = staff.id;

      const { JwtService } = await import('@nestjs/jwt');
      const jwtService = app.get(JwtService);

      const session1 = await prisma.session.create({ data: { userId: owner.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) }});
      ownerToken = jwtService.sign({ sub: owner.id, sessionId: session1.id });

      const session2 = await prisma.session.create({ data: { userId: staff.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) }});
      staffToken = jwtService.sign({ sub: staff.id, sessionId: session2.id });

      // Owner creates organization (gets OWNER role automatically)
      const res = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Roles Corp' });
      if (res.status !== 201) console.log('POST /v1/organizations failed:', res.body);
      expect(res.status).toBe(201);
      
      orgId = res.body.data.id;

      // Manually add staff member to the organization as STAFF
      const staffRole = await prisma.role.findFirst({ where: { name: 'STAFF', organizationId: null } });
      
      const member = await prisma.organizationMember.create({
        data: {
          organizationId: orgId,
          userId: staff.id,
          roleId: staffRole!.id,
          status: 'ACTIVE'
        }
      });
      staffMemberId = member.id;
    });
  });

  describe('Role Management API', () => {
    it('/organizations/:id/roles (POST) - Staff cannot create role', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('x-organization-id', orgId)
        .send({ name: 'Custom', permissions: ['product:read'] })
        .expect(403);
    });

    it('/organizations/:id/roles (POST) - Owner creates custom role', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', orgId)
        .send({ name: 'Custom Manager', permissions: ['product:read', 'product:create'] })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.name).toBe('Custom Manager');
          customRoleId = res.body.data.id;
        });
    });

    it('/organizations/:id/roles (GET) - List roles', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', orgId)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.length).toBeGreaterThan(0);
        });
    });
  });

  describe('Role Assignment API', () => {
    it('Assign role to member', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${orgId}/members/${staffMemberId}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', orgId)
        .send({ roleId: customRoleId })
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.roleId).toBe(customRoleId);
        });
    });

    it('Owner protection: Cannot change the last owner role', async () => {
      const ownerMember = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: ownerUserId } }
      });

      return request(app.getHttpServer())
        .patch(`/v1/organizations/${orgId}/members/${ownerMember!.id}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', orgId)
        .send({ roleId: customRoleId })
        .expect(403);
    });
  });
});
