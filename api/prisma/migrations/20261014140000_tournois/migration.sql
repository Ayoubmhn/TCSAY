-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION', 'RUNNING', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('KNOCKOUT', 'ROUND_ROBIN');

-- AlterEnum
ALTER TYPE "ReservationType" ADD VALUE 'TOURNAMENT';

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "position" INTEGER,
ADD COLUMN     "reservationId" UUID,
ADD COLUMN     "round" INTEGER,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "tournamentId" UUID;

-- CreateTable
CREATE TABLE "Tournament" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "eligibility" JSONB NOT NULL,
    "format" "TournamentFormat" NOT NULL DEFAULT 'KNOCKOUT',
    "maxPlayers" INTEGER NOT NULL DEFAULT 16,
    "fee" DECIMAL(10,3),
    "familyRequest" BOOLEAN NOT NULL DEFAULT false,
    "setsToWin" INTEGER NOT NULL DEFAULT 2,
    "games" INTEGER NOT NULL DEFAULT 6,
    "tiebreak" BOOLEAN NOT NULL DEFAULT true,
    "superTB" BOOLEAN NOT NULL DEFAULT false,
    "noAd" BOOLEAN NOT NULL DEFAULT false,
    "courtIds" UUID[],
    "dayStart" TEXT NOT NULL DEFAULT '09:00',
    "dayEnd" TEXT NOT NULL DEFAULT '18:00',
    "matchMinutes" INTEGER NOT NULL DEFAULT 90,
    "restMinutes" INTEGER NOT NULL DEFAULT 60,
    "status" "TournamentStatus" NOT NULL DEFAULT 'REGISTRATION',
    "winnerName" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentEntry" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "playerId" UUID,
    "name" TEXT NOT NULL,
    "seed" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "derogationReason" TEXT,
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionChange" (
    "id" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "courtId" UUID,
    "reason" TEXT NOT NULL,
    "tournamentId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tournament_startDate_idx" ON "Tournament"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentEntry_tournamentId_playerId_key" ON "TournamentEntry"("tournamentId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionChange_slotId_date_key" ON "SessionChange"("slotId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Match_reservationId_key" ON "Match"("reservationId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionChange" ADD CONSTRAINT "SessionChange_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "GroupSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionChange" ADD CONSTRAINT "SessionChange_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionChange" ADD CONSTRAINT "SessionChange_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

