CREATE TYPE "RecipientAssignmentSource" AS ENUM ('ON_ORDER', 'ADDRESS_BOOK', 'NEW_RECIPIENT');

ALTER TABLE "CustomerAddress"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Order"
ADD COLUMN "guestAccessTokenHash" TEXT,
ADD COLUMN "guestAccessExpiresAt" TIMESTAMP(3);

ALTER TABLE "OrderLine"
ADD COLUMN "recipientAddressId" TEXT,
ADD COLUMN "recipientSource" "RecipientAssignmentSource",
ADD COLUMN "recipientNameSnapshot" TEXT;

CREATE UNIQUE INDEX "Order_guestAccessTokenHash_key" ON "Order"("guestAccessTokenHash");
CREATE INDEX "OrderLine_recipientAddressId_idx" ON "OrderLine"("recipientAddressId");

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_recipientAddressId_fkey"
FOREIGN KEY ("recipientAddressId") REFERENCES "CustomerAddress"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
