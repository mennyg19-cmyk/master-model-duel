-- CreateEnum
CREATE TYPE "PrintBatchTrigger" AS ENUM ('NIGHTLY', 'REPRINT_GROUP', 'REPRINT_ORDER');

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "channel" "FulfillmentChoice" NOT NULL DEFAULT 'PICKUP',
ADD COLUMN     "deliveryDay" TEXT;

-- CreateTable
CREATE TABLE "package_lines" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "package_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_batches" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "filingGroup" TEXT NOT NULL,
    "trigger" "PrintBatchTrigger" NOT NULL,
    "supersedesId" TEXT,
    "packageCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_batch_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "print_batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "package_lines_packageId_orderLineId_key" ON "package_lines"("packageId", "orderLineId");

-- CreateIndex
CREATE INDEX "print_batches_seasonId_filingGroup_createdAt_idx" ON "print_batches"("seasonId", "filingGroup", "createdAt");

-- CreateIndex
CREATE INDEX "print_batch_items_packageId_idx" ON "print_batch_items"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "print_batch_items_batchId_packageId_key" ON "print_batch_items"("batchId", "packageId");

-- AddForeignKey
ALTER TABLE "package_lines" ADD CONSTRAINT "package_lines_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_lines" ADD CONSTRAINT "package_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_batches" ADD CONSTRAINT "print_batches_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_batches" ADD CONSTRAINT "print_batches_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "print_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_batch_items" ADD CONSTRAINT "print_batch_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "print_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_batch_items" ADD CONSTRAINT "print_batch_items_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
