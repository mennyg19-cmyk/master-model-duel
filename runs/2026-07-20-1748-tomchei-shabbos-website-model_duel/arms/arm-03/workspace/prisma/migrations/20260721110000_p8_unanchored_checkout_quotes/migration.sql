-- P8: checkout quotes happen BEFORE an order exists (live rate preview), so a
-- ShippingQuote may now be unanchored. Disallow only the nonsense case of
-- pointing at both an order and a package at once.
ALTER TABLE "ShippingQuote" DROP CONSTRAINT "ShippingQuote_target_present";
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_target_present"
  CHECK (NOT ("orderId" IS NOT NULL AND "packageId" IS NOT NULL));
