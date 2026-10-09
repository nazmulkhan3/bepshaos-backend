-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Supplier" DROP COLUMN "address",
DROP COLUMN "openingBalance",
ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "avatar" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "supplierCode" TEXT NOT NULL,
ADD COLUMN     "taxNumber" TEXT,
ADD COLUMN     "website" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "SupplierAddress" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "label" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "area" TEXT,
    "city" TEXT,
    "district" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierAddress_supplierId_idx" ON "SupplierAddress"("supplierId");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_status_idx" ON "Supplier"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_createdAt_idx" ON "Supplier"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_organizationId_supplierCode_key" ON "Supplier"("organizationId", "supplierCode");

-- AddForeignKey
ALTER TABLE "SupplierAddress" ADD CONSTRAINT "SupplierAddress_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
