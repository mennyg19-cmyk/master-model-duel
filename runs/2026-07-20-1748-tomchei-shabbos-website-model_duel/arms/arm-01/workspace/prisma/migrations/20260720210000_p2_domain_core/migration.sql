-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PACKAGE', 'ADD_ON', 'DONATION');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CachedPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PackageStage" AS ENUM ('NEW', 'PRINTED', 'PACKED', 'SENT', 'PICKED_UP');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE', 'CASH', 'CHECK', 'COMP');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InventoryTargetKind" AS ENUM ('PRODUCT', 'ADD_ON');

-- CreateEnum
CREATE TYPE "AssemblyBatchStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "CustomerAccount" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'CLOSED',
    "scheduledStatus" "SeasonStatus",
    "scheduledStatusAt" TIMESTAMP(3),
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
    "kind" "ProductKind" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "widthMm" INTEGER,
    "heightMm" INTEGER,
    "depthMm" INTEGER,
    "weightGrams" INTEGER,
    "tracksInventory" BOOLEAN NOT NULL DEFAULT true,
    "isFinishedPackage" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "replacementProductId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
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
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAllowedAddOn" (
    "productId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,

    CONSTRAINT "ProductAllowedAddOn_pkey" PRIMARY KEY ("productId","addOnId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "emailNormalized" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "recipientName" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'US',
    "normalizedKey" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "geocodedAt" TIMESTAMP(3),
    "geocodeProvider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderNumber" INTEGER,
    "draftReference" TEXT NOT NULL,
    "wireFormatVersion" INTEGER NOT NULL DEFAULT 1,
    "cachedPaymentStatus" "CachedPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
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
    "productNameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "unitPriceCentsSnapshot" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineAddOn" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "addOnProductId" TEXT NOT NULL,
    "addOnNameSnapshot" TEXT NOT NULL,
    "unitPriceCentsSnapshot" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderLineAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentMethod" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "requiresAddress" BOOLEAN NOT NULL DEFAULT true,
    "isPickup" BOOLEAN NOT NULL DEFAULT false,
    "isShipping" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FulfillmentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "recipientAddressId" TEXT,
    "fulfillmentMethodId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "addressSnapshot" JSONB,
    "greetingSnapshot" TEXT NOT NULL,
    "groupingKey" TEXT NOT NULL,
    "stage" "PackageStage" NOT NULL DEFAULT 'NEW',
    "version" INTEGER NOT NULL DEFAULT 1,
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
    "actorStaffId" TEXT,
    "action" TEXT NOT NULL,
    "fromStage" "PackageStage",
    "toStage" "PackageStage",
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT,
    "postedByStaffId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripePaymentIntent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripePaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingQuote" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "providerQuoteId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "selectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupLocation" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" JSONB NOT NULL,
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PickupLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageType" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "innerWidthMm" INTEGER NOT NULL,
    "innerHeightMm" INTEGER NOT NULL,
    "innerDepthMm" INTEGER NOT NULL,
    "maxWeightGrams" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackageType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentBox" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "packageTypeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "weightGrams" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "targetKind" "InventoryTargetKind" NOT NULL,
    "productId" TEXT,
    "addOnId" TEXT,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeocodeCache" (
    "id" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "formattedAddress" TEXT,
    "failureCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeocodeCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "claimed" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "onHand" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductIngredient" (
    "productId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "ProductIngredient_pkey" PRIMARY KEY ("productId","ingredientId")
);

-- CreateTable
CREATE TABLE "AssemblyBatch" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "AssemblyBatchStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyBatchUse" (
    "assemblyBatchId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "AssemblyBatchUse_pkey" PRIMARY KEY ("assemblyBatchId","ingredientId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Season_year_key" ON "Season"("year");

-- CreateIndex
CREATE INDEX "Season_status_scheduledStatusAt_idx" ON "Season"("status", "scheduledStatusAt");

-- CreateIndex
CREATE INDEX "Product_seasonId_kind_isActive_idx" ON "Product"("seasonId", "kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Product_seasonId_sku_key" ON "Product"("seasonId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_productId_name_value_key" ON "ProductOption"("productId", "name", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_emailNormalized_key" ON "Customer"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phoneNormalized_key" ON "Customer"("phoneNormalized");

-- CreateIndex
CREATE INDEX "Customer_displayName_idx" ON "Customer"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAddress_customerId_normalizedKey_key" ON "CustomerAddress"("customerId", "normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_draftReference_key" ON "Order"("draftReference");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_seasonId_status_idx" ON "Order"("seasonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_seasonId_orderNumber_key" ON "Order"("seasonId", "orderNumber");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLineAddOn_orderLineId_idx" ON "OrderLineAddOn"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentMethod_seasonId_code_key" ON "FulfillmentMethod"("seasonId", "code");

-- CreateIndex
CREATE INDEX "Package_orderId_groupingKey_idx" ON "Package"("orderId", "groupingKey");

-- CreateIndex
CREATE INDEX "Package_stage_updatedAt_idx" ON "Package"("stage", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PackageLine_packageId_orderLineId_key" ON "PackageLine"("packageId", "orderLineId");

-- CreateIndex
CREATE INDEX "PackageAudit_packageId_occurredAt_idx" ON "PackageAudit"("packageId", "occurredAt");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StripePaymentIntent_stripePaymentIntentId_key" ON "StripePaymentIntent"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "StripePaymentIntent_idempotencyKey_key" ON "StripePaymentIntent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StripePaymentIntent_orderId_status_idx" ON "StripePaymentIntent"("orderId", "status");

-- CreateIndex
CREATE INDEX "ShippingQuote_packageId_expiresAt_idx" ON "ShippingQuote"("packageId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PickupLocation_seasonId_name_key" ON "PickupLocation"("seasonId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PackageType_seasonId_name_key" ON "PackageType"("seasonId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentBox_packageId_sequence_key" ON "ShipmentBox"("packageId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_productId_key" ON "InventoryItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_addOnId_key" ON "InventoryItem"("addOnId");

-- CreateIndex
CREATE INDEX "InventoryItem_targetKind_idx" ON "InventoryItem"("targetKind");

-- CreateIndex
CREATE UNIQUE INDEX "GeocodeCache_normalizedKey_key" ON "GeocodeCache"("normalizedKey");

-- CreateIndex
CREATE INDEX "GeocodeCache_expiresAt_idx" ON "GeocodeCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CronRun_runKey_key" ON "CronRun"("runKey");

-- CreateIndex
CREATE INDEX "CronRun_jobName_startedAt_idx" ON "CronRun"("jobName", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_sku_key" ON "Ingredient"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyBatch_seasonId_reference_key" ON "AssemblyBatch"("seasonId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_customerId_key" ON "CustomerAccount"("customerId");

-- AddForeignKey
ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_replacementProductId_fkey" FOREIGN KEY ("replacementProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAllowedAddOn" ADD CONSTRAINT "ProductAllowedAddOn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAllowedAddOn" ADD CONSTRAINT "ProductAllowedAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productOptionId_fkey" FOREIGN KEY ("productOptionId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineAddOn" ADD CONSTRAINT "OrderLineAddOn_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineAddOn" ADD CONSTRAINT "OrderLineAddOn_addOnProductId_fkey" FOREIGN KEY ("addOnProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentMethod" ADD CONSTRAINT "FulfillmentMethod_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_recipientAddressId_fkey" FOREIGN KEY ("recipientAddressId") REFERENCES "CustomerAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_fulfillmentMethodId_fkey" FOREIGN KEY ("fulfillmentMethodId") REFERENCES "FulfillmentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageLine" ADD CONSTRAINT "PackageLine_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageLine" ADD CONSTRAINT "PackageLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageAudit" ADD CONSTRAINT "PackageAudit_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripePaymentIntent" ADD CONSTRAINT "StripePaymentIntent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupLocation" ADD CONSTRAINT "PickupLocation_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageType" ADD CONSTRAINT "PackageType_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentBox" ADD CONSTRAINT "ShipmentBox_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentBox" ADD CONSTRAINT "ShipmentBox_packageTypeId_fkey" FOREIGN KEY ("packageTypeId") REFERENCES "PackageType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIngredient" ADD CONSTRAINT "ProductIngredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIngredient" ADD CONSTRAINT "ProductIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyBatch" ADD CONSTRAINT "AssemblyBatch_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyBatchUse" ADD CONSTRAINT "AssemblyBatchUse_assemblyBatchId_fkey" FOREIGN KEY ("assemblyBatchId") REFERENCES "AssemblyBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyBatchUse" ADD CONSTRAINT "AssemblyBatchUse_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain integrity that Prisma's schema language cannot express.
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_target_xor_check"
CHECK (
  ("targetKind" = 'PRODUCT' AND "productId" IS NOT NULL AND "addOnId" IS NULL)
  OR
  ("targetKind" = 'ADD_ON' AND "productId" IS NULL AND "addOnId" IS NOT NULL)
);

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_quantity_check"
CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand");

ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_quantity_check"
CHECK ("quantity" > 0 AND "unitPriceCentsSnapshot" >= 0);

ALTER TABLE "OrderLineAddOn" ADD CONSTRAINT "OrderLineAddOn_quantity_check"
CHECK ("quantity" > 0 AND "unitPriceCentsSnapshot" >= 0);
