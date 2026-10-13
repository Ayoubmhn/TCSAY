-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "PointKind" AS ENUM ('NONE', 'ACE', 'DF', 'WINNER', 'UNFORCED', 'FORCED');

-- CreateTable
CREATE TABLE "Match" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "date" DATE NOT NULL,
    "court" TEXT,
    "playerAId" UUID,
    "playerAName" TEXT NOT NULL,
    "playerBId" UUID,
    "playerBName" TEXT NOT NULL,
    "setsToWin" INTEGER NOT NULL DEFAULT 2,
    "games" INTEGER NOT NULL DEFAULT 6,
    "tiebreak" BOOLEAN NOT NULL DEFAULT true,
    "superTB" BOOLEAN NOT NULL DEFAULT false,
    "noAd" BOOLEAN NOT NULL DEFAULT false,
    "firstServer" INTEGER,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "winner" INTEGER,
    "score" TEXT,
    "stats" JSONB,
    "endReason" TEXT,
    "createdById" UUID NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPoint" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "winner" INTEGER NOT NULL,
    "firstIn" BOOLEAN NOT NULL,
    "kind" "PointKind" NOT NULL DEFAULT 'NONE',
    "shot" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Match_date_idx" ON "Match"("date");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPoint_matchId_seq_key" ON "MatchPoint"("matchId", "seq");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_playerAId_fkey" FOREIGN KEY ("playerAId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_playerBId_fkey" FOREIGN KEY ("playerBId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPoint" ADD CONSTRAINT "MatchPoint_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPoint" ADD CONSTRAINT "MatchPoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Nouvelle autorisation « Matchs » : directeur technique par défaut (bases déjà réglées seulement)
INSERT INTO "RolePermission" ("role", "permission")
SELECT 'TECH_DIRECTOR', 'matches.manage'
WHERE EXISTS (SELECT 1 FROM "RolePermission")
ON CONFLICT DO NOTHING;
