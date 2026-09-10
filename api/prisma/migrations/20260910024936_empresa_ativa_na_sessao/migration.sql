-- DropIndex
DROP INDEX "Driver_userId_key";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "Driver_userId_idx" ON "Driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_companyId_userId_key" ON "Driver"("companyId", "userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

