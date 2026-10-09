import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { SupplierStatus } from '@prisma/client';

describe('SupplierModule (e2e)', () => {
  let app: INestApplication<any>;
  let prisma: DatabaseService;

  let user1Token: string;
  let user2Token: string;
  let user3Token: string;
  let org1Id: string;
  let org2Id: string;
  let supplier1Id: string;
  let supplier2Id: string;
  let address1Id: string;
  let address2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: 0 });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get<DatabaseService>(DatabaseService);
  });

  afterAll(async () => {
    await prisma.supplierAddress.deleteMany({});
    await prisma.supplier.deleteMany({});
    await prisma.organizationMember.deleteMany({});
    await prisma.role.deleteMany({ where: { organizationId: { not: null } } });
    await prisma.organization.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});
    await app.close();
  });

  describe('Setup Users and Organizations', () => {
    it('should register users, sessions, and orgs', async () => {
      const randomSuffix = Date.now();
      const user1 = await prisma.user.create({
        data: { email: `supuser1_${randomSuffix}@example.com`, name: 'Sup User One', password: 'pw' },
      });
      const user2 = await prisma.user.create({
        data: { email: `supuser2_${randomSuffix}@example.com`, name: 'Sup User Two', password: 'pw' },
      });
      const user3 = await prisma.user.create({
        data: { email: `supuser3_${randomSuffix}@example.com`, name: 'Sup User Three (no perms)', password: 'pw' },
      });

      const { JwtService } = await import('@nestjs/jwt');
      const jwtService = app.get(JwtService);

      const session1 = await prisma.session.create({
        data: { userId: user1.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
      });
      user1Token = jwtService.sign({ sub: user1.id, sessionId: session1.id });

      const session2 = await prisma.session.create({
        data: { userId: user2.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
      });
      user2Token = jwtService.sign({ sub: user2.id, sessionId: session2.id });

      const session3 = await prisma.session.create({
        data: { userId: user3.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
      });
      user3Token = jwtService.sign({ sub: user3.id, sessionId: session3.id });

      const res1 = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Org Supplier 1' });
      org1Id = res1.body.data.id;

      const res2 = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Org Supplier 2' });
      org2Id = res2.body.data.id;
    });
  });

  describe('Supplier CRUD', () => {
    it('POST /organizations/:id/suppliers - Create supplier', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Tech Supplies Co.',
          companyName: 'Tech Supplies Company Ltd.',
          email: 'tech@supplies.com',
          phone: '+8801711223344',
          taxNumber: 'TAX-123456',
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.supplierCode).toBe('SUP-000001');
          expect(res.body.data.name).toBe('Tech Supplies Co.');
          expect(res.body.data.organizationId).toBe(org1Id);
          expect(res.body.data.status).toBe(SupplierStatus.ACTIVE);
          supplier1Id = res.body.data.id;
        });
    });

    it('POST /organizations/:id/suppliers - Create second supplier', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Global Parts Ltd.',
          phone: '+8801811223344',
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.supplierCode).toBe('SUP-000002');
        });
    });

    it('GET /organizations/:id/suppliers - List suppliers', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/suppliers?limit=10`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.length).toBe(2);
          expect(res.body.meta.total).toBe(2);
        });
    });

    it('GET /organizations/:id/suppliers/:id - Get supplier by ID', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.id).toBe(supplier1Id);
          expect(res.body.data.name).toBe('Tech Supplies Co.');
          expect(res.body.data.addresses).toBeDefined();
        });
    });

    it('PATCH /organizations/:id/suppliers/:id - Update supplier', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({ notes: 'Updated note', companyName: 'Updated Company' })
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.notes).toBe('Updated note');
          expect(res.body.data.companyName).toBe('Updated Company');
        });
    });

    it('DELETE /organizations/:id/suppliers/:id - Archive supplier', () => {
      return request(app.getHttpServer())
        .delete(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.status).toBe(SupplierStatus.ARCHIVED);
        });
    });

    it('POST /organizations/:id/suppliers/:id/restore - Restore archived supplier', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}/restore`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.status).toBe(SupplierStatus.ACTIVE);
        });
    });

    it('POST /organizations/:id/suppliers/:id/restore - Fail restore on ACTIVE supplier', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}/restore`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(409);
    });
  });

  describe('Tenant Isolation - Supplier', () => {
    it('POST - Create supplier in Org 2', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org2Id}/suppliers`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org2Id)
        .send({ name: 'Org2 Supplier' })
        .expect(201)
        .then((res) => {
          supplier2Id = res.body.data.id;
        });
    });

    it('User A cannot GET Supplier B', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/suppliers/${supplier2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(404);
    });

    it('User A cannot PATCH Supplier B', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/suppliers/${supplier2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({ name: 'Hacked' })
        .expect(404);
    });

    it('User A cannot DELETE Supplier B', () => {
      return request(app.getHttpServer())
        .delete(`/v1/organizations/${org1Id}/suppliers/${supplier2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(404);
    });

    it('User A cannot RESTORE Supplier B', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers/${supplier2Id}/restore`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(404);
    });

    it('User B cannot access Supplier A', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org2Id}/suppliers/${supplier1Id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org2Id)
        .expect(404);
    });

    it('Cross-tenant membership denied - User 3 not member of Org 1', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/suppliers`)
        .set('Authorization', `Bearer ${user3Token}`)
        .set('x-organization-id', org1Id)
        .expect(403);
    });
  });

  describe('Supplier Address CRUD', () => {
    it('POST - Add address to supplier', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}/addresses`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          label: 'Head Office',
          addressLine1: '123 Tech Park',
          city: 'Dhaka',
          country: 'Bangladesh',
          isDefault: true,
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.addressLine1).toBe('123 Tech Park');
          expect(res.body.data.isDefault).toBe(true);
          address1Id = res.body.data.id;
        });
    });

    it('POST - Add second address', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}/addresses`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          label: 'Warehouse',
          addressLine1: '456 Industrial Area',
          city: 'Chattogram',
          isDefault: false,
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          address2Id = res.body.data.id;
        });
    });

    it('GET - List supplier addresses', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}/addresses`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.length).toBe(2);
        });
    });

    it('GET - Get specific address', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}/addresses/${address1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.id).toBe(address1Id);
        });
    });

    it('PATCH - Update address', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}/addresses/${address1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({ city: 'Updated City' })
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.city).toBe('Updated City');
        });
    });

    it('PATCH - Switch default address', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}/addresses/${address2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({ isDefault: true })
        .expect(200)
        .then(async (res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.isDefault).toBe(true);
          // Verify first address is no longer default
          const addr1 = await prisma.supplierAddress.findUnique({ where: { id: address1Id } });
          expect(addr1?.isDefault).toBe(false);
        });
    });

    it('DELETE - Remove address', () => {
      return request(app.getHttpServer())
        .delete(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}/addresses/${address2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200);
    });
  });

  describe('Tenant Isolation - Address', () => {
    it('User A cannot list addresses of Supplier B', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/suppliers/${supplier2Id}/addresses`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(404);
    });

    it('User A cannot get address of Supplier B', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/suppliers/${supplier2Id}/addresses/some-addr`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(404);
    });

    it('User A cannot update address of Supplier B', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/suppliers/${supplier2Id}/addresses/some-addr`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({ city: 'Hacked' })
        .expect(404);
    });

    it('User A cannot create address for Supplier B', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers/${supplier2Id}/addresses`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({ addressLine1: 'Hacked Address' })
        .expect(404);
    });

    it('User A cannot archive address of Supplier B', () => {
      return request(app.getHttpServer())
        .delete(`/v1/organizations/${org1Id}/suppliers/${supplier2Id}/addresses/some-addr`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(404);
    });
  });

  describe('RBAC Permissions', () => {
    let staffToken: string;

    it('Setup staff user with limited permissions', async () => {
      const staff = await prisma.user.create({
        data: { email: `supstaff_${Date.now()}@example.com`, name: 'Sup Staff', password: 'pw' },
      });

      const { JwtService } = await import('@nestjs/jwt');
      const jwtService = app.get(JwtService);

      const session = await prisma.session.create({
        data: { userId: staff.id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 100000) },
      });
      staffToken = jwtService.sign({ sub: staff.id, sessionId: session.id });

      // Find STAFF role (or create one with limited permissions)
      let staffRole = await prisma.role.findFirst({
        where: { name: 'STAFF', organizationId: null },
      });

      if (!staffRole) {
        // Get a permission to reference
        const readPerm = await prisma.permission.findFirst({ where: { action: 'supplier:read' } });
        staffRole = await prisma.role.create({
          data: {
            name: 'STAFF',
            permissions: readPerm ? { create: [{ permissionId: readPerm.id }] } : undefined,
          },
        });
      }

      await prisma.organizationMember.create({
        data: {
          organizationId: org1Id,
          userId: staff.id,
          roleId: staffRole!.id,
          status: 'ACTIVE',
        },
      });
    });

    it('Staff without supplier:create - POST denied', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('x-organization-id', org1Id)
        .send({ name: 'Should Fail' })
        .expect(403);
    });

    it('Staff without supplier:update - PATCH denied', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('x-organization-id', org1Id)
        .send({ name: 'Hacked' })
        .expect(403);
    });

    it('Staff without supplier:archive - DELETE denied', () => {
      return request(app.getHttpServer())
        .delete(`/v1/organizations/${org1Id}/suppliers/${supplier1Id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('x-organization-id', org1Id)
        .expect(403);
    });
  });

  describe('Supplier Code Concurrency', () => {
    it('should generate unique codes for concurrent creations', async () => {
      const orgRes = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Concurrency Test Org' });
      const concurrentOrgId = orgRes.body.data.id;

      const promises = Array.from({ length: 10 }, (_, i) =>
        request(app.getHttpServer())
          .post(`/v1/organizations/${concurrentOrgId}/suppliers`)
          .set('Authorization', `Bearer ${user1Token}`)
          .set('x-organization-id', concurrentOrgId)
          .send({ name: `Concurrent Supplier ${i + 1}` }),
      );

      const results = await Promise.all(promises);

      const codes = results
        .filter((r) => r.status === 201)
        .map((r) => r.body.data.supplierCode)
        .sort((a, b) => a.localeCompare(b));

      // All should succeed
      expect(codes.length).toBe(10);

      // All codes should be unique
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(10);

      // All codes should follow SUP-XXXXXX format
      codes.forEach((code) => {
        expect(code).toMatch(/^SUP-\d{6}$/);
      });

      // Codes should be sequential (sorted = SUP-000001 through SUP-000010)
      expect(codes).toEqual([
        'SUP-000001', 'SUP-000002', 'SUP-000003', 'SUP-000004', 'SUP-000005',
        'SUP-000006', 'SUP-000007', 'SUP-000008', 'SUP-000009', 'SUP-000010',
      ]);
    });
  });

  describe('Search & Pagination E2E', () => {
    let searchOrgId: string;

    beforeAll(async () => {
      const orgRes = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Search Test Org' });
      searchOrgId = orgRes.body.data.id;

      const suppliers = [
        { name: 'Alpha Traders', companyName: 'Alpha Corp', email: 'alpha@test.com', phone: '01700000001', taxNumber: 'TAX-111' },
        { name: 'Beta Supplies', companyName: 'Beta Inc', email: 'beta@test.com', phone: '01700000002', taxNumber: 'TAX-222' },
        { name: 'Gamma Electronics', companyName: 'Gamma Ltd', email: 'gamma@test.com', phone: '01700000003', taxNumber: 'TAX-333' },
        { name: 'Delta Trading', companyName: 'Delta Corp', email: 'delta@test.com', phone: '01700000004', taxNumber: 'TAX-444' },
        { name: 'Epsilon Tech', companyName: 'Epsilon Inc', email: 'epsilon@test.com', phone: '01700000005', taxNumber: 'TAX-555' },
      ];

      for (const s of suppliers) {
        await request(app.getHttpServer())
          .post(`/v1/organizations/${searchOrgId}/suppliers`)
          .set('Authorization', `Bearer ${user1Token}`)
          .set('x-organization-id', searchOrgId)
          .send(s);
      }
    });

    it('Search by name', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?search=Alpha`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(1);
          expect(res.body.data[0].name).toBe('Alpha Traders');
        });
    });

    it('Search by companyName', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?search=Corp`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(2);
        });
    });

    it('Search by email', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?search=beta@test.com`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(1);
          expect(res.body.data[0].name).toBe('Beta Supplies');
        });
    });

    it('Search by phone', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?search=01700000003`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(1);
          expect(res.body.data[0].name).toBe('Gamma Electronics');
        });
    });

    it('Search by supplierCode', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?search=SUP-000001`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(1);
        });
    });

    it('Search by taxNumber', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?search=TAX-444`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(1);
          expect(res.body.data[0].name).toBe('Delta Trading');
        });
    });

    it('Filter by ACTIVE status', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?status=ACTIVE`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(5);
        });
    });

    it('Pagination - page 1 with limit 2', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?page=1&limit=2&sortBy=name&sortOrder=asc`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(2);
          expect(res.body.meta.page).toBe(1);
          expect(res.body.meta.limit).toBe(2);
          expect(res.body.meta.total).toBe(5);
          expect(res.body.meta.totalPages).toBe(3);
        });
    });

    it('Pagination - page 2', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?page=2&limit=2&sortBy=name&sortOrder=asc`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(2);
          expect(res.body.meta.page).toBe(2);
          expect(res.body.data[0].name).toBe('Delta Trading');
        });
    });

    it('Sorting by createdAt desc (default)', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?sortBy=createdAt&sortOrder=desc`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(5);
          // Most recently created should be first
          expect(res.body.data[0].name).toBe('Epsilon Tech');
        });
    });

    it('Invalid sortBy falls back to createdAt', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${searchOrgId}/suppliers?sortBy=invalidField&sortOrder=desc`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', searchOrgId)
        .expect(200)
        .then((res) => {
          expect(res.body.data.length).toBe(5);
          // Should still return results (using default sort)
          expect(res.body.data[0].name).toBe('Epsilon Tech');
        });
    });
  });

  describe('Lifecycle Test', () => {
    let lifecycleSupplierId: string;

    it('Create supplier for lifecycle test', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({ name: 'Lifecycle Supplier' });
      lifecycleSupplierId = res.body.data.id;
      expect(res.body.data.status).toBe(SupplierStatus.ACTIVE);
    });

    it('ACTIVE -> ARCHIVED', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/organizations/${org1Id}/suppliers/${lifecycleSupplierId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200);
      expect(res.body.data.status).toBe(SupplierStatus.ARCHIVED);
    });

    it('ARCHIVED -> RESTORED (ACTIVE)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/suppliers/${lifecycleSupplierId}/restore`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(201);
      expect(res.body.data.status).toBe(SupplierStatus.ACTIVE);
    });

    it('Record still exists in database after archive', async () => {
      const record = await prisma.supplier.findUnique({ where: { id: lifecycleSupplierId } });
      expect(record).not.toBeNull();
    });
  });

  describe('Audit Log Verification', () => {
    it('should have created audit logs for supplier operations', async () => {
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          entity: 'Supplier',
          organizationId: org1Id,
        },
      });

      const actions = auditLogs.map((log) => log.action);

      expect(actions).toContain('SUPPLIER_CREATED');
      expect(actions).toContain('SUPPLIER_UPDATED');
      expect(actions).toContain('SUPPLIER_ARCHIVED');
      expect(actions).toContain('SUPPLIER_RESTORED');

      // Verify organizationId and entityId are present
      auditLogs.forEach((log) => {
        expect(log.organizationId).toBe(org1Id);
        expect(log.entityId).toBeDefined();
      });
    });

    it('should have created audit logs for address operations', async () => {
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          entity: 'SupplierAddress',
          organizationId: org1Id,
        },
      });

      const actions = auditLogs.map((log) => log.action);

      expect(actions).toContain('SUPPLIER_ADDRESS_CREATED');
      expect(actions).toContain('SUPPLIER_ADDRESS_UPDATED');
      expect(actions).toContain('SUPPLIER_ADDRESS_DELETED');

      auditLogs.forEach((log) => {
        expect(log.organizationId).toBe(org1Id);
        expect(log.entityId).toBeDefined();
      });
    });
  });

  describe('Address Default Concurrency', () => {
    it('should handle concurrent default address updates safely', async () => {
      const orgRes = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Address Concurrency Org' });
      const concOrgId = orgRes.body.data.id;

      const supRes = await request(app.getHttpServer())
        .post(`/v1/organizations/${concOrgId}/suppliers`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', concOrgId)
        .send({ name: 'Concurrent Addr Supplier' });
      const concSupId = supRes.body.data.id;

      // Create 3 addresses
      const addrPromises = Array.from({ length: 3 }, (_, i) =>
        request(app.getHttpServer())
          .post(`/v1/organizations/${concOrgId}/suppliers/${concSupId}/addresses`)
          .set('Authorization', `Bearer ${user1Token}`)
          .set('x-organization-id', concOrgId)
          .send({ addressLine1: `Address ${i + 1}`, isDefault: i === 0 }),
      );
      const addrResults = await Promise.all(addrPromises);
      const addrIds = addrResults.filter((r) => r.status === 201).map((r) => r.body.data.id);

      expect(addrIds.length).toBe(3);

      // Concurrently try to mark each as default
      const updatePromises = addrIds.map((addrId) =>
        request(app.getHttpServer())
          .patch(`/v1/organizations/${concOrgId}/suppliers/${concSupId}/addresses/${addrId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .set('x-organization-id', concOrgId)
          .send({ isDefault: true }),
      );
      await Promise.all(updatePromises);

      // Verify only one address is default
      const addresses = await prisma.supplierAddress.findMany({
        where: { supplierId: concSupId },
      });
      const defaultCount = addresses.filter((a) => a.isDefault).length;
      expect(defaultCount).toBe(1);
    });
  });
});
