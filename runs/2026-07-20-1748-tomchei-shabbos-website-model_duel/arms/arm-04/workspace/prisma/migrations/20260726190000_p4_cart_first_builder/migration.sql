-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "guestTokenHash" TEXT,
ALTER COLUMN "customerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderLine" ALTER COLUMN "recipientName" DROP NOT NULL,
ALTER COLUMN "fulfillmentMethodId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_guestTokenHash_key" ON "Order"("guestTokenHash");

-- Hand-written: Prisma's schema language cannot express a CHECK, and
-- scripts/migration-guard.ts asserts both of these survive a replay.

-- Every order is owned by somebody: an account, a guest access token, or (after
-- a guest signs in and claims their draft) both. An order with neither is a row
-- nobody can read back, which is exactly what anti-enumeration relies on.
ALTER TABLE "Order" ADD CONSTRAINT "Order_has_owner"
  CHECK ("customerId" IS NOT NULL OR "guestTokenHash" IS NOT NULL);

-- A cart line is either unassigned (both null, still waiting for a recipient) or
-- fully assigned. Half of an assignment is a destination no package could be
-- built from.
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_assignment_complete"
  CHECK (("recipientName" IS NULL) = ("fulfillmentMethodId" IS NULL));
