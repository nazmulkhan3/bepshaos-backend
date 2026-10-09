const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
  console.log("=== Inspecting tables ===");
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`;
  console.log(tables.map(t => t.tablename));

  console.log("\n=== Inspecting Supplier columns ===");
  try {
    const columns = await prisma.$queryRaw`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Supplier'`;
    console.log(columns);
  } catch (e) {
    console.log("Error reading Supplier columns", e);
  }

  console.log("\n=== Inspecting Supplier indexes ===");
  try {
    const indexes = await prisma.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Supplier'`;
    console.log(indexes);
  } catch (e) {
    console.log("Error reading Supplier indexes", e);
  }

  console.log("\n=== Inspecting _prisma_migrations ===");
  try {
    const migrations = await prisma.$queryRaw`SELECT id, migration_name, started_at, finished_at, applied_steps_count, rolled_back_at FROM _prisma_migrations`;
    console.log(migrations);
  } catch (e) {
    console.log("Error reading migrations", e);
  }
}

inspect().finally(() => prisma.$disconnect());
