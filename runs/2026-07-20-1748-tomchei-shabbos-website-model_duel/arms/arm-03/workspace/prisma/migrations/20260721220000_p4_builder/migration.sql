-- P4: cart-first drafts, guest tokens, address-book norm + audits

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ADDRESS_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADDRESS_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADDRESS_STAFF_EDITED';
ALTER TYPE "AuditAction" ADD VALUE 'DRAFT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'DRAFT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'DRAFT_GUEST_CLEARED';

-- SavedAddress: normalized dedupe key
ALTER TABLE "SavedAddress" ADD COLUMN "addressNorm" TEXT;

-- Must match lib/address/normalize.ts buildAddressNorm: per-field trim+lower+collapse whitespace
UPDATE "SavedAddress"
SET "addressNorm" = concat_ws('|',
  regexp_replace(lower(trim(both FROM coalesce("recipientName", ''))), E'\\s+', ' ', 'g'),
  regexp_replace(lower(trim(both FROM coalesce("line1", ''))), E'\\s+', ' ', 'g'),
  regexp_replace(lower(trim(both FROM coalesce("line2", ''))), E'\\s+', ' ', 'g'),
  regexp_replace(lower(trim(both FROM coalesce("city", ''))), E'\\s+', ' ', 'g'),
  regexp_replace(lower(trim(both FROM coalesce("state", ''))), E'\\s+', ' ', 'g'),
  regexp_replace(lower(trim(both FROM coalesce("postalCode", ''))), E'\\s+', ' ', 'g'),
  regexp_replace(lower(trim(both FROM coalesce("country", 'US'))), E'\\s+', ' ', 'g')
);

ALTER TABLE "SavedAddress" ALTER COLUMN "addressNorm" SET NOT NULL;

CREATE UNIQUE INDEX "SavedAddress_customerId_addressNorm_key" ON "SavedAddress"("customerId", "addressNorm");

-- Order: guest access
ALTER TABLE "Order" ADD COLUMN "guestAccessTokenHash" TEXT;
ALTER TABLE "Order" ADD COLUMN "guestTokenVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Order" ADD COLUMN "guestClearedAt" TIMESTAMP(3);

CREATE INDEX "Order_guestAccessTokenHash_idx" ON "Order"("guestAccessTokenHash");

-- OrderLine: cart-first nullable recipient / fulfillment
ALTER TABLE "OrderLine" ALTER COLUMN "recipientName" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "addressLine1" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "state" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "postalCode" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "country" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "fulfillmentMethodId" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "groupingKey" SET DEFAULT 'unassigned';
