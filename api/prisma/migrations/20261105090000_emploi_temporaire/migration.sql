-- CreateEnum
CREATE TYPE "TempScheduleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "TempScheduleMode" AS ENUM ('REPLACE', 'ADD');

-- AlterTable
ALTER TABLE "GroupSlot" ADD COLUMN     "scheduleId" UUID;

-- CreateTable
CREATE TABLE "TempSchedule" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "note" TEXT,
    "status" "TempScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TempSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempScheduleGroup" (
    "scheduleId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "mode" "TempScheduleMode" NOT NULL DEFAULT 'REPLACE',

    CONSTRAINT "TempScheduleGroup_pkey" PRIMARY KEY ("scheduleId","groupId")
);

-- CreateIndex
CREATE INDEX "TempSchedule_seasonId_status_idx" ON "TempSchedule"("seasonId", "status");

-- CreateIndex
CREATE INDEX "TempScheduleGroup_groupId_idx" ON "TempScheduleGroup"("groupId");

-- CreateIndex
CREATE INDEX "GroupSlot_scheduleId_idx" ON "GroupSlot"("scheduleId");

-- AddForeignKey
ALTER TABLE "GroupSlot" ADD CONSTRAINT "GroupSlot_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "TempSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TempSchedule" ADD CONSTRAINT "TempSchedule_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TempScheduleGroup" ADD CONSTRAINT "TempScheduleGroup_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "TempSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TempScheduleGroup" ADD CONSTRAINT "TempScheduleGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

