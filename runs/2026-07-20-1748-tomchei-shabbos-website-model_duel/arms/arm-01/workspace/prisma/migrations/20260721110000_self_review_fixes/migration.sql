ALTER TABLE "ImpersonationSession"
ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour');

ALTER TABLE "StripePaymentIntent"
ADD COLUMN "checkoutFingerprint" TEXT NOT NULL DEFAULT '';

CREATE INDEX "ImpersonationSession_actorStaffId_expiresAt_idx"
ON "ImpersonationSession"("actorStaffId", "expiresAt");

ALTER TABLE "ImpersonationSession" ALTER COLUMN "expiresAt" DROP DEFAULT;
ALTER TABLE "StripePaymentIntent" ALTER COLUMN "checkoutFingerprint" DROP DEFAULT;
