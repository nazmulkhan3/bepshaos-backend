-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'EXPENSE';

-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "category",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "categoryId" TEXT NOT NULL,
ADD COLUMN     "expenseNumber" TEXT NOT NULL,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "paymentAccountId" TEXT NOT NULL,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "status" "ExpenseStatus" NOT NULL DEFAULT 'COMPLETED';

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "expenseAccountId" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseCategory_organizationId_idx" ON "ExpenseCategory"("organizationId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_organizationId_isActive_idx" ON "ExpenseCategory"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_organizationId_code_key" ON "ExpenseCategory"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Expense_organizationId_idx" ON "Expense"("organizationId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_branchId_idx" ON "Expense"("organizationId", "branchId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_categoryId_idx" ON "Expense"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_status_idx" ON "Expense"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Expense_organizationId_paymentMethod_idx" ON "Expense"("organizationId", "paymentMethod");

-- CreateIndex
CREATE INDEX "Expense_organizationId_createdAt_idx" ON "Expense"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_expenseNumber_key" ON "Expense"("organizationId", "expenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_idempotencyKey_key" ON "Expense"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

