-- P10 fix pass (AGGREGATE-REVIEW-P10):
--  A-M2: repeat lineage is idempotent under concurrency — at most one
--  non-discarded repeat draft per (source order, target season). All repeat
--  entry points (customer review, staff review/one-click, bulk history)
--  insert through saveDraft; the loser of a racing insert maps to a
--  DomainRuleError in createDraftFromRepeat. DISCARDED drafts stay exempt so
--  staff can re-repeat after discarding a stale repeat draft.
CREATE UNIQUE INDEX "orders_repeat_lineage_unique" ON "orders"("repeatedFromOrderId", "seasonId") WHERE "repeatedFromOrderId" IS NOT NULL AND "status" <> 'DISCARDED';

-- A-m4: legacy-import dedupe is backstopped by a unique index scoped to
-- import markers (other wireFormat values keep allowing duplicates). Two
-- concurrent imports of the same external key: the loser throws P2002 and
-- reports the row as already imported instead of double-creating.
CREATE UNIQUE INDEX "orders_legacy_wireformat_unique" ON "orders"("wireFormat") WHERE "wireFormat" LIKE 'legacy-import:%';
