-- CreateEnum
CREATE TYPE "ShippingLabelStatus" AS ENUM ('PENDING', 'PURCHASED', 'FAILED', 'VOID_PENDING', 'VOIDED');

-- CreateEnum
CREATE TYPE "ShippingQuoteSource" AS ENUM ('LIVE', 'FALLBACK');

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "addressIsValid" BOOLEAN,
ADD COLUMN     "addressValidatedAt" TIMESTAMP(3),
ADD COLUMN     "addressValidationNote" TEXT;

-- AlterTable
ALTER TABLE "ShipmentBox" ADD COLUMN     "carrierCostCents" INTEGER,
ADD COLUMN     "customerPriceCents" INTEGER,
ADD COLUMN     "failureMessage" TEXT,
ADD COLUMN     "marginCents" INTEGER,
ADD COLUMN     "parcelIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "providerRateId" TEXT,
ADD COLUMN     "providerTransactionId" TEXT,
ADD COLUMN     "purchasedAt" TIMESTAMP(3),
ADD COLUMN     "serviceLabel" TEXT,
ADD COLUMN     "status" "ShippingLabelStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "trackingCheckedAt" TIMESTAMP(3),
ADD COLUMN     "trackingStatus" TEXT,
ADD COLUMN     "voidReason" TEXT;

-- `updatedAt` is maintained by the application, so it has no database default.
-- Boxes that already exist are stamped with their creation time rather than with
-- now(), which would claim every historic label was touched by this migration.
ALTER TABLE "ShipmentBox" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "ShipmentBox" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "ShipmentBox" ALTER COLUMN "updatedAt" SET NOT NULL;

-- Labels bought before this phase were recorded by hand, so they are purchased
-- rather than pending: PENDING means "a carrier call is in flight right now".
UPDATE "ShipmentBox" SET "status" = 'PURCHASED' WHERE "trackingNumber" IS NOT NULL AND "voidedAt" IS NULL;
UPDATE "ShipmentBox" SET "status" = 'VOIDED' WHERE "voidedAt" IS NOT NULL;

-- AlterTable
ALTER TABLE "ShippingQuote" ADD COLUMN     "billableWeightGrams" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "customerPriceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "groupingKey" TEXT,
ADD COLUMN     "parcelCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "source" "ShippingQuoteSource" NOT NULL DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "ShippingQuoteOption" ADD COLUMN     "isEligible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "providerRateId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentBox_providerTransactionId_key" ON "ShipmentBox"("providerTransactionId");

-- CreateIndex
CREATE INDEX "ShipmentBox_status_idx" ON "ShipmentBox"("status");
