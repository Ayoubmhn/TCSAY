-- File d'envoi des emails : statut « en attente », nombre de tentatives, date d'envoi.
ALTER TYPE "EmailStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'SENT';

ALTER TABLE "EmailLog" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sentAt" TIMESTAMP(3);

-- Historique existant : une tentative, envoyé à la date de création.
UPDATE "EmailLog" SET "attempts" = 1;
UPDATE "EmailLog" SET "sentAt" = "createdAt" WHERE "status" = 'SENT';

CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");
