CREATE TYPE "ShippingLabelStatus" AS ENUM ('PURCHASED', 'VOIDED', 'FAILED');

CREATE TABLE "ShippingLabel" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "shipmentBoxId" TEXT,
    "provider" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "providerRateId" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "trackingNumber" TEXT,
    "trackingStatus" TEXT,
    "labelUrl" TEXT,
    "chargedCents" INTEGER NOT NULL,
    "purchasedCents" INTEGER NOT NULL,
    "marginCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "ShippingLabelStatus" NOT NULL DEFAULT 'PURCHASED',
    "failureMessage" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "trackingRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShippingLabel_providerTransactionId_key" ON "ShippingLabel"("providerTransactionId");
CREATE INDEX "ShippingLabel_packageId_status_idx" ON "ShippingLabel"("packageId", "status");
CREATE INDEX "ShippingLabel_trackingNumber_idx" ON "ShippingLabel"("trackingNumber");

ALTER TABLE "ShippingLabel"
ADD CONSTRAINT "ShippingLabel_packageId_fkey"
FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShippingLabel"
ADD CONSTRAINT "ShippingLabel_shipmentBoxId_fkey"
FOREIGN KEY ("shipmentBoxId") REFERENCES "ShipmentBox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
