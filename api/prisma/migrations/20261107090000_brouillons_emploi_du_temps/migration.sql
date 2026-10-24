-- Plusieurs brouillons nommés de l'emploi du temps par saison (le brouillon existant garde ses changements).
ALTER TABLE "TimetableDraft" DROP CONSTRAINT "TimetableDraft_pkey",
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Brouillon',
ADD CONSTRAINT "TimetableDraft_pkey" PRIMARY KEY ("id");

ALTER TABLE "TimetableDraft" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "name" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "TimetableDraft_seasonId_idx" ON "TimetableDraft"("seasonId");
