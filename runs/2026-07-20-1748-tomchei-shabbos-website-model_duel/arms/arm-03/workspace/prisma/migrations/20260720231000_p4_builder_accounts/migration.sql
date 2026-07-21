-- CreateEnum
CREATE TYPE "OrderDraftStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DISCARDED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "passwordHash" TEXT;

-- AlterTable (backfill-safe: existing rows get a key derived from their fields)
ALTER TABLE "CustomerAddress" ADD COLUMN     "normalizedKey" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3);
UPDATE "CustomerAddress" SET
  "normalizedKey" = lower(regexp_replace(
    "recipient" || '|' || "line1" || '|' || coalesce("line2", '') || '|' || "city" || '|' || "state" || '|' || "zip",
    '[^a-zA-Z0-9|]+', ' ', 'g')),
  "updatedAt" = "createdAt";
ALTER TABLE "CustomerAddress" ALTER COLUMN "normalizedKey" SET NOT NULL,
ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDraft" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "customerId" TEXT,
    "guestTokenHash" TEXT,
    "cart" JSONB NOT NULL,
    "status" "OrderDraftStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "OrderDraft_guestTokenHash_key" ON "OrderDraft"("guestTokenHash");

-- CreateIndex
CREATE INDEX "OrderDraft_customerId_status_idx" ON "OrderDraft"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAddress_customerId_normalizedKey_key" ON "CustomerAddress"("customerId", "normalizedKey");

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A draft belongs to a customer or a guest token, never both, never neither
-- (Prisma cannot express CHECK constraints; same pattern as InventoryItem).
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_owner_check"
  CHECK (("customerId" IS NOT NULL AND "guestTokenHash" IS NULL) OR ("customerId" IS NULL AND "guestTokenHash" IS NOT NULL));
