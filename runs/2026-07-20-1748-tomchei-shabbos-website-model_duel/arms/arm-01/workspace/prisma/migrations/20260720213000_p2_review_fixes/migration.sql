DROP INDEX "Package_orderId_groupingKey_idx";

CREATE UNIQUE INDEX "Package_orderId_groupingKey_key"
ON "Package"("orderId", "groupingKey");

ALTER TABLE "Order"
ADD CONSTRAINT "Order_subtotalCents_nonnegative"
CHECK ("subtotalCents" >= 0),
ADD CONSTRAINT "Order_totalCents_nonnegative"
CHECK ("totalCents" >= 0);

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_amountCents_positive"
CHECK ("amountCents" > 0);

ALTER TABLE "StripePaymentIntent"
ADD CONSTRAINT "StripePaymentIntent_amountCents_positive"
CHECK ("amountCents" > 0);

ALTER TABLE "ShippingQuote"
ADD CONSTRAINT "ShippingQuote_amountCents_nonnegative"
CHECK ("amountCents" >= 0);
