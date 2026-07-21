-- CreateEnum
CREATE TYPE "LegacyImportStatus" AS ENUM ('DRY_RUN', 'COMMITTING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "PaymentReconFlag" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "orderId" TEXT,
    "detail" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByStaffId" TEXT,

    CONSTRAINT "PaymentReconFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyImportRun" (
    "id" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "LegacyImportStatus" NOT NULL DEFAULT 'DRY_RUN',
    "report" JSONB NOT NULL,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegacyImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyImportStage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "counts" JSONB NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyImportStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressReviewItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "customerId" TEXT,
    "addressId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByStaffId" TEXT,

    CONSTRAINT "AddressReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconFlag_reference_key" ON "PaymentReconFlag"("reference");

-- CreateIndex
CREATE INDEX "PaymentReconFlag_status_createdAt_idx" ON "PaymentReconFlag"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyImportRun_fileHash_key" ON "LegacyImportRun"("fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyImportStage_runId_stage_key" ON "LegacyImportStage"("runId", "stage");

-- CreateIndex
CREATE INDEX "AddressReviewItem_status_createdAt_idx" ON "AddressReviewItem"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "LegacyImportStage" ADD CONSTRAINT "LegacyImportStage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LegacyImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressReviewItem" ADD CONSTRAINT "AddressReviewItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LegacyImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
