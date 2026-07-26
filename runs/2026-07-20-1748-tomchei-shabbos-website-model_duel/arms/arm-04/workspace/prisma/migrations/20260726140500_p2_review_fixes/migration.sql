-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'RELEASED');

-- AlterTable
ALTER TABLE "InventoryItem" DROP COLUMN "version";

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "addOnId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_orderId_productId_key" ON "Reservation"("orderId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_orderId_addOnId_key" ON "Reservation"("orderId", "addOnId");

-- CreateIndex
CREATE INDEX "Season_status_opensAt_idx" ON "Season"("status", "opensAt");

-- CreateIndex
CREATE INDEX "Season_status_closesAt_idx" ON "Season"("status", "closesAt");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same XOR as "InventoryItem": a reservation holds exactly one thing. Prisma
-- cannot express a CHECK constraint, so it is written here by hand and asserted
-- by scripts/migration-guard.ts.
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_single_target" CHECK (num_nonnulls("productId", "addOnId") = 1);

-- A zero or negative hold would release stock that was never taken.
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_quantity_positive" CHECK ("quantity" > 0);
