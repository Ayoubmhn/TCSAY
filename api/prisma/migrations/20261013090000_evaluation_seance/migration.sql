-- CreateEnum
CREATE TYPE "Mood" AS ENUM ('GOOD', 'TIRED', 'PAIN');

-- CreateTable
CREATE TABLE "SessionPlan" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "objective" TEXT NOT NULL,
    "content" TEXT,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRating" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "effort" INTEGER NOT NULL,
    "focus" INTEGER NOT NULL,
    "behavior" INTEGER NOT NULL,
    "objective" INTEGER NOT NULL,
    "play" INTEGER NOT NULL,
    "mood" "Mood" NOT NULL DEFAULT 'GOOD',
    "comment" TEXT,
    "ratedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionPlan_slotId_date_key" ON "SessionPlan"("slotId", "date");

-- CreateIndex
CREATE INDEX "SessionRating_playerId_date_idx" ON "SessionRating"("playerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRating_slotId_playerId_date_key" ON "SessionRating"("slotId", "playerId", "date");

-- AddForeignKey
ALTER TABLE "SessionPlan" ADD CONSTRAINT "SessionPlan_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPlan" ADD CONSTRAINT "SessionPlan_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "GroupSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPlan" ADD CONSTRAINT "SessionPlan_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRating" ADD CONSTRAINT "SessionRating_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRating" ADD CONSTRAINT "SessionRating_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "GroupSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRating" ADD CONSTRAINT "SessionRating_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRating" ADD CONSTRAINT "SessionRating_ratedById_fkey" FOREIGN KEY ("ratedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Notes de 1 à 5
ALTER TABLE "SessionRating" ADD CONSTRAINT "SessionRating_notes_check" CHECK (
  "effort" BETWEEN 1 AND 5 AND "focus" BETWEEN 1 AND 5 AND "behavior" BETWEEN 1 AND 5 AND "objective" BETWEEN 1 AND 5 AND "play" BETWEEN 1 AND 5
);
