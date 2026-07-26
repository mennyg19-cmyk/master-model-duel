-- CreateEnum
CREATE TYPE "FeeBasis" AS ENUM ('NONE', 'PER_PACKAGE', 'PER_DESTINATION');

-- AlterTable
ALTER TABLE "CustomerAddress" ADD COLUMN     "lastGreeting" TEXT;

-- AlterTable
ALTER TABLE "FulfillmentMethod" ADD COLUMN     "feeBasis" "FeeBasis" NOT NULL DEFAULT 'PER_PACKAGE';

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "deliveryDay" TEXT;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "deliveryDay" TEXT,
ADD COLUMN     "fulfillmentFeeCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
-- Safe as a NOT NULL add because nothing has ever written to this table: hosted
-- checkout starts in this phase, and a session id exists before the row does.
ALTER TABLE "StripePaymentIntent" ADD COLUMN     "stripeSessionId" TEXT NOT NULL,
ALTER COLUMN "stripeIntentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "recordedByStaffUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_reference_key" ON "PaymentRefund"("reference");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_eventId_key" ON "StripeWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_receivedAt_idx" ON "StripeWebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StripePaymentIntent_stripeSessionId_key" ON "StripePaymentIntent"("stripeSessionId");

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_recordedByStaffUserId_fkey" FOREIGN KEY ("recordedByStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma cannot express a CHECK, and "how much went back" is not a field the
-- application gets to be wrong about: a zero or negative refund would make the
-- payment recount hand the customer credit they never received.
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_amount_positive" CHECK ("amountCents" > 0);
