-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PURCHASED', 'VOIDED', 'FAILED');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "carrier" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "shippoRateId" TEXT,
    "shippoTransactionId" TEXT,
    "labelUrl" TEXT,
    "trackingNumber" TEXT,
    "trackingStatus" TEXT,
    "trackingUpdatedAt" TIMESTAMP(3),
    "costCents" INTEGER NOT NULL,
    "chargedCents" INTEGER NOT NULL,
    "marginCents" INTEGER NOT NULL,
    "quotedRates" JSONB NOT NULL,
    "parcels" JSONB NOT NULL,
    "failureReason" TEXT,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedByStaffId" TEXT,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shippoTransactionId_key" ON "Shipment"("shippoTransactionId");

-- CreateIndex
CREATE INDEX "Shipment_packageId_createdAt_idx" ON "Shipment"("packageId", "createdAt");

-- CreateIndex
CREATE INDEX "Shipment_status_createdAt_idx" ON "Shipment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
