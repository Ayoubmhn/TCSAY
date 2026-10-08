-- Énumérations
CREATE TYPE "CourtSurface" AS ENUM ('CLAY', 'HARD', 'GRASS');
CREATE TYPE "GroupKind" AS ENUM ('LEISURE', 'COMPETITIVE');
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE');
CREATE TYPE "AbsenceResolution" AS ENUM ('REPLACED', 'PHYSICAL', 'CANCELLED');

-- Utilisateurs : un rôle → plusieurs acteurs (ADMIN → PRESIDENT ; STAFF → selon la fonction)
ALTER TABLE "User" ADD COLUMN "roles" "Role"[] NOT NULL DEFAULT ARRAY[]::"Role"[];
UPDATE "User" SET "roles" = CASE
  WHEN "role" = 'ADMIN' THEN ARRAY['PRESIDENT']::"Role"[]
  WHEN "role" = 'STAFF' AND "position" = 'TECHNICAL_DIRECTOR' THEN ARRAY['TECH_DIRECTOR']::"Role"[]
  WHEN "role" = 'STAFF' THEN ARRAY['ADMIN_AGENT']::"Role"[]
  ELSE ARRAY["role"]::"Role"[]
END;
ALTER TABLE "User" DROP COLUMN "position", DROP COLUMN "role";
DROP TYPE "StaffPosition";

-- Présences : présent / absent → présent / absent / en retard
ALTER TABLE "Attendance" ADD COLUMN "status" "AttendanceStatus";
UPDATE "Attendance" SET "status" = CASE WHEN "present" THEN 'PRESENT'::"AttendanceStatus" ELSE 'ABSENT'::"AttendanceStatus" END;
ALTER TABLE "Attendance" ALTER COLUMN "status" SET NOT NULL, DROP COLUMN "present";

-- Absence d'un entraîneur : décision de la direction
ALTER TABLE "CoachAbsence" ADD COLUMN "replacementCoachId" UUID, ADD COLUMN "resolution" "AbsenceResolution";
ALTER TABLE "CoachAbsence" ADD CONSTRAINT "CoachAbsence_replacementCoachId_fkey" FOREIGN KEY ("replacementCoachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Terrains : terre battue, dur, gazon
ALTER TABLE "Court" ALTER COLUMN "surface" TYPE "CourtSurface" USING (CASE
  WHEN lower("surface") LIKE '%dur%' OR lower("surface") LIKE '%hard%' THEN 'HARD'
  WHEN lower("surface") LIKE '%gazon%' OR lower("surface") LIKE '%herbe%' OR lower("surface") LIKE '%grass%' THEN 'GRASS'
  ELSE 'CLAY'
END)::"CourtSurface";

-- Tarifs : séance physique incluse
ALTER TABLE "FeeSchedule" ADD COLUMN "physicalIncluded" BOOLEAN NOT NULL DEFAULT false;

-- Saisons : période loisirs (octobre → juin) ; le compétitif suit startDate → endDate (août)
ALTER TABLE "Season" ADD COLUMN "leisureStartDate" DATE, ADD COLUMN "leisureEndDate" DATE;

-- Groupes : loisirs ou compétitif
ALTER TABLE "TrainingGroup" ADD COLUMN "kind" "GroupKind" NOT NULL DEFAULT 'COMPETITIVE';

-- Autorisations par rôle (modifiables par le président)
CREATE TABLE "RolePermission" (
    "role" "Role" NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("role","permission")
);
