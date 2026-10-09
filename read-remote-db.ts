import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';
import { DatabaseService } from './src/database/database.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(DatabaseService);

  console.log("=== Inspecting tables ===");
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`;
  console.log(JSON.stringify(tables, null, 2));

  console.log("\n=== Inspecting Supplier columns ===");
  const columns = await prisma.$queryRaw`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Supplier'`;
  console.log(JSON.stringify(columns, null, 2));

  console.log("\n=== Inspecting Supplier indexes ===");
  const indexes = await prisma.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Supplier'`;
  console.log(JSON.stringify(indexes, null, 2));

  console.log("\n=== Inspecting _prisma_migrations ===");
  const migrations = await prisma.$queryRaw`SELECT id, migration_name, started_at, finished_at, applied_steps_count, rolled_back_at FROM _prisma_migrations`;
  console.log(JSON.stringify(migrations, null, 2));

  await app.close();
}
bootstrap();
