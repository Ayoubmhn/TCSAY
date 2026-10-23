-- Guide de première utilisation : étapes vues par compte
ALTER TABLE "User" ADD COLUMN     "guideSeen" TEXT[] DEFAULT ARRAY[]::TEXT[];
