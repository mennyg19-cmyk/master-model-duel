-- Pending-to-processed idempotency ledger (P5 fix pass, M4): new events claim
-- their id as 'pending' and flip to 'processed' only after the money work
-- commits, so a crash mid-work is retried instead of permanently lost.
ALTER TABLE "StripeWebhookEvent" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- Every pre-existing row completed its work under the old commit-first scheme;
-- without this backfill a replay of an old event would be reprocessed.
UPDATE "StripeWebhookEvent" SET "status" = 'processed';
