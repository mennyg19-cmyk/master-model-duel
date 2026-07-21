-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CHECKOUT_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_POSTED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_VOIDED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_REFUNDED';
ALTER TYPE "AuditAction" ADD VALUE 'SAFETY_REFUND';
ALTER TYPE "AuditAction" ADD VALUE 'ORDER_PAID';

-- AlterTable Order
ALTER TABLE "Order" ADD COLUMN "expectedTotalCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN "donationCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "fulfillmentFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "checkoutSnapshot" JSONB;

-- AlterTable Payment
ALTER TABLE "Payment" ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "stripeChargeId" TEXT;

-- CreateTable
CREATE TABLE "RecipientGreetingMemory" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "greeting" TEXT NOT NULL,
    "lastSeasonId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipientGreetingMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecipientGreetingMemory_customerId_recipientKey_key" ON "RecipientGreetingMemory"("customerId", "recipientKey");
CREATE INDEX "RecipientGreetingMemory_customerId_idx" ON "RecipientGreetingMemory"("customerId");

ALTER TABLE "RecipientGreetingMemory" ADD CONSTRAINT "RecipientGreetingMemory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StripeCheckoutSession" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeCheckoutSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeCheckoutSession_stripeSessionId_key" ON "StripeCheckoutSession"("stripeSessionId");
CREATE INDEX "StripeCheckoutSession_orderId_idx" ON "StripeCheckoutSession"("orderId");

ALTER TABLE "StripeCheckoutSession" ADD CONSTRAINT "StripeCheckoutSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeWebhookEvent_eventId_key" ON "StripeWebhookEvent"("eventId");
