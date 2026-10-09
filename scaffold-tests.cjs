const fs = require('fs');

function transform(inFile, outFile) {
  let content = fs.readFileSync(inFile, 'utf8');

  // Regex replacements
  content = content.replace(/sale/g, 'purchase');
  content = content.replace(/Sale/g, 'Purchase');
  content = content.replace(/SALE/g, 'PURCHASE');
  content = content.replace(/customerId/g, 'supplierId');
  content = content.replace(/customer/g, 'supplier');
  content = content.replace(/Customer/g, 'Supplier');
  content = content.replace(/unitPrice/g, 'unitCost');
  content = content.replace(/discountAmount/g, 'discount');
  content = content.replace(/taxAmount/g, 'tax');
  content = content.replace(/STOCK_OUT/g, 'TEMP_STOCK_OUT');
  content = content.replace(/STOCK_IN/g, 'STOCK_OUT');
  content = content.replace(/TEMP_STOCK_OUT/g, 'STOCK_IN');
  // In sales, creating deducts (STOCK_OUT), cancelling restores (STOCK_IN)
  // In purchases, creating increases (STOCK_IN), cancelling reduces (STOCK_OUT).
  // I just swapped them.

  fs.writeFileSync(outFile, content, 'utf8');
  console.log(`Transformed ${inFile} to ${outFile}`);
}

transform('test/sales.e2e-spec.ts', 'test/purchase.e2e-spec.ts');
transform('test/sales-hardening.e2e-spec.ts', 'test/purchase-hardening.e2e-spec.ts');
