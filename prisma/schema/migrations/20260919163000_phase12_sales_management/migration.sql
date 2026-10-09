-- Phase 12 Sales & POS Management Safe Migration
-- Safely adding columns, constraints, and indexes for Sale and SaleItem without data loss.

-- 1. Sale columns
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "saleNumber" TEXT;
UPDATE "Sale" SET "saleNumber" = "invoiceNumber" WHERE "saleNumber" IS NULL AND "invoiceNumber" IS NOT NULL;
UPDATE "Sale" SET "saleNumber" = 'SALE-' || LPAD(SUBSTRING(id FROM 1 FOR 6), 6, '0') WHERE "saleNumber" IS NULL;
ALTER TABLE "Sale" ALTER COLUMN "saleNumber" SET NOT NULL;
ALTER TABLE "Sale" ALTER COLUMN "invoiceNumber" DROP NOT NULL;
ALTER TABLE "Sale" ALTER COLUMN "status" SET DEFAULT 'COMPLETED';
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "requestHash" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT;

-- 2. Sale constraints & indexes
DROP INDEX IF EXISTS "Sale_organizationId_invoiceNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Sale_organizationId_saleNumber_key" ON "Sale"("organizationId", "saleNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Sale_organizationId_idempotencyKey_key" ON "Sale"("organizationId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "Sale_organizationId_idx" ON "Sale"("organizationId");
CREATE INDEX IF NOT EXISTS "Sale_organizationId_branchId_idx" ON "Sale"("organizationId", "branchId");
CREATE INDEX IF NOT EXISTS "Sale_organizationId_customerId_idx" ON "Sale"("organizationId", "customerId");
CREATE INDEX IF NOT EXISTS "Sale_organizationId_status_idx" ON "Sale"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Sale_organizationId_createdAt_idx" ON "Sale"("organizationId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Sale_createdBy_fkey') THEN
    ALTER TABLE "Sale" ADD CONSTRAINT "Sale_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Sale_cancelledBy_fkey') THEN
    ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. SaleItem columns & indexes
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "SaleItem_saleId_productId_key" ON "SaleItem"("saleId", "productId");
CREATE INDEX IF NOT EXISTS "SaleItem_saleId_idx" ON "SaleItem"("saleId");
CREATE INDEX IF NOT EXISTS "SaleItem_productId_idx" ON "SaleItem"("productId");
