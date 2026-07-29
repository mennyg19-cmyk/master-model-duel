-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PURCHASING', 'PURCHASED', 'VOIDED', 'FAILED');

-- AlterEnum
ALTER TYPE "FulfillmentChoice" ADD VALUE 'SHIPPED';

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PURCHASING',
    "shippoShipmentId" TEXT,
    "shippoTransactionId" TEXT,
    "rateId" TEXT,
    "carrier" TEXT,
    "serviceLevel" TEXT,
    "trackingNumber" TEXT,
    "trackingStatus" TEXT,
    "trackingStatusAt" TIMESTAMP(3),
    "labelUrl" TEXT,
    "chargedCents" INTEGER NOT NULL,
    "costCents" INTEGER,
    "marginCents" INTEGER,
    "parcels" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipments_packageId_status_idx" ON "shipments"("packageId", "status");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One active (in-flight or live) label per package; history rows
-- (VOIDED/FAILED) are unrestricted.
CREATE UNIQUE INDEX "shipments_one_active_per_package" ON "shipments"("packageId") WHERE "status" IN ('PURCHASING', 'PURCHASED');

-- Carrier shipping fulfillment method (R-153 data-driven stage lists). Same
-- stage shape as DELIVERY; terminal SENT means the carrier has it.
INSERT INTO "fulfillment_methods" ("id", "code", "label", "stages", "terminalStage", "active", "createdAt", "updatedAt")
SELECT 'fm_shipped', 'SHIPPED', 'Carrier shipping', '["NEW","PRINTED","PACKED","SENT"]', 'SENT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "fulfillment_methods" WHERE "code" = 'SHIPPED');
