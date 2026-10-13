-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "level" TEXT,
ADD COLUMN     "levelUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "strengths" TEXT,
    "toWork" TEXT,
    "goals" TEXT,
    "proposedLevel" TEXT,
    "levelValidatedAt" TIMESTAMP(3),
    "levelValidatedById" UUID,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "authorId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_playerId_seasonId_period_key" ON "Evaluation"("playerId", "seasonId", "period");

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_levelValidatedById_fkey" FOREIGN KEY ("levelValidatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Nouvelle autorisation « Suivi technique » : directeur technique par défaut (bases déjà réglées seulement)
INSERT INTO "RolePermission" ("role", "permission")
SELECT 'TECH_DIRECTOR', 'evaluations.manage'
WHERE EXISTS (SELECT 1 FROM "RolePermission")
ON CONFLICT DO NOTHING;
