-- CreateEnum
CREATE TYPE "PrintBatchKind" AS ENUM ('NIGHTLY', 'REPRINT');

-- CreateTable
CREATE TABLE "PrintBatch" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "kind" "PrintBatchKind" NOT NULL DEFAULT 'NIGHTLY',
    "label" TEXT NOT NULL,
    "packageCount" INTEGER NOT NULL DEFAULT 0,
    "createdByStaffUserId" TEXT,
    "supersedesBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintBatchGroup" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "filingKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "packageCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PrintBatchGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintBatchItem" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sortKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrintBatch_seasonId_createdAt_idx" ON "PrintBatch"("seasonId", "createdAt");

-- CreateIndex
CREATE INDEX "PrintBatch_kind_createdAt_idx" ON "PrintBatch"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintBatchGroup_batchId_filingKey_key" ON "PrintBatchGroup"("batchId", "filingKey");

-- CreateIndex
CREATE INDEX "PrintBatchItem_packageId_idx" ON "PrintBatchItem"("packageId");

-- CreateIndex
CREATE INDEX "PrintBatchItem_orderId_idx" ON "PrintBatchItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintBatchItem_groupId_packageId_key" ON "PrintBatchItem"("groupId", "packageId");

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_createdByStaffUserId_fkey" FOREIGN KEY ("createdByStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_supersedesBatchId_fkey" FOREIGN KEY ("supersedesBatchId") REFERENCES "PrintBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatchGroup" ADD CONSTRAINT "PrintBatchGroup_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PrintBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatchItem" ADD CONSTRAINT "PrintBatchItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PrintBatchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatchItem" ADD CONSTRAINT "PrintBatchItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatchItem" ADD CONSTRAINT "PrintBatchItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
