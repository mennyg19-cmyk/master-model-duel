-- CreateEnum
CREATE TYPE "FulfillmentKind" AS ENUM ('BULK_DELIVERY', 'PER_PACKAGE_DELIVERY', 'SHIPPING', 'PICKUP');

-- AlterTable
ALTER TABLE "CustomerAddress" ADD COLUMN     "lastGreeting" TEXT;

-- AlterTable
ALTER TABLE "FulfillmentMethod" ADD COLUMN     "kind" "FulfillmentKind" NOT NULL DEFAULT 'PICKUP';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryDay" TEXT,
ADD COLUMN     "donationCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "feeBreakdown" JSONB,
ADD COLUMN     "feesCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "greetingDefault" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "itemsCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceDraftId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "stripePaymentIntentId" TEXT,
ADD COLUMN     "stripeRefundId" TEXT,
ADD COLUMN     "voidedByStaffId" TEXT;

-- CreateTable
CREATE TABLE "StripeCheckoutSession" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "amountCents" INTEGER NOT NULL,
    "paymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeCheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeCheckoutSession_stripeSessionId_key" ON "StripeCheckoutSession"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "Order_sourceDraftId_status_idx" ON "Order"("sourceDraftId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeRefundId_key" ON "Payment"("stripeRefundId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- AddForeignKey
ALTER TABLE "StripeCheckoutSession" ADD CONSTRAINT "StripeCheckoutSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

