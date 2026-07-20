CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "sourceName" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "validRowCount" INTEGER NOT NULL,
    "invalidRowCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "stagedByStaffId" TEXT NOT NULL,
    "committedByStaffId" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportBatch_entityType_createdAt_idx"
ON "ImportBatch"("entityType", "createdAt");

CREATE INDEX "ImportBatch_status_createdAt_idx"
ON "ImportBatch"("status", "createdAt");

CREATE INDEX "Order_status_createdAt_idx"
ON "Order"("status", "createdAt");

CREATE INDEX "Order_cachedPaymentStatus_createdAt_idx"
ON "Order"("cachedPaymentStatus", "createdAt");
