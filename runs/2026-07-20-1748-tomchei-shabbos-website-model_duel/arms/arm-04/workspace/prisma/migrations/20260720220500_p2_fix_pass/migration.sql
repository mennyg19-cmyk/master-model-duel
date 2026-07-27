-- P2 fix pass.

-- A9: one snapshot row per (line, option) / (line, add-on) — duplicates would
-- double-count in price aggregation.
CREATE UNIQUE INDEX "OrderLineOption_orderLineId_productOptionId_key" ON "OrderLineOption"("orderLineId", "productOptionId");
CREATE UNIQUE INDEX "OrderLineAddOn_orderLineId_addOnId_key" ON "OrderLineAddOn"("orderLineId", "addOnId");

-- A8: a shipping quote must attach to an order or a package (mirrors
-- InventoryItem_target_xor; Prisma cannot express CHECK constraints).
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_target_present"
  CHECK (("orderId" IS NOT NULL) OR ("packageId" IS NOT NULL));

-- A5: at most one still-NEW package per (season, grouping key). Partial unique
-- index (Prisma cannot express these) backstopping the advisory-lock
-- serialization in lib/domain/finalize.ts.
CREATE UNIQUE INDEX "Package_seasonId_groupingKey_new_key"
  ON "Package"("seasonId", "groupingKey") WHERE "stage" = 'NEW';
