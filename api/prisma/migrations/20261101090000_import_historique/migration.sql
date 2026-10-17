-- CreateEnum
CREATE TYPE "HistoricalKind" AS ENUM ('INCOME', 'EXPENSE');

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "importBatchId" UUID;

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "register" TEXT,
ADD COLUMN     "rowCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "HistoricalEntry" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "kind" "HistoricalKind" NOT NULL,
    "category" TEXT NOT NULL,
    "date" DATE,
    "label" TEXT NOT NULL,
    "person" TEXT,
    "playerId" UUID,
    "amount" DECIMAL(10,3) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "sourceRef" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricalEntry_seasonId_kind_idx" ON "HistoricalEntry"("seasonId", "kind");

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalEntry" ADD CONSTRAINT "HistoricalEntry_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalEntry" ADD CONSTRAINT "HistoricalEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalEntry" ADD CONSTRAINT "HistoricalEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

