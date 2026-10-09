-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "serverCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "status",
ADD COLUMN     "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "Category_clientId_key" ON "Category"("clientId");

-- CreateIndex
CREATE INDEX "Category_organizationId_parentId_idx" ON "Category"("organizationId", "parentId");

-- CreateIndex
CREATE INDEX "Category_organizationId_status_idx" ON "Category"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Category_organizationId_createdAt_idx" ON "Category"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Product_organizationId_categoryId_idx" ON "Product"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "Product_organizationId_status_idx" ON "Product"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Product_organizationId_createdAt_idx" ON "Product"("organizationId", "createdAt");
