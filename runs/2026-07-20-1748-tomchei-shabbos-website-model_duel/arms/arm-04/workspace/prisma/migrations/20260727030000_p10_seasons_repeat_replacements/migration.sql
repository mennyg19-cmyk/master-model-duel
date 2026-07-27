-- P10. Several retired products routinely fold into one survivor when a
-- catalogue is trimmed, so the replacement link stops being one-to-one. The
-- plain index replaces the unique one because the chain walk reads by this
-- column.
DROP INDEX "Product_replacedByProductId_key";

-- CreateIndex
CREATE INDEX "Product_replacedByProductId_idx" ON "Product"("replacedByProductId");

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "importedOrderReference" TEXT;

-- The old system's order number, unique inside its season so re-running the
-- year-one import hook corrects the order it already wrote instead of giving a
-- family two copies of their history. Null for everything this app took itself.
CREATE UNIQUE INDEX "Order_seasonId_importedOrderReference_key" ON "Order"("seasonId", "importedOrderReference");
