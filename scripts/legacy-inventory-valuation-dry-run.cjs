#!/usr/bin/env node
/**
 * Phase 2B: Legacy Inventory Valuation Dry-Run Script
 * Inspects inventory rows with averageCost = 0, calculates proposed MWAC based on verified
 * purchase history (or catalog purchase price), and generates an audit report with
 * reconciliation decisions WITHOUT modifying any records.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^DATABASE_URL="?([^"\n]+)"?/m);
    if (match) process.env.DATABASE_URL = match[1];
  }
}

async function runDryRun() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('   BEBSHAOS PHASE 2B: LEGACY INVENTORY VALUATION DRY-RUN AUDIT REPORT           ');
  console.log('   (DRY RUN ONLY — NO DATABASE RECORDS ARE MODIFIED)                           ');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  // Query inventory with zero averageCost and quantity > 0
  const { rows: items } = await client.query(`
    SELECT 
      i.id AS "inventoryId",
      i."organizationId",
      i."branchId",
      i."productId",
      i.quantity,
      i."averageCost",
      p.name AS "productName",
      p.sku,
      p."purchasePrice" AS "catalogPrice",
      b.name AS "branchName"
    FROM "Inventory" i
    JOIN "Product" p ON p.id = i."productId"
    JOIN "Branch" b ON b.id = i."branchId"
    WHERE i."averageCost" = 0 AND i.quantity > 0
    ORDER BY b.name, p.name;
  `);

  if (items.length === 0) {
    console.log('✓ No active inventory items found with averageCost = 0. Stock valuation is healthy.\n');
    await client.end();
    return;
  }

  console.log(`Found ${items.length} inventory records with averageCost = 0 and active stock.\n`);

  let totalValuationDifference = 0;
  let manualReviewCount = 0;
  const reportRows = [];

  for (const item of items) {
    // Look up historical purchases for this product in this branch
    const { rows: purchases } = await client.query(`
      SELECT 
        pi.quantity,
        pi."unitCost",
        pi."totalCapitalizableCost",
        p."purchaseNumber"
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p.id = pi."purchaseId"
      WHERE pi."productId" = $1 AND p."branchId" = $2 AND p.status = 'COMPLETED'
      ORDER BY p."createdAt" DESC
      LIMIT 1;
    `, [item.productId, item.branchId]);

    let proposedUnitCost = 0;
    let source = 'NONE';

    if (purchases.length > 0) {
      const p = purchases[0];
      if (Number(p.totalCapitalizableCost) > 0 && Number(p.quantity) > 0) {
        proposedUnitCost = Number(p.totalCapitalizableCost) / Number(p.quantity);
        source = `PURCHASE (${p.purchaseNumber})`;
      } else if (Number(p.unitCost) > 0) {
        proposedUnitCost = Number(p.unitCost);
        source = `PURCHASE_UNIT (${p.purchaseNumber})`;
      }
    }

    if (proposedUnitCost === 0 && Number(item.catalogPrice) > 0) {
      proposedUnitCost = Number(item.catalogPrice);
      source = 'CATALOG_FALLBACK (Product.purchasePrice)';
      manualReviewCount++;
    }

    if (proposedUnitCost === 0) {
      manualReviewCount++;
    }

    const currentValuation = 0;
    const proposedValuation = Number(item.quantity) * proposedUnitCost;
    const difference = proposedValuation - currentValuation;
    totalValuationDifference += difference;

    reportRows.push({
      Branch: item.branchName,
      Product: `${item.productName} (${item.sku || 'No SKU'})`,
      Quantity: Number(item.quantity).toFixed(2),
      'Current Cost': Number(item.averageCost).toFixed(4),
      'Proposed Cost': proposedUnitCost.toFixed(4),
      'Valuation Delta': difference.toFixed(2),
      Source: source,
      'Reconciliation Decision': difference > 0
        ? 'Debit Inventory Asset 1200 / Credit Owner Equity 3000'
        : 'No adjustment required'
    });
  }

  console.table(reportRows);

  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log(`SUMMARY:`);
  console.log(`  Total affected items:             ${items.length}`);
  console.log(`  Total proposed valuation delta:   ${totalValuationDifference.toFixed(4)} BDT`);
  console.log(`  Items requiring manual review:    ${manualReviewCount}`);
  console.log(`────────────────────────────────────────────────────────────────────────────────`);
  console.log(`RECOMMENDED ACCOUNTING RECONCILIATION:`);
  console.log(`  To bring zero-cost legacy stock onto the verified double-entry balance sheet,`);
  console.log(`  create a manual journal entry:`);
  console.log(`    DEBIT:  1200 Inventory Asset                            +${totalValuationDifference.toFixed(4)}`);
  console.log(`    CREDIT: 3000 Owner Equity (Opening Balance Equity)       +${totalValuationDifference.toFixed(4)}`);
  console.log(`  DO NOT silently overwrite historical transaction rows or purchase orders.`);
  console.log(`════════════════════════════════════════════════════════════════════════════════\n`);

  await client.end();
}

runDryRun().catch((err) => {
  console.error('Dry-run audit error:', err);
  process.exit(1);
});
