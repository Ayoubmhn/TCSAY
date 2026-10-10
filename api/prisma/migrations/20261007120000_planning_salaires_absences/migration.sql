-- CreateEnum
CREATE TYPE "StaffPosition" AS ENUM ('ADMIN_AGENT', 'TECHNICAL_DIRECTOR');

-- CreateEnum
CREATE TYPE "PayMode" AS ENUM ('HOURLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PaymentPlan" AS ENUM ('FULL', 'SEMESTER', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STAFF';

-- DropForeignKey
ALTER TABLE "CoachFee" DROP CONSTRAINT "CoachFee_coachId_fkey";

-- DropForeignKey
ALTER TABLE "CoachFee" DROP CONSTRAINT "CoachFee_seasonId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingGroup" DROP CONSTRAINT "TrainingGroup_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingGroup" DROP CONSTRAINT "TrainingGroup_coachId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingGroup" DROP CONSTRAINT "TrainingGroup_courtId_fkey";

-- DropIndex
DROP INDEX "Attendance_groupId_playerId_date_key";

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "slotId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "Coach" DROP COLUMN "payMode",
ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#c9e9fb';

-- AlterTable
ALTER TABLE "FeeSchedule" DROP COLUMN "installmentsCount",
ADD COLUMN     "depositAmount" DECIMAL(10,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "paymentPlan" "PaymentPlan" NOT NULL DEFAULT 'FULL';

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "cin" TEXT;

-- AlterTable
ALTER TABLE "TrainingGroup" DROP COLUMN "coachId",
DROP COLUMN "courtId",
DROP COLUMN "days",
DROP COLUMN "endTime",
DROP COLUMN "startTime",
ALTER COLUMN "categoryId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cin" TEXT,
ADD COLUMN     "payMode" "PayMode",
ADD COLUMN     "payRate" DECIMAL(10,3),
ADD COLUMN     "position" "StaffPosition",
ALTER COLUMN "email" DROP NOT NULL;

-- DropTable
DROP TABLE "CoachFee";

-- CreateTable
CREATE TABLE "GroupSlot" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "day" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "courtId" UUID,

    CONSTRAINT "GroupSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotCoach" (
    "slotId" UUID NOT NULL,
    "coachId" UUID NOT NULL,

    CONSTRAINT "SlotCoach_pkey" PRIMARY KEY ("slotId","coachId")
);

-- CreateTable
CREATE TABLE "Salary" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "seasonId" UUID,
    "month" TEXT NOT NULL,
    "hours" DECIMAL(6,2),
    "absences" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(10,3) NOT NULL,
    "paidAt" DATE,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachAbsence" (
    "id" UUID NOT NULL,
    "coachId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slotId" UUID,
    "reason" TEXT NOT NULL,
    "status" "AbsenceStatus" NOT NULL DEFAULT 'PENDING',
    "notifyGroups" BOOLEAN NOT NULL DEFAULT true,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupSlot_day_idx" ON "GroupSlot"("day");

-- CreateIndex
CREATE UNIQUE INDEX "Salary_employeeId_month_key" ON "Salary"("employeeId", "month");

-- CreateIndex
CREATE INDEX "CoachAbsence_date_idx" ON "CoachAbsence"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_slotId_playerId_date_key" ON "Attendance"("slotId", "playerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "User_cin_key" ON "User"("cin");

-- AddForeignKey
ALTER TABLE "TrainingGroup" ADD CONSTRAINT "TrainingGroup_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSlot" ADD CONSTRAINT "GroupSlot_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSlot" ADD CONSTRAINT "GroupSlot_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotCoach" ADD CONSTRAINT "SlotCoach_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "GroupSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotCoach" ADD CONSTRAINT "SlotCoach_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAbsence" ADD CONSTRAINT "CoachAbsence_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAbsence" ADD CONSTRAINT "CoachAbsence_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "GroupSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAbsence" ADD CONSTRAINT "CoachAbsence_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "GroupSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Journal d'audit infalsifiable : aucune modification ni suppression, même directement en base.
-- (TRUNCATE reste possible pour réinitialiser une base de développement.)
CREATE OR REPLACE FUNCTION audit_log_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Journal d''audit en lecture seule : modification et suppression interdites.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_sans_modification
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immuable();
