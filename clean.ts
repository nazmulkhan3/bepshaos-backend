import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';
import { DatabaseService } from './src/database/database.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(DatabaseService);

  await prisma.supplierAddress.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.organizationMember.deleteMany({});
  await prisma.role.deleteMany({ where: { organizationId: { not: null } } });
  await prisma.organization.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('Database Cleaned');
  await app.close();
}
bootstrap();
