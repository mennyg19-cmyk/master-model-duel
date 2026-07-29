# Reviewer specialist — Quality

**Arm:** arm-06 (blind — no model names)
**Tree / phase:** P6 — Admin operations hub & POS
**Output:** `results/reviews/P6-quality-arm-06.md`
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P6-EXPECTED.md`. Findings only, no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 3 |

Coverage vs EXPECTED: all six P6 must-trues are present and wired (dashboard, order list/detail + money actions + Stripe refund, POS, customer directory + CSV import, admin chrome, bounded bulk/scale). Smoke S1–S4 (25 checks) green on the final tree; the one bug smoke found (bulk discard of a FINALIZED order → 500) is fixed and regression-pinned. Findings below are edge-case correctness and discipline gaps, not missing features.

---

## Major

### M1 — Customers CSV import: in-file phone duplicates bypass the preview verdict
**Where:** `lib/imports/customers.ts` (`duplicateKey` keys only on email; `markCustomerDuplicates` checks phones only against the DB, not within the batch); `lib/imports/engine.ts` `commitRows` path.
**Symptom:** Two rows in the same file with **different emails but the same phone** both pass in-file dedup (different keys) and both pass `markCustomerDuplicates` (no existing DB customer owns that phone yet). The preview reports both as `valid`. On commit, `createMany` with `skipDuplicates: true` inserts the first and **silently drops the second** on the `normalizedPhone` unique index (R-144). The dropped row is never re-marked `duplicate` in the payload — the committed batch reports `committedRows` less than `validRows` with no per-row explanation.
**Contract break:** The phase's explicit gate is "preview every row's verdict before commit." A row the preview called `valid` is silently dropped at commit, with the loss visible only as a count delta. The product import does not have this gap (its `duplicateKey` is slug, and slug is the only unique column).
**Severity rationale:** Major — the preview-then-commit promise is the import feature's core safety property, and it is violated for a realistic input shape (a pasted list with a repeated phone number).

---

## Minor

### m1 — Bulk discard has no transactional audit; a failed audit write leaves discards un-audited
**Where:** `lib/orders/state-machine.ts` `discardOrder` (records no audit); `app/api/admin/orders/bulk/route.ts` (writes the `bulk_action` summary audit **outside** any transaction, after `runBulkOrderAction` returns).
**Symptom:** `discardOrder` itself writes no `AuditLog` row — the only trail for a discard is the `bulk_action` summary written by the route after the per-row discards have already committed. If that audit write fails (connection drop, constraint error), the discards are durable but leave **zero** audit trail. The payment verbs deliberately co-locate audit + mutation in one tx (UR-011); discards do not, despite the code comments citing that discipline.
**Severity rationale:** Minor — discards are order-state, not money, and the summary audit normally lands; the gap is a crash-window completeness issue, not a live bug.

### m2 — Import batch list leaks across permission kinds
**Where:** `app/api/admin/imports/route.ts` `GET` (returns all 20 recent batches for any user holding `customers.manage` **or** `catalog.manage`); `app/(admin)/admin/imports/page.tsx` (`where: canCustomers ? {} : { kind: "PRODUCTS" }` — a customers-only user sees PRODUCTS batches too).
**Symptom:** A staff member with only `customers.manage` sees PRODUCTS-import filenames and row counts in the list. Clicking through correctly 403s (the preview route gates by `IMPORT_PERMISSION[batch.kind]`), so no domain data leaks — but the list itself is not kind-filtered per permission.
**Severity rationale:** Minor — information disclosure of import filenames/counts only; the detail gate holds.

### m3 — P6 migration timestamp backdated before the already-applied P5 migration
**Where:** `prisma/migrations/20260729001151_p6_admin_ops` sorts lexically before `prisma/migrations/20260729010000_p5_checkout`.
**Symptom:** On a fresh database, Prisma applies P6 (refundRef + import tables) before P5 (checkout). The status doc asserts this is safe because P6 touches no P5-dependent objects, and `migration-guard` + a migrated dev DB verify it. The backdating is nonetheless fragile: any future migration that depends on P5 but is timestamped after P6 is fine, but the ordering misleads readers and a later P5-dependent migration could silently reorder.
**Severity rationale:** Minor — correct today, verified by `migration-guard`; flagged as a fragility/deviation rather than a live defect.

---

## Notes (not findings)

- POS checkout `OFFLINE_METHODS[...] ?? "CASH"` fallback in `lib/payments/pos.ts` is unreachable dead code: `checkoutSubmitSchema` restricts `method` to the four-token enum and the route rejects `"card"` before this line. Worth tightening to a throw for future enum drift, but not a defect today.
- `discardImport` uses a non-null assertion (`batch!`) after a guaranteed-existing `findUnique`; safe in practice.
- `parseCustomerListParams`'s `parsePageSize(...) || DEFAULT_PAGE_SIZE` is redundant (`parsePageSize` never returns 0); cosmetic only.
