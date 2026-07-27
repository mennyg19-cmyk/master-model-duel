-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PACKAGE', 'ADD_ON', 'DONATION');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'FINALIZED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('NEW', 'PRINTED', 'PACKED', 'SENT', 'PICKED_UP');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE', 'CASH', 'CHECK', 'COMP');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'POSTED', 'VOIDED', 'REFUNDED');

-- AlterTable
ALTER TABLE "CustomerIdentity" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'CLOSED',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "nextOrderNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ProductKind" NOT NULL DEFAULT 'PACKAGE',
    "priceCents" INTEGER NOT NULL,
    "lengthInches" DECIMAL(8,2),
    "widthInches" DECIMAL(8,2),
    "heightInches" DECIMAL(8,2),
    "weightOunces" DECIMAL(8,2),
    "isInventoryTracked" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "priceAdjustmentCents" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAddOn" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "addOnProductId" TEXT NOT NULL,
    "isRestricted" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReplacement" (
    "id" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "targetProductId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReplacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "emailNormalized" TEXT,
    "phoneNormalized" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "recipientName" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "normalizedAddress" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "geocodedAt" TIMESTAMP(3),

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "orderNumber" INTEGER,
    "draftReference" TEXT NOT NULL,
    "wireFormat" JSONB NOT NULL,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "fulfillmentCents" INTEGER NOT NULL DEFAULT 0,
    "donationCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productOptionId" TEXT,
    "quantity" INTEGER NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "optionSnapshot" JSONB,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineAddOn" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "productAddOnId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "OrderLineAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "addressId" TEXT,
    "fulfillmentMethodId" TEXT NOT NULL,
    "pickupLocationId" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT,
    "greeting" TEXT NOT NULL,
    "groupingKey" TEXT NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'NEW',
    "version" INTEGER NOT NULL DEFAULT 1,
    "packageTypeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageLine" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "PackageLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageAudit" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "externalId" TEXT,
    "postedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripePaymentIntent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
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
    "packageId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "externalRateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lengthInches" DECIMAL(8,2) NOT NULL,
    "widthInches" DECIMAL(8,2) NOT NULL,
    "heightInches" DECIMAL(8,2) NOT NULL,
    "maxWeightOunces" DECIMAL(8,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentBox" (
    "id" TEXT NOT NULL,
    "packageId" TEXT,
    "packageTypeId" TEXT NOT NULL,
    "externalLabelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "productAddOnId" TEXT,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_exactly_one_target"
  CHECK (("productId" IS NULL) <> ("productAddOnId" IS NULL));

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "orderLineAddOnId" TEXT,
    "orderId" TEXT,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeocodeCache" (
    "id" TEXT NOT NULL,
    "normalizedAddress" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "provider" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeocodeCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronRunLog" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "CronRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductIngredient" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "ProductIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyBatch" (
    "id" TEXT NOT NULL,
    "packageTypeId" TEXT,
    "quantity" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyBatchItem" (
    "id" TEXT NOT NULL,
    "assemblyBatchId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantityUsed" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "AssemblyBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Season_year_key" ON "Season"("year");

-- CreateIndex
CREATE INDEX "Product_seasonId_isActive_idx" ON "Product"("seasonId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Product_seasonId_sku_key" ON "Product"("seasonId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_productId_name_value_key" ON "ProductOption"("productId", "name", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAddOn_productId_addOnProductId_key" ON "ProductAddOn"("productId", "addOnProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReplacement_sourceProductId_targetProductId_key" ON "ProductReplacement"("sourceProductId", "targetProductId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_emailNormalized_key" ON "Customer"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phoneNormalized_key" ON "Customer"("phoneNormalized");

-- CreateIndex
CREATE INDEX "Address_postalCode_idx" ON "Address"("postalCode");

-- CreateIndex
CREATE UNIQUE INDEX "Address_customerId_normalizedAddress_key" ON "Address"("customerId", "normalizedAddress");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentMethod_code_key" ON "FulfillmentMethod"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Order_draftReference_key" ON "Order"("draftReference");

-- CreateIndex
CREATE INDEX "Order_seasonId_status_idx" ON "Order"("seasonId", "status");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_seasonId_orderNumber_key" ON "Order"("seasonId", "orderNumber");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLineAddOn_orderLineId_idx" ON "OrderLineAddOn"("orderLineId");

-- CreateIndex
CREATE INDEX "Package_orderId_groupingKey_idx" ON "Package"("orderId", "groupingKey");

-- CreateIndex
CREATE INDEX "Package_status_idx" ON "Package"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PackageLine_packageId_orderLineId_key" ON "PackageLine"("packageId", "orderLineId");

-- CreateIndex
CREATE INDEX "PackageAudit_packageId_createdAt_idx" ON "PackageAudit"("packageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StripePaymentIntent_paymentId_key" ON "StripePaymentIntent"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "StripePaymentIntent_stripeIntentId_key" ON "StripePaymentIntent"("stripeIntentId");

-- CreateIndex
CREATE INDEX "ShippingQuote_packageId_expiresAt_idx" ON "ShippingQuote"("packageId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentBox_externalLabelId_key" ON "ShipmentBox"("externalLabelId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_productId_key" ON "InventoryItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_productAddOnId_key" ON "InventoryItem"("productAddOnId");

-- CreateIndex
CREATE INDEX "InventoryReservation_inventoryItemId_idx" ON "InventoryReservation"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "GeocodeCache_normalizedAddress_key" ON "GeocodeCache"("normalizedAddress");

-- CreateIndex
CREATE INDEX "GeocodeCache_expiresAt_idx" ON "GeocodeCache"("expiresAt");

-- CreateIndex
CREATE INDEX "CronRunLog_jobName_startedAt_idx" ON "CronRunLog"("jobName", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_sku_key" ON "Ingredient"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductIngredient_productId_ingredientId_key" ON "ProductIngredient"("productId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyBatchItem_assemblyBatchId_ingredientId_key" ON "AssemblyBatchItem"("assemblyBatchId", "ingredientId");

-- AddForeignKey
ALTER TABLE "CustomerIdentity" ADD CONSTRAINT "CustomerIdentity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAddOn" ADD CONSTRAINT "ProductAddOn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAddOn" ADD CONSTRAINT "ProductAddOn_addOnProductId_fkey" FOREIGN KEY ("addOnProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReplacement" ADD CONSTRAINT "ProductReplacement_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReplacement" ADD CONSTRAINT "ProductReplacement_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productOptionId_fkey" FOREIGN KEY ("productOptionId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineAddOn" ADD CONSTRAINT "OrderLineAddOn_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineAddOn" ADD CONSTRAINT "OrderLineAddOn_productAddOnId_fkey" FOREIGN KEY ("productAddOnId") REFERENCES "ProductAddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_fulfillmentMethodId_fkey" FOREIGN KEY ("fulfillmentMethodId") REFERENCES "FulfillmentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "PickupLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_packageTypeId_fkey" FOREIGN KEY ("packageTypeId") REFERENCES "PackageType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageLine" ADD CONSTRAINT "PackageLine_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageLine" ADD CONSTRAINT "PackageLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageAudit" ADD CONSTRAINT "PackageAudit_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageAudit" ADD CONSTRAINT "PackageAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripePaymentIntent" ADD CONSTRAINT "StripePaymentIntent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripePaymentIntent" ADD CONSTRAINT "StripePaymentIntent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentBox" ADD CONSTRAINT "ShipmentBox_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentBox" ADD CONSTRAINT "ShipmentBox_packageTypeId_fkey" FOREIGN KEY ("packageTypeId") REFERENCES "PackageType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productAddOnId_fkey" FOREIGN KEY ("productAddOnId") REFERENCES "ProductAddOn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderLineAddOnId_fkey" FOREIGN KEY ("orderLineAddOnId") REFERENCES "OrderLineAddOn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIngredient" ADD CONSTRAINT "ProductIngredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIngredient" ADD CONSTRAINT "ProductIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyBatchItem" ADD CONSTRAINT "AssemblyBatchItem_assemblyBatchId_fkey" FOREIGN KEY ("assemblyBatchId") REFERENCES "AssemblyBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyBatchItem" ADD CONSTRAINT "AssemblyBatchItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
