const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const migrations = await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count
     FROM _prisma_migrations ORDER BY started_at`
  );
  console.log('=== MIGRATIONS ===');
  console.log(JSON.stringify(migrations.rows, null, 2));

  const saleCols = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default, numeric_precision, numeric_scale
     FROM information_schema.columns WHERE table_name='Sale' ORDER BY ordinal_position`
  );
  console.log('=== SALE COLUMNS ===');
  console.log(JSON.stringify(saleCols.rows, null, 2));

  const saleItems = await client.query(
    `SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
     FROM information_schema.columns WHERE table_name='SaleItem' ORDER BY ordinal_position`
  );
  console.log('=== SALEITEM COLUMNS ===');
  console.log(JSON.stringify(saleItems.rows, null, 2));

  const indexes = await client.query(
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename IN ('Sale','SaleItem') ORDER BY tablename, indexname`
  );
  console.log('=== INDEXES ===');
  console.log(JSON.stringify(indexes.rows, null, 2));

  const constraints = await client.query(
    `SELECT conname, conrelid::regclass AS table_name, pg_get_constraintdef(oid) AS def
     FROM pg_constraint WHERE conrelid::regclass::text IN ('Sale','SaleItem') ORDER BY table_name, conname`
  );
  console.log('=== CONSTRAINTS ===');
  console.log(JSON.stringify(constraints.rows, null, 2));

  const invCols = await client.query(
    `SELECT column_name, data_type, numeric_precision, numeric_scale
     FROM information_schema.columns WHERE table_name='InventoryMovement' ORDER BY ordinal_position`
  );
  console.log('=== INVENTORYMOVEMENT COLUMNS ===');
  console.log(JSON.stringify(invCols.rows, null, 2));

  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });