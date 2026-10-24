// Volume par semaine des groupes déduit de leurs créneaux habituels (grille de l'emploi du temps) : total des minutes,
// durée d'une séance si toutes les séances ont la même, entraîneur le plus présent. Seulement pour les groupes sans volume.
// Même requête que la migration 20261106090000_emploi_du_temps_grille (anciens groupes) ; utilisée par le seed et init-prod.
export const GROUP_VOLUMES_SQL = `
UPDATE "TrainingGroup" g
SET "weeklyMinutes" = s.total,
    "sessionMinutes" = CASE WHEN s.mn = s.mx THEN s.mn ELSE NULL END
FROM (
  SELECT "groupId", SUM(dur) AS total, MIN(dur) AS mn, MAX(dur) AS mx
  FROM (
    SELECT "groupId",
      (split_part("endTime", ':', 1)::int * 60 + split_part("endTime", ':', 2)::int)
      - (split_part("startTime", ':', 1)::int * 60 + split_part("startTime", ':', 2)::int) AS dur
    FROM "GroupSlot"
    WHERE "scheduleId" IS NULL AND "kind" = 'TENNIS'
  ) t
  GROUP BY "groupId"
) s
WHERE s."groupId" = g.id AND g."weeklyMinutes" IS NULL;

UPDATE "TrainingGroup" g
SET "mainCoachId" = (
  SELECT sc."coachId" FROM "SlotCoach" sc JOIN "GroupSlot" gs ON gs.id = sc."slotId"
  WHERE gs."groupId" = g.id AND gs."scheduleId" IS NULL
  GROUP BY sc."coachId" ORDER BY COUNT(*) DESC, sc."coachId" LIMIT 1
)
WHERE g."mainCoachId" IS NULL;
`;

/** Applique la requête (deux instructions : Prisma n'en accepte qu'une par appel). */
export async function fillGroupVolumes(prisma) {
  for (const sql of GROUP_VOLUMES_SQL.split(';').map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
}
