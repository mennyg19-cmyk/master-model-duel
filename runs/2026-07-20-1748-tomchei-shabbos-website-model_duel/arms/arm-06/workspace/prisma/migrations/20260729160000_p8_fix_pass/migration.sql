-- P8 fix pass: async void-refund reconciliation (refund object id + last
-- known status for the shipping sweep) and the merged-package charge split
-- (P12 reconciliation ledger).
-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "chargeBreakdown" JSONB,
ADD COLUMN     "refundStatus" TEXT,
ADD COLUMN     "shippoRefundId" TEXT;
