import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { nanoid } from 'nanoid';
import { CustomerStatus } from '@prisma/client';

describe('CustomerModule (e2e)', () => {
  let app: INestApplication<any>;
  let prisma: DatabaseService;
  
  let user1Token: string;
  let user2Token: string;
  let org1Id: string;
  let org2Id: string;
  let customer1Id: string;
  let address1Id: string;

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
    await prisma.journalEntryLine.deleteMany({}).catch(() => {});
    await prisma.journalEntry.deleteMany({}).catch(() => {});
    await prisma.customerAddress.deleteMany({}).catch(() => {});
    await prisma.customer.deleteMany({}).catch(() => {});
    await prisma.organization.deleteMany({}).catch(() => {});
    await prisma.user.deleteMany({}).catch(() => {});
    await app.close();
  });

  describe('Setup Users and Organizations', () => {
    it('should register users and orgs', async () => {
      const testId = nanoid(5);
      const user1 = await prisma.user.create({
        data: { email: `cususer1_${testId}@example.com`, name: 'Cus User One', password: 'pw' },
      });
      const user2 = await prisma.user.create({
        data: { email: `cususer2_${testId}@example.com`, name: 'Cus User Two', password: 'pw' },
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
        .send({ name: 'Org Customer 1' });
      org1Id = res1.body.data.id;

      const res2 = await request(app.getHttpServer())
        .post('/v1/organizations')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Org Customer 2' });
      org2Id = res2.body.data.id;
    });
  });

  describe('Customer API', () => {
    it('POST /organizations/:id/customers - Create customer', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/customers`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Rahim Traders',
          phone: '01700000000'
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.customerCode).toBe('CUS-000001');
          customer1Id = res.body.data.id;
        });
    });

    it('POST /organizations/:id/customers - Create second customer', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/customers`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          name: 'Karim Traders',
          phone: '01800000000'
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.customerCode).toBe('CUS-000002');
        });
    });

    it('GET /organizations/:id/customers - List customers with search', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/customers?search=rahim`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.length).toBe(1);
          expect(res.body.data[0].name).toBe('Rahim Traders');
        });
    });

    it('PATCH /organizations/:id/customers/:customerId - Update customer', () => {
      return request(app.getHttpServer())
        .patch(`/v1/organizations/${org1Id}/customers/${customer1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          notes: 'Updated note'
        })
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.notes).toBe('Updated note');
        });
    });

    it('DELETE /organizations/:id/customers/:customerId - Archive customer', () => {
      return request(app.getHttpServer())
        .delete(`/v1/organizations/${org1Id}/customers/${customer1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.status).toBe(CustomerStatus.ARCHIVED);
        });
    });
  });

  describe('Customer Address API', () => {
    it('POST /organizations/:id/customers/:customerId/addresses - Add address', () => {
      return request(app.getHttpServer())
        .post(`/v1/organizations/${org1Id}/customers/${customer1Id}/addresses`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .send({
          addressLine1: '123 Main St',
          city: 'Dhaka',
          isDefault: true
        })
        .expect(201)
        .then((res) => {
          expect(res.body.success).toBe(true);
          address1Id = res.body.data.id;
        });
    });

    it('GET /organizations/:id/customers/:customerId/addresses - List addresses', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/customers/${customer1Id}/addresses`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('x-organization-id', org1Id)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.length).toBe(1);
          expect(res.body.data[0].id).toBe(address1Id);
        });
    });

    it('Cross-Tenant: User 2 tries to GET Org 1 customer', () => {
      return request(app.getHttpServer())
        .get(`/v1/organizations/${org1Id}/customers/${customer1Id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .set('x-organization-id', org1Id)
        .expect(403);
    });
  });
});
