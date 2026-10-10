-- Compte fédération (IJIN) facultatif : deux colonnes vides ajoutées aux comptes. Aucune donnée modifiée.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ijinLogin" TEXT,
ADD COLUMN     "ijinPasswordEnc" TEXT;
