-- Tournoi : visibilité des résultats, direct, publication du tableau, arbitre par défaut
ALTER TABLE "Tournament" ADD COLUMN "resultsPublic" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tournament" ADD COLUMN "liveScoring" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tournament" ADD COLUMN "drawPublished" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tournament" ADD COLUMN "refereeUserId" UUID;
ALTER TABLE "Tournament" ADD COLUMN "refereeName" TEXT;

-- Inscription payante réglée
ALTER TABLE "TournamentEntry" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "TournamentEntry" ADD COLUMN "paidById" UUID;

-- Arbitre du match
ALTER TABLE "Match" ADD COLUMN "refereeUserId" UUID;
ALTER TABLE "Match" ADD COLUMN "refereeName" TEXT;
