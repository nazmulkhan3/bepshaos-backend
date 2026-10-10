#!/usr/bin/env node
/**
 * Phase 2B: Non-destructive DDL migration for Purchase Landed Costs
 * Adds columns to Purchase and PurchaseItem, backfills historical rows.
 * Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS).
 */
const fs = require('fs');
const path = require('path');

// Load DATABASE_URL from .env if not already set
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (match) process.env.DATABASE_URL = match[1];
}

const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('✓ Connected to database');

  // ── 1. Add columns to Purchase ─────────────────────────────────────────────
  await client.query(`
    ALTER TABLE "Purchase"
      ADD COLUMN IF NOT EXISTS freight              DECIMAL(19,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS loading              DECIMAL(19,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS handling             DECIMAL(19,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "clearingCharges"    DECIMAL(19,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "otherCosts"         DECIMAL(19,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "landedCostTotal"    DECIMAL(19,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "capitalizableCost"  DECIMAL(19,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "linkedExpenseId"    TEXT
  `);
  console.log('✓ Purchase: landed cost columns ensured');

  // ── 2. Backfill existing Purchase rows ─────────────────────────────────────
  // For historical purchases: capitalizableCost = total (since no landed costs were recorded)
  const { rowCount: purUpdated } = await client.query(`
    UPDATE "Purchase"
    SET "capitalizableCost" = total
    WHERE "capitalizableCost" = 0 AND total > 0
  `);
  console.log(`✓ Purchase: backfilled ${purUpdated} historical rows (capitalizableCost = total)`);

  // ── 3. Add columns to PurchaseItem ─────────────────────────────────────────
  await client.query(`
    ALTER TABLE "PurchaseItem"
      ADD COLUMN IF NOT EXISTS "landedCostAllocation"    DECIMAL(19,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "totalCapitalizableCost"  DECIMAL(19,4) NOT NULL DEFAULT 0
  `);
  console.log('✓ PurchaseItem: allocation columns ensured');

  // ── 4. Backfill existing PurchaseItem rows ─────────────────────────────────
  // For historical items: totalCapitalizableCost = lineTotal (no landed cost allocated)
  const { rowCount: itemUpdated } = await client.query(`
    UPDATE "PurchaseItem"
    SET "totalCapitalizableCost" = "lineTotal"
    WHERE "totalCapitalizableCost" = 0 AND "lineTotal" > 0
  `);
  console.log(`✓ PurchaseItem: backfilled ${itemUpdated} historical rows (totalCapitalizableCost = lineTotal)`);

  // ── 5. Verify columns exist ────────────────────────────────────────────────
  const { rows: purchaseColumns } = await client.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'Purchase'
      AND column_name IN ('freight','loading','handling','clearingCharges','otherCosts','landedCostTotal','capitalizableCost')
    ORDER BY column_name
  `);
  console.log('✓ Purchase columns verified:', purchaseColumns.map(r => r.column_name).join(', '));

  const { rows: itemColumns } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'PurchaseItem'
      AND column_name IN ('landedCostAllocation','totalCapitalizableCost')
    ORDER BY column_name
  `);
  console.log('✓ PurchaseItem columns verified:', itemColumns.map(r => r.column_name).join(', '));

  await client.end();
  console.log('\n✅ Phase 2B migration completed successfully');
}

main().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
