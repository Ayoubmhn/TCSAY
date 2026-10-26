-- Vacances : séances habituelles retirées dues par le club (à rattraper) ou non.
ALTER TABLE "TempSchedule" ADD COLUMN "sessionsOwed" BOOLEAN NOT NULL DEFAULT false;
