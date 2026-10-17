-- Nouveaux acteurs (migration séparée : une valeur d'enum ajoutée ne peut pas servir dans la même transaction).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PRESIDENT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN_AGENT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPERVISOR';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TECH_DIRECTOR';
ALTER TYPE "CategoryFamily" ADD VALUE IF NOT EXISTS 'LEISURE';
