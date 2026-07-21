-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PACKAGE_SPLIT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PACKAGE_REGROUPED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PRINT_BATCH_CREATED';

-- CreateEnum
CREATE TYPE "PrintBatchKind" AS ENUM ('NIGHTLY', 'REPRINT_GROUP', 'REPRINT_ORDER');

-- CreateEnum
CREATE TYPE "PrintArtifactKind" AS ENUM ('PACKAGE_SLIPS', 'LABELS', 'GREETING_CARDS', 'PACKING_SLIP');

-- CreateTable
CREATE TABLE "PrintBatch" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "kind" "PrintBatchKind" NOT NULL,
    "runKey" TEXT NOT NULL,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintArtifact" (
    "id" TEXT NOT NULL,
    "printBatchId" TEXT NOT NULL,
    "filingGroup" TEXT NOT NULL,
    "kind" "PrintArtifactKind" NOT NULL,
    "orderId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintBatch_runKey_key" ON "PrintBatch"("runKey");

-- CreateIndex
CREATE INDEX "PrintBatch_seasonId_createdAt_idx" ON "PrintBatch"("seasonId", "createdAt");

-- CreateIndex
CREATE INDEX "PrintArtifact_orderId_createdAt_idx" ON "PrintArtifact"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintArtifact_printBatchId_filingGroup_kind_orderId_key" ON "PrintArtifact"("printBatchId", "filingGroup", "kind", "orderId");

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintArtifact" ADD CONSTRAINT "PrintArtifact_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "PrintBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
