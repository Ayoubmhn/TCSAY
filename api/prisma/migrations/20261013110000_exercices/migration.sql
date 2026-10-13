-- CreateEnum
CREATE TYPE "ExerciseKind" AS ENUM ('WARMUP', 'TECHNIQUE', 'PHYSICAL', 'RECOVERY');

-- CreateTable
CREATE TABLE "Exercise" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ExerciseKind" NOT NULL,
    "durationMin" INTEGER,
    "instructions" TEXT NOT NULL,
    "videoUrl" TEXT,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseAssignment" (
    "id" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "groupId" UUID,
    "playerId" UUID,
    "dueDate" DATE,
    "note" TEXT,
    "assignedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseCompletion" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExerciseAssignment_groupId_idx" ON "ExerciseAssignment"("groupId");

-- CreateIndex
CREATE INDEX "ExerciseAssignment_playerId_idx" ON "ExerciseAssignment"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseCompletion_assignmentId_playerId_key" ON "ExerciseCompletion"("assignmentId", "playerId");

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAssignment" ADD CONSTRAINT "ExerciseAssignment_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAssignment" ADD CONSTRAINT "ExerciseAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAssignment" ADD CONSTRAINT "ExerciseAssignment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAssignment" ADD CONSTRAINT "ExerciseAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseCompletion" ADD CONSTRAINT "ExerciseCompletion_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ExerciseAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseCompletion" ADD CONSTRAINT "ExerciseCompletion_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

