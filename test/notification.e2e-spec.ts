import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { JwtService } from '@nestjs/jwt';

import { NotificationQueueService } from '../src/modules/notification/notification.queue.service.js';

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
          expect(res.body.data.count).toBe(1);
        });
    });

    it('/v1/notifications/:id/read (PATCH)', () => {
      return request(app.getHttpServer())
        .patch(`/v1/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.isRead).toBe(true);
        });
    });

    it('/v1/notifications/mark-all-read (POST)', () => {
      return request(app.getHttpServer())
        .post('/v1/notifications/mark-all-read')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.count).toBe(0); // already read
        });
    });

    it('should enqueue and process notification job asynchronously via BullMQ', async () => {
      const queueService = app.get<NotificationQueueService>(NotificationQueueService);
      const uniqueMsg = `BullMQ Async Message ${Date.now()}`;
      await queueService.enqueue({
        userId,
        organizationId: orgId,
        type: 'SYSTEM',
        title: 'BullMQ Async Test',
        message: uniqueMsg,
        entityType: 'TestEntity',
        entityId: `entity-${Date.now()}`,
      });

      let createdNotif = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200));
        createdNotif = await prisma.notification.findFirst({
          where: {
            userId,
            message: uniqueMsg,
          },
        });
        if (createdNotif) break;
      }

      expect(createdNotif).toBeDefined();
      expect(createdNotif?.title).toBe('BullMQ Async Test');
    });
  });
});
