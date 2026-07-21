-- P6: Admin ops hub — import staging + audit actions

CREATE TYPE "ImportKind" AS ENUM ('CUSTOMERS', 'PRODUCTS');
CREATE TYPE "ImportBatchStatus" AS ENUM ('STAGED', 'COMMITTED', 'CANCELLED');
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'DUPLICATE', 'INVALID', 'COMMITTED', 'SKIPPED');

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ORDER_REPEATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BULK_ACTION_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CUSTOMER_UPSERTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'IMPORT_STAGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'IMPORT_COMMITTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_BANNER_UPDATED';

CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'STAGED',
    "filename" TEXT,
    "stagedById" TEXT,
    "committedById" TEXT,
    "stagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INT NOT NULL,
    "status" "ImportRowStatus" NOT NULL,
    "raw" JSONB NOT NULL,
    "errors" JSONB,
    "targetKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportBatch_kind_status_idx" ON "ImportBatch"("kind", "status");
CREATE INDEX "ImportBatch_stagedAt_idx" ON "ImportBatch"("stagedAt");
CREATE INDEX "ImportRow_batchId_status_idx" ON "ImportRow"("batchId", "status");
CREATE INDEX "ImportRow_targetKey_idx" ON "ImportRow"("targetKey");
CREATE UNIQUE INDEX "ImportRow_batchId_rowNumber_key" ON "ImportRow"("batchId", "rowNumber");

ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_stagedById_fkey" FOREIGN KEY ("stagedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_committedById_fkey" FOREIGN KEY ("committedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
