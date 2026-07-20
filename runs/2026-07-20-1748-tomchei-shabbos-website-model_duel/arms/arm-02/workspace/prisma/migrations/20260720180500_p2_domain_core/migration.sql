-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('STANDARD', 'BUILD_YOUR_OWN', 'GIFT_CARD');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'FINALIZED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'COMPED');

-- CreateEnum
CREATE TYPE "PackageStage" AS ENUM ('NEW', 'PRINTED', 'PACKED', 'SENT', 'PICKED_UP');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE', 'CASH', 'CHECK', 'COMP');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('POSTED', 'VOIDED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "phoneNormalized" TEXT;

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "recipient" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geocodedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'CLOSED',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "orderCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ProductKind" NOT NULL DEFAULT 'STANDARD',
    "basePriceCents" INTEGER NOT NULL,
    "widthCm" DOUBLE PRECISION,
    "lengthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "weightGrams" INTEGER,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "replacementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceAdjustmentCents" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOnRestriction" (
    "addOnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "AddOnRestriction_pkey" PRIMARY KEY ("addOnId","productId")
);

-- CreateTable
CREATE TABLE "FulfillmentMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FulfillmentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "draftReference" TEXT NOT NULL,
    "orderNumber" INTEGER,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "finalizedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "recipientName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "fulfillmentMethodId" TEXT NOT NULL,
    "greeting" TEXT NOT NULL DEFAULT '',
    "packageId" TEXT,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineOption" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "productOptionId" TEXT NOT NULL,
    "priceAdjustmentCents" INTEGER NOT NULL,

    CONSTRAINT "OrderLineOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineAddOn" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "OrderLineAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "groupingKey" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "fulfillmentMethodId" TEXT NOT NULL,
    "greeting" TEXT NOT NULL DEFAULT '',
    "stage" "PackageStage" NOT NULL DEFAULT 'NEW',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageAudit" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "actorStaffId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "state" "PaymentState" NOT NULL DEFAULT 'POSTED',
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripePaymentIntent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stripeIntentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripePaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingQuote" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "packageId" TEXT,
    "provider" TEXT NOT NULL,
    "quotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingQuoteOption" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "estimatedDays" INTEGER,

    CONSTRAINT "ShippingQuoteOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PickupLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthCm" DOUBLE PRECISION,
    "lengthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "weightGrams" INTEGER,

    CONSTRAINT "PackageType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentBox" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthCm" DOUBLE PRECISION,
    "lengthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "weightGrams" INTEGER,

    CONSTRAINT "ShipmentBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "addOnId" TEXT,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeocodeCache" (
    "id" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeocodeCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronRunLog" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "detail" JSONB,

    CONSTRAINT "CronRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomLine" (
    "productId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BomLine_pkey" PRIMARY KEY ("productId","ingredientId")
);

-- CreateTable
CREATE TABLE "AssemblyBatch" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "assembledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "AssemblyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Season_name_key" ON "Season"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_seasonId_slug_key" ON "Product"("seasonId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_productId_name_key" ON "ProductOption"("productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AddOn_seasonId_name_key" ON "AddOn"("seasonId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentMethod_code_key" ON "FulfillmentMethod"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Order_draftReference_key" ON "Order"("draftReference");

-- CreateIndex
CREATE UNIQUE INDEX "Order_seasonId_orderNumber_key" ON "Order"("seasonId", "orderNumber");

-- CreateIndex
CREATE INDEX "Package_seasonId_groupingKey_idx" ON "Package"("seasonId", "groupingKey");

-- CreateIndex
CREATE INDEX "PackageAudit_packageId_createdAt_idx" ON "PackageAudit"("packageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StripePaymentIntent_stripeIntentId_key" ON "StripePaymentIntent"("stripeIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageType_name_key" ON "PackageType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentBox_name_key" ON "ShipmentBox"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_productId_key" ON "InventoryItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_addOnId_key" ON "InventoryItem"("addOnId");

-- CreateIndex
CREATE UNIQUE INDEX "GeocodeCache_addressHash_key" ON "GeocodeCache"("addressHash");

-- CreateIndex
CREATE INDEX "CronRunLog_jobName_startedAt_idx" ON "CronRunLog"("jobName", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_name_key" ON "Ingredient"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phoneNormalized_key" ON "Customer"("phoneNormalized");

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_replacementId_fkey" FOREIGN KEY ("replacementId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnRestriction" ADD CONSTRAINT "AddOnRestriction_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnRestriction" ADD CONSTRAINT "AddOnRestriction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_fulfillmentMethodId_fkey" FOREIGN KEY ("fulfillmentMethodId") REFERENCES "FulfillmentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineOption" ADD CONSTRAINT "OrderLineOption_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineOption" ADD CONSTRAINT "OrderLineOption_productOptionId_fkey" FOREIGN KEY ("productOptionId") REFERENCES "ProductOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineAddOn" ADD CONSTRAINT "OrderLineAddOn_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineAddOn" ADD CONSTRAINT "OrderLineAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_fulfillmentMethodId_fkey" FOREIGN KEY ("fulfillmentMethodId") REFERENCES "FulfillmentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageAudit" ADD CONSTRAINT "PackageAudit_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripePaymentIntent" ADD CONSTRAINT "StripePaymentIntent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuoteOption" ADD CONSTRAINT "ShippingQuoteOption_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ShippingQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyBatch" ADD CONSTRAINT "AssemblyBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- XOR integrity (R-139): an inventory item targets exactly one of product / add-on.
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_target_xor" CHECK (("productId" IS NULL) <> ("addOnId" IS NULL));
