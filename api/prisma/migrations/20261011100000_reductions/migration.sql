-- Réductions sur la cotisation (fratrie, spéciale, exonération) : colonnes ajoutées, vides pour les cotisations existantes.
-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('SIBLING', 'SPECIAL', 'EXEMPT');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "baseAmount" DECIMAL(10,3),
ADD COLUMN     "discountAmount" DECIMAL(10,3),
ADD COLUMN     "discountKind" "DiscountKind",
ADD COLUMN     "discountPercent" DECIMAL(5,2),
ADD COLUMN     "discountReason" TEXT;

