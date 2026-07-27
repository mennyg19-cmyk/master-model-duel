ALTER TABLE "Order"
  ADD COLUMN "guestAccessTokenHash" TEXT,
  ADD COLUMN "guestAccessExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_guestAccessTokenHash_key" ON "Order"("guestAccessTokenHash");
