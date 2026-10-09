const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const fks = await client.query(
    `SELECT t.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname IN ('Sale','SaleItem','InventoryMovement')
     ORDER BY t.relname, c.conname`
  );
  console.log(JSON.stringify(fks.rows, null, 2));
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });