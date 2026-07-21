-- P8: shipping labels + margin capture + package shipment plan

CREATE TYPE "ShippingLabelStatus" AS ENUM ('PURCHASED', 'VOIDED', 'FAILED');

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LABEL_PURCHASED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LABEL_VOIDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LABEL_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TRACKING_REFRESHED';

ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "shipmentPlan" JSONB;

CREATE TABLE "ShippingLabel" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "ShippingLabelStatus" NOT NULL DEFAULT 'PURCHASED',
    "carrier" TEXT NOT NULL,
    "serviceLevel" TEXT NOT NULL,
    "shippoRateId" TEXT,
    "shippoTransactionId" TEXT,
    "trackingNumber" TEXT,
    "labelUrl" TEXT,
    "chargedCents" INTEGER NOT NULL,
    "purchasedCents" INTEGER NOT NULL,
    "marginCents" INTEGER NOT NULL,
    "quotesJson" JSONB NOT NULL,
    "trackingStatus" TEXT,
    "trackingUpdatedAt" TIMESTAMP(3),
    "routeAssignedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "ShippingLabel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShippingLabel_packageId_status_idx" ON "ShippingLabel"("packageId", "status");
CREATE INDEX "ShippingLabel_orderId_idx" ON "ShippingLabel"("orderId");
CREATE INDEX "ShippingLabel_trackingNumber_idx" ON "ShippingLabel"("trackingNumber");

ALTER TABLE "ShippingLabel" ADD CONSTRAINT "ShippingLabel_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShippingLabel" ADD CONSTRAINT "ShippingLabel_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
