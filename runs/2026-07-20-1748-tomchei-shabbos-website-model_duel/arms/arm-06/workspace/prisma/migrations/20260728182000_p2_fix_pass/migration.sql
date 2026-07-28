-- P2 fix pass (AGGREGATE-REVIEW-P2):
--  A-M1: customers.normalizedPhone is now unique (phone dedupe arm is race-safe).
--  A-M5: order_lines.parentLineId self-FK ON DELETE CASCADE (no orphaned add-on lines).
--  A-M3/A-m7: order_lines product/optionValue/addOn ids are real FKs (RESTRICT —
--  catalog rows with order history cannot be deleted) + line-kind CHECK.
--  A-m6: partial unique index enforces a single OPEN season.
--  A-m8: packages.recipientAddressId ON DELETE RESTRICT (groupingKey can't go stale).
--  A-m9: stripe_payment_intents.clientSecret dropped (payment credential not stored).
--  A-m14: shipping_quotes target XOR CHECK (exactly one of orderId/packageId).
--  A-m21: addresses (customerId, label) unique (seed upserts on it).

-- DropForeignKey
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_parentLineId_fkey";

-- DropForeignKey
ALTER TABLE "packages" DROP CONSTRAINT "packages_recipientAddressId_fkey";

-- DropIndex
DROP INDEX "customers_normalizedPhone_idx";

-- AlterTable
ALTER TABLE "stripe_payment_intents" DROP COLUMN "clientSecret";

-- CreateIndex
CREATE UNIQUE INDEX "addresses_customerId_label_key" ON "addresses"("customerId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "customers_normalizedPhone_key" ON "customers"("normalizedPhone");

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_parentLineId_fkey" FOREIGN KEY ("parentLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "product_option_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "add_ons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_recipientAddressId_fkey" FOREIGN KEY ("recipientAddressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OrderLine line-kind integrity: exactly one of productId/addOnId; add-on
-- lines must reference a parent line; product lines must not.
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_line_kind" CHECK (
  (("productId" IS NULL) <> ("addOnId" IS NULL))
  AND ("addOnId" IS NULL OR "parentLineId" IS NOT NULL)
  AND ("productId" IS NULL OR "parentLineId" IS NULL)
);

-- Shipping quotes target exactly one of order | package.
ALTER TABLE "shipping_quotes" ADD CONSTRAINT "shipping_quotes_target_xor" CHECK (
  ("orderId" IS NULL) <> ("packageId" IS NULL)
);

-- Single OPEN season (UR-008 gates all selling on the one open season).
CREATE UNIQUE INDEX "seasons_single_open" ON "seasons"("status") WHERE "status" = 'OPEN';
