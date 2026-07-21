-- P8 fix: label buy idempotency + one active PURCHASED label per package

ALTER TABLE "ShippingLabel" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ShippingLabel_idempotencyKey_key"
  ON "ShippingLabel"("idempotencyKey");

CREATE UNIQUE INDEX IF NOT EXISTS "ShippingLabel_packageId_purchased_uidx"
  ON "ShippingLabel"("packageId")
  WHERE status = 'PURCHASED';
