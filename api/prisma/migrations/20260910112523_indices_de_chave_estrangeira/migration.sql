-- CreateIndex
CREATE INDEX "AIPost_campaignId_idx" ON "AIPost"("campaignId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "Charter_driverId_idx" ON "Charter"("driverId");

-- CreateIndex
CREATE INDEX "Charter_vehicleId_idx" ON "Charter"("vehicleId");

-- CreateIndex
CREATE INDEX "Company_subscriptionId_idx" ON "Company"("subscriptionId");

-- CreateIndex
CREATE INDEX "Expense_employeeId_idx" ON "Expense"("employeeId");

-- CreateIndex
CREATE INDEX "Expense_vehicleId_idx" ON "Expense"("vehicleId");

-- CreateIndex
CREATE INDEX "Invoice_studentId_idx" ON "Invoice"("studentId");

-- CreateIndex
CREATE INDEX "Note_authorId_idx" ON "Note"("authorId");

-- CreateIndex
CREATE INDEX "Note_studentId_idx" ON "Note"("studentId");

-- CreateIndex
CREATE INDEX "Session_companyId_idx" ON "Session"("companyId");

-- CreateIndex
CREATE INDEX "Timecard_vehicleId_idx" ON "Timecard"("vehicleId");
