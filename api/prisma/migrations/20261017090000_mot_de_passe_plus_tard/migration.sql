-- Mot de passe temporaire gardé (« Modifier plus tard »)
ALTER TABLE "User" ADD COLUMN "temporaryPassword" BOOLEAN NOT NULL DEFAULT false;
