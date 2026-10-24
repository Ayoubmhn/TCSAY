-- CreateEnum
CREATE TYPE "SlotKind" AS ENUM ('TENNIS', 'PHYSICAL');

-- AlterTable
ALTER TABLE "GroupSlot" ADD COLUMN     "kind" "SlotKind" NOT NULL DEFAULT 'TENNIS';

-- AlterTable
ALTER TABLE "TrainingGroup" ADD COLUMN     "mainCoachId" UUID,
ADD COLUMN     "physicalCoachId" UUID,
ADD COLUMN     "physicalMinutes" INTEGER,
ADD COLUMN     "physicalSessionMinutes" INTEGER,
ADD COLUMN     "preferredCourtId" UUID,
ADD COLUMN     "sessionMinutes" INTEGER,
ADD COLUMN     "weeklyMinutes" INTEGER;

-- CreateTable
CREATE TABLE "TimetableDraft" (
    "seasonId" UUID NOT NULL,
    "groups" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimetableDraft_pkey" PRIMARY KEY ("seasonId")
);

-- AddForeignKey
ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Anciens groupes : volume par semaine et entraîneur principal déduits de leurs créneaux (prisma/group-volumes.mjs).
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
