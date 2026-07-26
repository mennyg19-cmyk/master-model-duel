-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CUSTOMERS', 'PRODUCTS');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('STAGED', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'DUPLICATE', 'INVALID');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "posStaffUserId" TEXT;

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'STAGED',
    "fileName" TEXT NOT NULL,
    "seasonId" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "stagedByStaffUserId" TEXT,
    "stagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL,
    "parsed" JSONB NOT NULL DEFAULT '{}',
    "problem" TEXT,
    "matchedId" TEXT,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_status_stagedAt_idx" ON "ImportBatch"("status", "stagedAt");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_status_idx" ON "ImportRow"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_lineNumber_key" ON "ImportRow"("batchId", "lineNumber");

-- CreateIndex
CREATE INDEX "Order_seasonId_status_placedAt_idx" ON "Order"("seasonId", "status", "placedAt");

-- CreateIndex
CREATE INDEX "Order_posStaffUserId_status_idx" ON "Order"("posStaffUserId", "status");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_stagedByStaffUserId_fkey" FOREIGN KEY ("stagedByStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_posStaffUserId_fkey" FOREIGN KEY ("posStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: Prisma's schema language cannot express a CHECK, and
-- scripts/migration-guard.ts asserts this survives a replay.

-- A till is always opened for a named customer: the counter looks the walk-in up
-- or creates them before the first item goes in. Without this a POS cart could
-- be owned by nobody, and the receipt, the address book and the repeat next year
-- all have to belong to somebody.
ALTER TABLE "Order" ADD CONSTRAINT "Order_pos_has_customer"
  CHECK ("posStaffUserId" IS NULL OR "customerId" IS NOT NULL);
