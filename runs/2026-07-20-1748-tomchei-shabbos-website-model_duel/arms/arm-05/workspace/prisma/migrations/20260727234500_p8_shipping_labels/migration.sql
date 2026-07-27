ALTER TABLE "ShipmentBox"
  ADD COLUMN "carrier" TEXT,
  ADD COLUMN "service" TEXT,
  ADD COLUMN "chargedCents" INTEGER,
  ADD COLUMN "labelCostCents" INTEGER,
  ADD COLUMN "marginCents" INTEGER,
  ADD COLUMN "labelUrl" TEXT,
  ADD COLUMN "trackingNumber" TEXT,
  ADD COLUMN "trackingStatus" TEXT,
  ADD COLUMN "labelVoidedAt" TIMESTAMP(3),
  ADD COLUMN "lastTrackedAt" TIMESTAMP(3);

CREATE INDEX "ShipmentBox_packageId_labelVoidedAt_idx" ON "ShipmentBox"("packageId", "labelVoidedAt");
