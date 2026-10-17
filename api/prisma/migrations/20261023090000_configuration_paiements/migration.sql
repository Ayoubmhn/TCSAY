-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'TRANSFER';

-- AlterEnum
ALTER TYPE "PaymentPlan" ADD VALUE 'QUARTER';

-- AlterTable
ALTER TABLE "Installment" ADD COLUMN     "relanceAt" TIMESTAMP(3),
ADD COLUMN     "relanceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "batchId" UUID;

