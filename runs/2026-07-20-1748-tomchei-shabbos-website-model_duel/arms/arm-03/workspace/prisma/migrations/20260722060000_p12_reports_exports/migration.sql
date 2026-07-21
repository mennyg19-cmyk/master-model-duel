-- P12: reports, exports, reconciliation, legacy import, address cleanup

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXPORT_RUN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RECONCILE_RUN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADDRESS_REVIEW_FLAGGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADDRESS_MERGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TEST_OPS_ACTION';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEGACY_IMPORT_DRY_RUN';

ALTER TYPE "ImportKind" ADD VALUE IF NOT EXISTS 'ORDERS';
ALTER TYPE "ImportBatchStatus" ADD VALUE IF NOT EXISTS 'INTERRUPTED';

CREATE TYPE "ExportDataset" AS ENUM (
  'DELIVERIES',
  'YEAR_END',
  'YEAR_METRICS',
  'ITEM_SALES',
  'LAPSED_CUSTOMERS',
  'SHIPPING_MARGIN'
);

CREATE TYPE "ReconcileStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

ALTER TABLE "ImportBatch" ADD COLUMN IF NOT EXISTS "dryRun" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ImportBatch" ADD COLUMN IF NOT EXISTS "commitCursor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SavedAddress" ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SavedAddress" ADD COLUMN IF NOT EXISTS "reviewReason" TEXT;
ALTER TABLE "SavedAddress" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;

CREATE INDEX IF NOT EXISTS "SavedAddress_needsReview_idx" ON "SavedAddress"("needsReview");

DO $$ BEGIN
  ALTER TABLE "SavedAddress" ADD CONSTRAINT "SavedAddress_mergedIntoId_fkey"
    FOREIGN KEY ("mergedIntoId") REFERENCES "SavedAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ExportAudit" (
  "id" TEXT NOT NULL,
  "dataset" "ExportDataset" NOT NULL,
  "seasonId" TEXT,
  "rowCount" INTEGER NOT NULL,
  "byteCount" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "staffId" TEXT,
  "params" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExportAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExportAudit_dataset_createdAt_idx" ON "ExportAudit"("dataset", "createdAt");
CREATE INDEX IF NOT EXISTS "ExportAudit_staffId_idx" ON "ExportAudit"("staffId");

DO $$ BEGIN
  ALTER TABLE "ExportAudit" ADD CONSTRAINT "ExportAudit_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentReconcileRun" (
  "id" TEXT NOT NULL,
  "status" "ReconcileStatus" NOT NULL DEFAULT 'RUNNING',
  "triggeredBy" TEXT NOT NULL,
  "staffId" TEXT,
  "orphanedCount" INTEGER NOT NULL DEFAULT 0,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "adjustedCount" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentReconcileRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentReconcileRun_startedAt_idx" ON "PaymentReconcileRun"("startedAt");
CREATE INDEX IF NOT EXISTS "PaymentReconcileRun_status_idx" ON "PaymentReconcileRun"("status");

DO $$ BEGIN
  ALTER TABLE "PaymentReconcileRun" ADD CONSTRAINT "PaymentReconcileRun_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentReconcileAdjustment" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "stripePaymentIntentId" TEXT,
  "orderId" TEXT,
  "amountCents" INTEGER,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReconcileAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReconcileAdjustment_fingerprint_key"
  ON "PaymentReconcileAdjustment"("fingerprint");
CREATE INDEX IF NOT EXISTS "PaymentReconcileAdjustment_runId_idx"
  ON "PaymentReconcileAdjustment"("runId");
CREATE INDEX IF NOT EXISTS "PaymentReconcileAdjustment_stripePaymentIntentId_idx"
  ON "PaymentReconcileAdjustment"("stripePaymentIntentId");

DO $$ BEGIN
  ALTER TABLE "PaymentReconcileAdjustment" ADD CONSTRAINT "PaymentReconcileAdjustment_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "PaymentReconcileRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
