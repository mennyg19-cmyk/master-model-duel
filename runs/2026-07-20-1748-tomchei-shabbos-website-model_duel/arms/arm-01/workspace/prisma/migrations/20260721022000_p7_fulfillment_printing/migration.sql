CREATE TYPE "PrintBatchKind" AS ENUM ('NIGHTLY', 'REPRINT_GROUP', 'REPRINT_ORDER');
CREATE TYPE "PrintArtifactKind" AS ENUM ('SLIPS', 'LABELS', 'GREETING_CARDS', 'PACKING_SLIP');

ALTER TABLE "Package"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "PrintBatch" (
    "id" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "kind" "PrintBatchKind" NOT NULL,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrintArtifact" (
    "id" TEXT NOT NULL,
    "printBatchId" TEXT NOT NULL,
    "filingGroup" TEXT NOT NULL,
    "kind" "PrintArtifactKind" NOT NULL,
    "orderId" TEXT,
    "sourceArtifactId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrintBatch_runKey_key" ON "PrintBatch"("runKey");
CREATE INDEX "PrintBatch_kind_createdAt_idx" ON "PrintBatch"("kind", "createdAt");
CREATE UNIQUE INDEX "PrintArtifact_printBatchId_filingGroup_kind_orderId_key"
ON "PrintArtifact"("printBatchId", "filingGroup", "kind", "orderId");
CREATE INDEX "PrintArtifact_filingGroup_kind_createdAt_idx"
ON "PrintArtifact"("filingGroup", "kind", "createdAt");
CREATE INDEX "PrintArtifact_orderId_createdAt_idx"
ON "PrintArtifact"("orderId", "createdAt");
CREATE INDEX "Package_isActive_stage_updatedAt_idx"
ON "Package"("isActive", "stage", "updatedAt");

ALTER TABLE "PrintArtifact"
ADD CONSTRAINT "PrintArtifact_printBatchId_fkey"
FOREIGN KEY ("printBatchId") REFERENCES "PrintBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
