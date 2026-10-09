import { Test, TestingModule } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/prisma.service.js';
import { JwtService } from '@nestjs/jwt';

describe('NotificationController (e2e)', () => {
  let app: INestApplication;
  let prisma: DatabaseService;
  let jwtService: JwtService;
  let authToken: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<DatabaseService>(DatabaseService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    // Setup test data
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@test.com`,
        name: 'Test User',
      },
    });
    userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: 'Test Org',
        slug: `test-org-${Date.now()}`,
      },
    });
    orgId = org.id;

    authToken = jwtService.sign({ sub: user.id, email: user.email });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await app.close();
  });

  it('/v1/notifications (GET) - empty', () => {
    return request(app.getHttpServer())
      .get('/v1/notifications')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual([]);
      });
  });

  describe('with notifications', () => {
    let notifId: string;

    beforeAll(async () => {
      const n = await prisma.notification.create({
        data: {
          userId,
          organizationId: orgId,
          type: 'SYSTEM',
          title: 'Test',
          message: 'Hello',
        },
      });
      notifId = n.id;
    });

    it('/v1/notifications (GET) - with data', () => {
      return request(app.getHttpServer())
        .get('/v1/notifications')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toHaveLength(1);
          expect(res.body.data[0].id).toBe(notifId);
        });
    });

    it('/v1/notifications/unread-count (GET)', () => {
      return request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.count).toBe(1);
        });
    });

    it('/v1/notifications/:id/read (PATCH)', () => {
      return request(app.getHttpServer())
        .patch(`/v1/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.isRead).toBe(true);
        });
    });

    it('/v1/notifications/mark-all-read (POST)', () => {
      return request(app.getHttpServer())
        .post('/v1/notifications/mark-all-read')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.count).toBe(0); // already read
        });
    });
  });
});
