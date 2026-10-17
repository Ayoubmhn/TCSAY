-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('UTILITIES', 'EQUIPMENT', 'MAINTENANCE', 'TAX', 'SOCIAL', 'INSURANCE', 'FEDERATION', 'TRAVEL', 'SERVICES', 'OTHER');

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "supplier" TEXT,
    "reference" TEXT,
    "amount" DECIMAL(10,3) NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "paidAt" DATE,
    "method" TEXT,
    "note" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "fileData" BYTEA,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

