-- Phase 11 Inventory Management Safe Migration
-- Safely adding columns and indexes to existing tables without affecting drift.

-- Inventory changes
ALTER TABLE "Inventory" ADD COLUMN IF NOT EXISTS "reservedQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "Inventory_branchId_productId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Inventory_organizationId_branchId_productId_key" ON "Inventory"("organizationId", "branchId", "productId");
CREATE INDEX IF NOT EXISTS "Inventory_organizationId_idx" ON "Inventory"("organizationId");
CREATE INDEX IF NOT EXISTS "Inventory_organizationId_branchId_idx" ON "Inventory"("organizationId", "branchId");
CREATE INDEX IF NOT EXISTS "Inventory_organizationId_productId_idx" ON "Inventory"("organizationId", "productId");
CREATE INDEX IF NOT EXISTS "Inventory_organizationId_updatedAt_idx" ON "Inventory"("organizationId", "updatedAt");

-- InventoryMovement changes
ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "note" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryMovement_organizationId_idempotencyKey_key" ON "InventoryMovement"("organizationId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "InventoryMovement_organizationId_idx" ON "InventoryMovement"("organizationId");
CREATE INDEX IF NOT EXISTS "InventoryMovement_organizationId_branchId_idx" ON "InventoryMovement"("organizationId", "branchId");
CREATE INDEX IF NOT EXISTS "InventoryMovement_organizationId_createdAt_idx" ON "InventoryMovement"("organizationId", "createdAt");

-- Note: The existing InventoryMovement_organizationId_productId_idx and InventoryMovement_organizationId_movementType_idx were already in the schema, but we'll ensure they exist just in case.
CREATE INDEX IF NOT EXISTS "InventoryMovement_organizationId_productId_idx" ON "InventoryMovement"("organizationId", "productId");
CREATE INDEX IF NOT EXISTS "InventoryMovement_organizationId_movementType_idx" ON "InventoryMovement"("organizationId", "movementType");
