ALTER TABLE "Product" ADD COLUMN "legacySourceId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "legacySourceId" TEXT;
ALTER TABLE "CustomerAddress"
  ADD COLUMN "legacySourceId" TEXT,
  ADD COLUMN "validationStatus" TEXT NOT NULL DEFAULT 'VALID',
  ADD COLUMN "reviewReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "legacySourceId" TEXT;

CREATE UNIQUE INDEX "Product_legacySourceId_key" ON "Product"("legacySourceId");
CREATE UNIQUE INDEX "Customer_legacySourceId_key" ON "Customer"("legacySourceId");
CREATE UNIQUE INDEX "CustomerAddress_legacySourceId_key" ON "CustomerAddress"("legacySourceId");
CREATE UNIQUE INDEX "Order_legacySourceId_key" ON "Order"("legacySourceId");

CREATE TABLE "LegacyImportBatch" (
  "id" TEXT NOT NULL,
  "checkpointKey" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STAGED',
  "dryRun" BOOLEAN NOT NULL DEFAULT true,
  "payload" JSONB NOT NULL,
  "mappings" JSONB NOT NULL,
  "issues" JSONB NOT NULL,
  "sourceCounts" JSONB NOT NULL,
  "sourceTotals" JSONB NOT NULL,
  "importedCounts" JSONB,
  "importedTotals" JSONB,
  "stagedByStaffId" TEXT NOT NULL,
  "committedByStaffId" TEXT,
  "committedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegacyImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegacyImportBatch_checkpointKey_key" ON "LegacyImportBatch"("checkpointKey");
CREATE INDEX "LegacyImportBatch_status_createdAt_idx" ON "LegacyImportBatch"("status", "createdAt");

CREATE TABLE "ExportRun" (
  "id" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "requestedById" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExportRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExportRun_dataset_completedAt_idx" ON "ExportRun"("dataset", "completedAt");
CREATE INDEX "ExportRun_requestedById_completedAt_idx" ON "ExportRun"("requestedById", "completedAt");

CREATE TABLE "ReconciliationRun" (
  "id" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "findingCount" INTEGER NOT NULL DEFAULT 0,
  "findings" JSONB NOT NULL,
  "initiatedById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReconciliationRun_runKey_key" ON "ReconciliationRun"("runKey");
CREATE INDEX "ReconciliationRun_status_startedAt_idx" ON "ReconciliationRun"("status", "startedAt");

CREATE TABLE "ReconciliationFinding" (
  "id" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "findingType" TEXT NOT NULL,
  "providerObjectId" TEXT NOT NULL,
  "orderId" TEXT,
  "amountCents" INTEGER,
  "details" JSONB NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ReconciliationFinding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReconciliationFinding_identityKey_key" ON "ReconciliationFinding"("identityKey");
CREATE INDEX "ReconciliationFinding_findingType_resolvedAt_idx" ON "ReconciliationFinding"("findingType", "resolvedAt");

CREATE TABLE "HelpTourProgress" (
  "id" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "tourKey" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HelpTourProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HelpTourProgress_staffUserId_tourKey_key" ON "HelpTourProgress"("staffUserId", "tourKey");
