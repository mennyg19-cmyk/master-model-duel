-- CreateEnum
CREATE TYPE "LegacyImportStatus" AS ENUM ('DRY_RUN', 'COMMITTING', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "LegacyRowStatus" AS ENUM ('VALID', 'DUPLICATE', 'NEEDS_MAPPING', 'INVALID');

-- CreateEnum
CREATE TYPE "AddressCleanupKind" AS ENUM ('UNUSABLE_ADDRESS', 'DUPLICATE_ADDRESS', 'DUPLICATE_CUSTOMER');

-- CreateEnum
CREATE TYPE "AddressCleanupStatus" AS ENUM ('OPEN', 'MERGED', 'KEPT');

-- CreateEnum
CREATE TYPE "ExportDataset" AS ENUM ('DELIVERIES', 'YEAR_END', 'YEAR_METRICS', 'ITEM_SALES', 'LAPSED_CUSTOMERS');

-- CreateEnum
CREATE TYPE "ReconciliationFlagKind" AS ENUM ('ORPHANED_INTENT', 'AMOUNT_MISMATCH', 'MISSING_INTENT');

-- CreateEnum
CREATE TYPE "ReconciliationFlagStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "CustomerAddress" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewNote" TEXT;

-- CreateTable
CREATE TABLE "LegacyImportRun" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "status" "LegacyImportStatus" NOT NULL DEFAULT 'DRY_RUN',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "needsMappingCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "committedChunkCount" INTEGER NOT NULL DEFAULT 0,
    "customersWritten" INTEGER NOT NULL DEFAULT 0,
    "addressesWritten" INTEGER NOT NULL DEFAULT 0,
    "ordersWritten" INTEGER NOT NULL DEFAULT 0,
    "orderLinesWritten" INTEGER NOT NULL DEFAULT 0,
    "sourceTotalCents" INTEGER NOT NULL DEFAULT 0,
    "importedTotalCents" INTEGER NOT NULL DEFAULT 0,
    "stagedByStaffUserId" TEXT,
    "stagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "LegacyImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyImportRow" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "status" "LegacyRowStatus" NOT NULL,
    "orderReference" TEXT,
    "parsed" JSONB NOT NULL DEFAULT '{}',
    "problem" TEXT,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "mappedCustomerId" TEXT,

    CONSTRAINT "LegacyImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressCleanupFlag" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" "AddressCleanupKind" NOT NULL,
    "status" "AddressCleanupStatus" NOT NULL DEFAULT 'OPEN',
    "customerId" TEXT NOT NULL,
    "addressId" TEXT,
    "duplicateOfAddressId" TEXT,
    "duplicateOfCustomerId" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByStaffUserId" TEXT,

    CONSTRAINT "AddressCleanupFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportLog" (
    "id" TEXT NOT NULL,
    "dataset" "ExportDataset" NOT NULL,
    "seasonId" TEXT,
    "rowCount" INTEGER NOT NULL,
    "byteCount" INTEGER NOT NULL,
    "staffUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReconciliationRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "checkedCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "newFlagCount" INTEGER NOT NULL DEFAULT 0,
    "ranByStaffUserId" TEXT,

    CONSTRAINT "PaymentReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReconciliationFlag" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" "ReconciliationFlagKind" NOT NULL,
    "status" "ReconciliationFlagStatus" NOT NULL DEFAULT 'OPEN',
    "orderId" TEXT,
    "stripeSessionId" TEXT,
    "stripeIntentId" TEXT,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "expectedCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenRunId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentReconciliationFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegacyImportRun_status_stagedAt_idx" ON "LegacyImportRun"("status", "stagedAt");

-- CreateIndex
CREATE INDEX "LegacyImportRow_runId_status_idx" ON "LegacyImportRow"("runId", "status");

-- CreateIndex
CREATE INDEX "LegacyImportRow_runId_chunkIndex_idx" ON "LegacyImportRow"("runId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyImportRow_runId_lineNumber_key" ON "LegacyImportRow"("runId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AddressCleanupFlag_fingerprint_key" ON "AddressCleanupFlag"("fingerprint");

-- CreateIndex
CREATE INDEX "AddressCleanupFlag_status_kind_createdAt_idx" ON "AddressCleanupFlag"("status", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "AddressCleanupFlag_customerId_idx" ON "AddressCleanupFlag"("customerId");

-- CreateIndex
CREATE INDEX "ExportLog_createdAt_idx" ON "ExportLog"("createdAt");

-- CreateIndex
CREATE INDEX "ExportLog_dataset_createdAt_idx" ON "ExportLog"("dataset", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentReconciliationRun_startedAt_idx" ON "PaymentReconciliationRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliationFlag_fingerprint_key" ON "PaymentReconciliationFlag"("fingerprint");

-- CreateIndex
CREATE INDEX "PaymentReconciliationFlag_status_lastSeenAt_idx" ON "PaymentReconciliationFlag"("status", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "LegacyImportRun" ADD CONSTRAINT "LegacyImportRun_stagedByStaffUserId_fkey" FOREIGN KEY ("stagedByStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyImportRow" ADD CONSTRAINT "LegacyImportRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LegacyImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportLog" ADD CONSTRAINT "ExportLog_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportLog" ADD CONSTRAINT "ExportLog_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliationRun" ADD CONSTRAINT "PaymentReconciliationRun_ranByStaffUserId_fkey" FOREIGN KEY ("ranByStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliationFlag" ADD CONSTRAINT "PaymentReconciliationFlag_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
