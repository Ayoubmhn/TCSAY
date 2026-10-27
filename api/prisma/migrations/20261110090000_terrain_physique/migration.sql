-- Terrain réservé aux séances physiques (ex. Annexe).
ALTER TABLE "Court" ADD COLUMN "physicalOnly" BOOLEAN NOT NULL DEFAULT false;
