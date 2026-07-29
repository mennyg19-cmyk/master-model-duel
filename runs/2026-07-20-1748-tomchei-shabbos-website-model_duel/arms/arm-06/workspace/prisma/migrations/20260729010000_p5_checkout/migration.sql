-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "lastGreeting" TEXT;

-- AlterTable
ALTER TABLE "draft_recipients" ADD COLUMN     "deliveryDay" TEXT,
ADD COLUMN     "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fulfillmentChoice" TEXT,
ADD COLUMN     "greeting" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryFeesCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "greetingDefault" TEXT,
ADD COLUMN     "stockReserved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeSessionId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "externalRef" TEXT;

-- CreateTable
CREATE TABLE "stripe_webhook_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stripe_webhook_events_eventId_key" ON "stripe_webhook_events"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_stripeSessionId_key" ON "orders"("stripeSessionId");

-- AddForeignKey
ALTER TABLE "stripe_webhook_events" ADD CONSTRAINT "stripe_webhook_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
