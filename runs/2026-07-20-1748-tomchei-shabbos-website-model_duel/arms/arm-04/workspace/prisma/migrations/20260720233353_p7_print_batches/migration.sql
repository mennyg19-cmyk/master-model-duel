-- CreateEnum
CREATE TYPE "PrintBatchKind" AS ENUM ('NIGHTLY', 'REPRINT_GROUP', 'REPRINT_ORDER');

-- CreateEnum
CREATE TYPE "PrintArtifactKind" AS ENUM ('PACKAGE_SLIPS', 'LABELS', 'GREETING_CARDS', 'PACKING_SLIP');

-- CreateTable
CREATE TABLE "PrintBatch" (
    "id" TEXT NOT NULL,
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
CREATE INDEX "PrintArtifact_orderId_createdAt_idx" ON "PrintArtifact"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintArtifact_printBatchId_filingGroup_kind_orderId_key" ON "PrintArtifact"("printBatchId", "filingGroup", "kind", "orderId");

-- CreateIndex
CREATE INDEX "Package_seasonId_fulfillmentMethodId_stage_idx" ON "Package"("seasonId", "fulfillmentMethodId", "stage");

-- AddForeignKey
ALTER TABLE "PrintArtifact" ADD CONSTRAINT "PrintArtifact_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "PrintBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
