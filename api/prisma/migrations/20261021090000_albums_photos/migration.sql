-- Albums photos (tournois, matchs, groupes, événements) et autorisation photo des joueurs.
-- CreateEnum
CREATE TYPE "AlbumKind" AS ENUM ('TOURNAMENT', 'MATCH', 'GROUP', 'EVENT', 'FREE');

-- CreateEnum
CREATE TYPE "AlbumAudience" AS ENUM ('CONTEXT', 'EVERYONE', 'CUSTOM');

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "photoConsent" BOOLEAN,
ADD COLUMN     "photoConsentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Album" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "AlbumKind" NOT NULL,
    "audience" "AlbumAudience" NOT NULL DEFAULT 'CONTEXT',
    "date" DATE NOT NULL,
    "tournamentId" UUID,
    "matchId" UUID,
    "groupId" UUID,
    "eventId" UUID,
    "createdById" UUID NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumMember" (
    "id" UUID NOT NULL,
    "albumId" UUID NOT NULL,
    "userId" UUID,
    "playerId" UUID,

    CONSTRAINT "AlbumMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumPhoto" (
    "id" UUID NOT NULL,
    "albumId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "caption" TEXT,
    "uploadedById" UUID NOT NULL,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" UUID,
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoTag" (
    "photoId" UUID NOT NULL,
    "playerId" UUID NOT NULL,

    CONSTRAINT "PhotoTag_pkey" PRIMARY KEY ("photoId","playerId")
);

-- CreateIndex
CREATE INDEX "Album_kind_date_idx" ON "Album"("kind", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumMember_albumId_userId_key" ON "AlbumMember"("albumId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumMember_albumId_playerId_key" ON "AlbumMember"("albumId", "playerId");

-- CreateIndex
CREATE INDEX "AlbumPhoto_albumId_idx" ON "AlbumPhoto"("albumId");

-- CreateIndex
CREATE INDEX "PhotoTag_playerId_idx" ON "PhotoTag"("playerId");

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumMember" ADD CONSTRAINT "AlbumMember_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumMember" ADD CONSTRAINT "AlbumMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumMember" ADD CONSTRAINT "AlbumMember_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumPhoto" ADD CONSTRAINT "AlbumPhoto_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "AlbumPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

