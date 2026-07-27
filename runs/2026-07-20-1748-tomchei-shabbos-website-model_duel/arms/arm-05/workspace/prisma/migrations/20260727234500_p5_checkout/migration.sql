ALTER TABLE "Address" ADD COLUMN "greetingPreference" TEXT;

CREATE TABLE "CheckoutSession" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "providerSessionId" TEXT NOT NULL,
  "providerIntentId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutSession_providerSessionId_key" ON "CheckoutSession"("providerSessionId");
CREATE INDEX "CheckoutSession_orderId_status_idx" ON "CheckoutSession"("orderId", "status");
CREATE UNIQUE INDEX "WebhookEvent_provider_externalId_key" ON "WebhookEvent"("provider", "externalId");

ALTER TABLE "CheckoutSession"
  ADD CONSTRAINT "CheckoutSession_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
