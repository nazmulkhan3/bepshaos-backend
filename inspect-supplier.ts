import { Client } from 'pg';
import { config } from 'dotenv';
config();

async function inspectSupplier() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log("=== Inspecting Supplier rows ===");
  const countRes = await client.query(`SELECT COUNT(*) as count FROM "Supplier"`);
  console.log("Total Supplier rows:", countRes.rows[0].count);

  const orgCountRes = await client.query(`SELECT COUNT(DISTINCT "organizationId") as count FROM "Supplier"`);
  console.log("Total unique organizations in Supplier:", orgCountRes.rows[0].count);

  console.log("\n=== Checking existing data for backfill ===");
  const dataRes = await client.query(`SELECT id, "organizationId", "createdAt" FROM "Supplier" LIMIT 10`);
  console.log(JSON.stringify(dataRes.rows, null, 2));

  await client.end();
}
inspectSupplier();
