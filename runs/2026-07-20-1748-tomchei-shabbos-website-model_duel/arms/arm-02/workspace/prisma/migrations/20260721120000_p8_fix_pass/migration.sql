-- P8 fix pass.

-- M6: link a Shipment to the ShippingQuote its charge is anchored to (the
-- customer-paid checkout quote when matched, else the label-time quote).
ALTER TABLE "Shipment" ADD COLUMN "quoteId" TEXT;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "ShippingQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- M2: at most one ACTIVE label per package. Partial unique index (Prisma
-- cannot express these — same pattern as Package_seasonId_groupingKey_new_key)
-- backstopping the advisory-lock serialization in lib/shipping/labels.ts.
CREATE UNIQUE INDEX "Shipment_packageId_purchased_key"
  ON "Shipment"("packageId") WHERE "status" = 'PURCHASED';
