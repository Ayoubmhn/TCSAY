-- Photos de profil (comptes et joueurs sans compte).
CREATE TABLE "ProfilePhoto" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "playerId" UUID,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProfilePhoto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProfilePhoto_userId_key" ON "ProfilePhoto"("userId");
CREATE UNIQUE INDEX "ProfilePhoto_playerId_key" ON "ProfilePhoto"("playerId");
ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
