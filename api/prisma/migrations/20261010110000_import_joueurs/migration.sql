-- Import du cahier des joueurs : colonnes ajoutées (vides pour les joueurs existants), date de naissance facultative.
-- Aucune donnée supprimée ni modifiée.
-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "birthYearOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "importRef" TEXT,
ADD COLUMN     "nameAr" TEXT,
ADD COLUMN     "notes" TEXT,
ALTER COLUMN "birthDate" DROP NOT NULL;

