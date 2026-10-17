-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "ijinLogin" TEXT,
ADD COLUMN     "ijinPasswordEnc" TEXT;


-- Nouvelles autorisations (bases déjà réglées seulement) : comptes IJIN et dépenses pour l'agent administratif,
-- tournois pour le directeur technique.
INSERT INTO "RolePermission" ("role", "permission")
SELECT r.role::"Role", r.permission
FROM (VALUES ('ADMIN_AGENT', 'federation.manage'), ('ADMIN_AGENT', 'expenses.manage'), ('TECH_DIRECTOR', 'tournaments.manage')) AS r(role, permission)
WHERE EXISTS (SELECT 1 FROM "RolePermission")
ON CONFLICT DO NOTHING;
