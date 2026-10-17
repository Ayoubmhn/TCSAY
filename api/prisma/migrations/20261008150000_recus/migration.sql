-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CHEQUE';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "chequeNumber" TEXT;

-- CreateTable
CREATE TABLE "Receipt" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "paymentId" UUID NOT NULL,
    "payerName" TEXT NOT NULL,
    "amount" DECIMAL(10,3) NOT NULL,
    "amountWords" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "chequeNumber" TEXT,
    "seasonLabel" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedAt" TIMESTAMP(3),
    "issuedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" UUID,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_number_key" ON "Receipt"("number");

-- CreateIndex
CREATE INDEX "Receipt_paymentId_idx" ON "Receipt"("paymentId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Un reçu n'est jamais supprimé (numéro du carnet tracé) : il est annulé avec motif.
-- (TRUNCATE reste possible pour réinitialiser une base de développement.)
CREATE OR REPLACE FUNCTION recu_sans_suppression() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Reçu : suppression interdite, annulez-le avec un motif.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recu_sans_suppression
  BEFORE DELETE ON "Receipt"
  FOR EACH ROW EXECUTE FUNCTION recu_sans_suppression();
