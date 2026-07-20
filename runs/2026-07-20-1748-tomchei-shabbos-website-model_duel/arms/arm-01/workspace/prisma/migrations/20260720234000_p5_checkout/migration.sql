ALTER TYPE "PaymentIntentStatus" ADD VALUE 'FAILED';

ALTER TABLE "CustomerAddress"
ADD COLUMN "rememberedGreeting" TEXT;

ALTER TABLE "Order"
ADD COLUMN "donationCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "defaultGreeting" TEXT NOT NULL DEFAULT '',
ADD COLUMN "confirmationTriggeredAt" TIMESTAMP(3);

ALTER TABLE "OrderLine"
ADD COLUMN "fulfillmentMethodId" TEXT,
ADD COLUMN "fulfillmentFeeCentsSnapshot" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "greetingSnapshot" TEXT NOT NULL DEFAULT '',
ADD COLUMN "deliveryDay" TEXT;

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_fulfillmentMethodId_fkey"
FOREIGN KEY ("fulfillmentMethodId") REFERENCES "FulfillmentMethod"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OrderLine_fulfillmentMethodId_idx"
ON "OrderLine"("fulfillmentMethodId");

CREATE UNIQUE INDEX "Payment_method_reference_key"
ON "Payment"("method", "reference");

ALTER TABLE "StripePaymentIntent"
ADD COLUMN "stripeCheckoutSessionId" TEXT;

CREATE UNIQUE INDEX "StripePaymentIntent_stripeCheckoutSessionId_key"
ON "StripePaymentIntent"("stripeCheckoutSessionId");

CREATE TABLE "StripeWebhookEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicRequestThrottle" (
  "key" TEXT NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicRequestThrottle_pkey" PRIMARY KEY ("key")
);
