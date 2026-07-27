CREATE TYPE "PrintArtifactKind" AS ENUM ('PACKING_SLIP', 'LABEL', 'GREETING_CARD');

ALTER TABLE "Package" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Package_isActive_status_idx" ON "Package"("isActive", "status");

CREATE TABLE "PrintBatch" (
  "id" TEXT NOT NULL,
  "batchKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PrintBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrintArtifact" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "filingGroup" TEXT NOT NULL,
  "kind" "PrintArtifactKind" NOT NULL,
  "packageIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PrintArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrintBatch_batchKey_key" ON "PrintBatch"("batchKey");
CREATE UNIQUE INDEX "PrintArtifact_batchId_filingGroup_kind_key" ON "PrintArtifact"("batchId", "filingGroup", "kind");
CREATE INDEX "PrintArtifact_filingGroup_createdAt_idx" ON "PrintArtifact"("filingGroup", "createdAt");

ALTER TABLE "PrintArtifact"
  ADD CONSTRAINT "PrintArtifact_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PrintBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
