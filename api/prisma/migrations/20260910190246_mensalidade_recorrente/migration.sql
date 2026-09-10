-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "billingDay" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "FinancialTransaction" ADD COLUMN     "competencia" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_studentId_competencia_key" ON "FinancialTransaction"("studentId", "competencia");

