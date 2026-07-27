-- P6: indexes backing the admin list/dashboard queries at crunch scale (R-105, G-024)
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
CREATE INDEX "Order_seasonId_createdAt_idx" ON "Order"("seasonId", "createdAt");
CREATE INDEX "Package_seasonId_stage_idx" ON "Package"("seasonId", "stage");
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");
