-- AlterEnum
ALTER TYPE "PaymentPlan" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "templateId" UUID;

-- CreateTable
CREATE TABLE "PaymentTemplate" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "monthlyDay" INTEGER NOT NULL DEFAULT 5,
    "months" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "deposit" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL DEFAULT 'ALL',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "lateMode" TEXT NOT NULL DEFAULT 'MERGE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTemplate_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PaymentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

