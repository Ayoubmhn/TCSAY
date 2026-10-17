-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "bookCoaches" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bookDays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
ADD COLUMN     "bookFamilies" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bookFrom" TEXT,
ADD COLUMN     "bookNight" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bookTo" TEXT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "noShowAt" TIMESTAMP(3),
ADD COLUMN     "noShowById" UUID;

-- CreateTable
CREATE TABLE "CourtClosure" (
    "id" UUID NOT NULL,
    "courtId" UUID NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourtClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationBlock" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "liftedAt" TIMESTAMP(3),
    "liftedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourtClosure_courtId_toDate_idx" ON "CourtClosure"("courtId", "toDate");

-- CreateIndex
CREATE INDEX "ReservationBlock_userId_until_idx" ON "ReservationBlock"("userId", "until");

-- AddForeignKey
ALTER TABLE "CourtClosure" ADD CONSTRAINT "CourtClosure_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationBlock" ADD CONSTRAINT "ReservationBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

