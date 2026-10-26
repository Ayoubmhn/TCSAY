-- Séances ponctuelles (rattrapage, séance en plus, séance spéciale) : emploi temporaire d'un seul jour.
CREATE TYPE "TempScheduleKind" AS ENUM ('HOLIDAY', 'ONE_OFF');
ALTER TABLE "TempSchedule" ADD COLUMN "kind" "TempScheduleKind" NOT NULL DEFAULT 'HOLIDAY';
ALTER TABLE "TempSchedule" ADD COLUMN "oneOffType" TEXT;
ALTER TABLE "TempSchedule" ADD COLUMN "makeupSlotId" UUID;
ALTER TABLE "TempSchedule" ADD COLUMN "makeupDate" DATE;
