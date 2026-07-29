-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CUSTOMERS', 'PRODUCTS');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('STAGED', 'COMMITTED', 'DISCARDED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refundRef" TEXT;

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'STAGED',
    "filename" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "committedRows" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_kind_createdAt_idx" ON "import_batches"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "orders_seasonId_status_paymentStatus_createdAt_idx" ON "orders"("seasonId", "status", "paymentStatus", "createdAt");
