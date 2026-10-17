-- CreateEnum
CREATE TYPE "SeasonReportKind" AS ENUM ('MORAL', 'FINANCIAL');

-- CreateTable
CREATE TABLE "SeasonReportFile" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "kind" "SeasonReportKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,

    CONSTRAINT "SeasonReportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonReportDraft" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "kind" "SeasonReportKind" NOT NULL,
    "texts" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonReportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeasonReportFile_seasonId_kind_idx" ON "SeasonReportFile"("seasonId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonReportDraft_seasonId_kind_key" ON "SeasonReportDraft"("seasonId", "kind");

-- AddForeignKey
ALTER TABLE "SeasonReportFile" ADD CONSTRAINT "SeasonReportFile_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonReportDraft" ADD CONSTRAINT "SeasonReportDraft_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

