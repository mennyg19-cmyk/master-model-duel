ALTER TABLE "Package" ADD COLUMN "pickupExpiredAt" TIMESTAMP(3);
CREATE INDEX "Package_pickupExpiresAt_pickupExpiredAt_idx" ON "Package"("pickupExpiresAt", "pickupExpiredAt");
