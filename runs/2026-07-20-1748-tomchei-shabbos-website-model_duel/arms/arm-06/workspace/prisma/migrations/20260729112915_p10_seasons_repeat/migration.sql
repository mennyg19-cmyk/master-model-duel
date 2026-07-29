-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "repeatedFromOrderId" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_repeatedFromOrderId_fkey" FOREIGN KEY ("repeatedFromOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
