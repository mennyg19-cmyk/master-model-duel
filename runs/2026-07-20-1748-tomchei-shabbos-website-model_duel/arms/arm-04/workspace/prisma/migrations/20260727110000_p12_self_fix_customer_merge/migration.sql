-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "mergedIntoCustomerId" TEXT;

-- CreateIndex
CREATE INDEX "Customer_mergedIntoCustomerId_idx" ON "Customer"("mergedIntoCustomerId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_mergedIntoCustomerId_fkey" FOREIGN KEY ("mergedIntoCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
