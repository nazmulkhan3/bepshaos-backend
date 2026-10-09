import { Client } from 'pg';
import { config } from 'dotenv';
config();

async function inspect() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log("=== Inspecting tables ===");
  const tables = await client.query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`);
  console.log(JSON.stringify(tables.rows.map(r => r.tablename), null, 2));

  console.log("\n=== Inspecting Supplier columns ===");
  const columns = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Supplier'`);
  console.log(JSON.stringify(columns.rows, null, 2));

  console.log("\n=== Inspecting Supplier indexes ===");
  const indexes = await client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Supplier'`);
  console.log(JSON.stringify(indexes.rows, null, 2));

  console.log("\n=== Inspecting _prisma_migrations ===");
  const migrations = await client.query(`SELECT id, migration_name, started_at, finished_at, applied_steps_count, rolled_back_at FROM _prisma_migrations`);
  console.log(JSON.stringify(migrations.rows, null, 2));

  await client.end();
}
inspect();
