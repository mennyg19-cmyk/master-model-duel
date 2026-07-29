-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'OK', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationFindingKind" AS ENUM ('ORPHANED_INTENT', 'MISSING_PAYMENT', 'AMOUNT_MISMATCH', 'STALE_MIRROR', 'STATUS_DRIFT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ImportKind" ADD VALUE 'LEGACY_CUSTOMERS';
ALTER TYPE "ImportKind" ADD VALUE 'LEGACY_PRODUCTS';
ALTER TYPE "ImportKind" ADD VALUE 'LEGACY_ORDERS';

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewReason" TEXT;

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "dryRun" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "legacyRef" TEXT;

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "mode" TEXT NOT NULL,
    "checkedCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "message" TEXT,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_findings" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "ReconciliationFindingKind" NOT NULL,
    "intentId" TEXT,
    "orderId" TEXT,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_runs_startedAt_idx" ON "reconciliation_runs"("startedAt");

-- CreateIndex
CREATE INDEX "reconciliation_findings_runId_idx" ON "reconciliation_findings"("runId");

-- CreateIndex
CREATE INDEX "reconciliation_findings_intentId_idx" ON "reconciliation_findings"("intentId");

-- CreateIndex
CREATE INDEX "addresses_customerId_needsReview_idx" ON "addresses"("customerId", "needsReview");

-- AddForeignKey
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_runId_fkey" FOREIGN KEY ("runId") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
