-- Identifiant du club pour chaque joueur : « 26TCSAY052 » (année de première inscription, TCSAY, n° dans l'année).
-- Ajoute des colonnes ; les joueurs existants reçoivent un code PROVISOIRE (aucune donnée supprimée).
ALTER TABLE "Player" ADD COLUMN     "memberCode" TEXT,
ADD COLUMN     "memberCodeProvisional" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "memberSeq" INTEGER,
ADD COLUMN     "memberYear" INTEGER;

-- Joueurs existants : année de la première saison où ils sont inscrits (sinon année de création), n° par ordre de création.
WITH first AS (
  SELECT p.id, p."createdAt",
         COALESCE(MIN(EXTRACT(YEAR FROM s."startDate"))::int, EXTRACT(YEAR FROM p."createdAt")::int) AS y
  FROM "Player" p
  LEFT JOIN "Enrollment" e ON e."playerId" = p.id
  LEFT JOIN "Season" s ON s.id = e."seasonId"
  GROUP BY p.id
), num AS (
  SELECT id, y, ROW_NUMBER() OVER (PARTITION BY y ORDER BY "createdAt", id) AS n FROM first
)
UPDATE "Player" p
SET "memberYear" = num.y,
    "memberSeq" = num.n,
    "memberCode" = LPAD((num.y % 100)::text, 2, '0') || 'TCSAY' || LPAD(num.n::text, 3, '0')
FROM num WHERE num.id = p.id;

CREATE UNIQUE INDEX "Player_memberCode_key" ON "Player"("memberCode");
CREATE UNIQUE INDEX "Player_memberYear_memberSeq_key" ON "Player"("memberYear", "memberSeq");
