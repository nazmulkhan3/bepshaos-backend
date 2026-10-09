import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from "supertest";
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AuthService } from '../src/modules/auth/services/auth.service.js';

describe('Document Management (e2e)', () => {
  let app: INestApplication;
  let prisma: DatabaseService;
  let token: string;
  let orgId: string;
  let saleId: string;
  let paymentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(DatabaseService);

    // Create unique identifier for this test run
    const testId = `doc-${Date.now()}`;
    const email = `${testId}@example.com`;

    // 1. Setup User
    const user = await prisma.user.create({
      data: {
        email,
        name: 'Doc User',
        status: 'ACTIVE',
      },
    });

    // 2. Setup Organization & Session
    const org = await prisma.organization.create({
      data: {
        name: 'Doc Org',
        slug: testId,
        status: 'ACTIVE',
      },
    });
    orgId = org.id;

    // Create Owner role
    const ownerRole = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: 'Owner',
      },
    });

    await prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        roleId: ownerRole.id,
      },
    });

    // We assume an admin permissions system allows "Owner" all access or bypasses guards,
    // or we can manually assign permissions if needed.
    // Let's assign permissions.
    const perms = ['invoice:create', 'invoice:read', 'invoice:update', 'receipt:create', 'receipt:read', 'receipt:update'];
    for (const p of perms) {
      let perm = await prisma.permission.findUnique({ where: { action: p } });
      if (!perm) perm = await prisma.permission.create({ data: { action: p } });
      await prisma.rolePermission.create({ data: { roleId: ownerRole.id, permissionId: perm.id } });
    }

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: 'hash',
        expiresAt: new Date(Date.now() + 1000000000),
      },
    });

    // Generate JWT token (mock or actual)
    const { JwtService } = await import('@nestjs/jwt');
    const jwtService = app.get(JwtService);
    token = jwtService.sign({ sub: user.id, sessionId: session.id });

    // Setup Branch & Product for Sale
    const branch = await prisma.branch.create({
      data: { organizationId: orgId, name: 'Main', code: `${testId}-B1` },
    });

    const category = await prisma.category.create({
      data: { organizationId: orgId, name: 'Cat', slug: `${testId}-c` }
    });

    const product = await prisma.product.create({
      data: { organizationId: orgId, categoryId: category.id, name: 'Prod', sku: `${testId}-p` }
    });

    const sale = await prisma.sale.create({
      data: {
        organizationId: orgId,
        branchId: branch.id,
        saleNumber: `SALE-${testId}`,
        totalAmount: 100,
        items: {
          create: {
            productId: product.id,
            quantity: 1,
            unitPrice: 100,
            lineTotal: 100
          }
        }
      }
    });
    saleId = sale.id;

    const payment = await prisma.payment.create({
      data: {
        organizationId: orgId,
        branchId: branch.id,
        direction: 'RECEIVED',
        paymentNumber: `PAY-${testId}`,
        amount: 100,
        method: 'CASH',
      }
    });
    paymentId = payment.id;
  });

  afterAll(async () => {
    // Cleanup
    if (prisma) {
      await prisma.invoice.deleteMany({ where: { organizationId: orgId } });
      await prisma.receipt.deleteMany({ where: { organizationId: orgId } });
      await prisma.payment.deleteMany({ where: { organizationId: orgId } });
      await prisma.saleItem.deleteMany({ where: { sale: { organizationId: orgId } } });
      await prisma.sale.deleteMany({ where: { organizationId: orgId } });
      await prisma.product.deleteMany({ where: { organizationId: orgId } });
      await prisma.category.deleteMany({ where: { organizationId: orgId } });
      await prisma.branch.deleteMany({ where: { organizationId: orgId } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
      await prisma.rolePermission.deleteMany({ where: { role: { organizationId: orgId } } });
      await prisma.role.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('Invoices', () => {
    let invoiceId: string;

    it('should create an invoice for a sale', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/organizations/${orgId}/invoices`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-organization-id', orgId)
        .send({
          saleId,
          dueDate: new Date().toISOString(),
          note: 'Thank you for your business',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.invoiceNumber).toBeDefined();
      expect(res.body.data.saleId).toBe(saleId);
      invoiceId = res.body.data.id;
    });

    it('should prevent duplicate invoices for the same sale', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/organizations/${orgId}/invoices`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-organization-id', orgId)
        .send({
          saleId,
        });

      expect(res.status).toBe(409); // ConflictException
    });

    it('should update an invoice', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/organizations/${orgId}/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-organization-id', orgId)
        .send({
          status: 'PAID',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PAID');
    });
  });

  describe('Receipts', () => {
    let receiptId: string;

    it('should create a receipt for a payment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/organizations/${orgId}/receipts`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-organization-id', orgId)
        .send({
          paymentId,
          note: 'Payment received in full',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.receiptNumber).toBeDefined();
      expect(res.body.data.paymentId).toBe(paymentId);
      receiptId = res.body.data.id;
    });

    it('should prevent duplicate receipts for the same payment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/organizations/${orgId}/receipts`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-organization-id', orgId)
        .send({
          paymentId,
        });

      expect(res.status).toBe(409); // ConflictException
    });

    it('should update a receipt', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/organizations/${orgId}/receipts/${receiptId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-organization-id', orgId)
        .send({
          status: 'SENT',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SENT');
    });
  });
});
