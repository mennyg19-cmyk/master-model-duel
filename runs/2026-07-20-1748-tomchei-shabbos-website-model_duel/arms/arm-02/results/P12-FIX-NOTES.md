# P12 fix pass — arm-02 (single pass, correctness-first, FINAL phase)

**Input:** `results/AGGREGATE-REVIEW-P12.md` (0 blockers · 11 majors · 18 minors)
**Scope:** priority findings only, per orchestrator brief. Pure refactors / god-file splits / banner tokenization deferred.

## Fixed

| ID | Fix | Where |
|---|---|---|
| S-M1 | Export audit row now writes on BOTH stream completion and client abort/disconnect. A shared once-guarded `auditExport(outcome)` runs from the `done` pull ("completed") and from `cancel()` ("aborted") with the rows streamed so far — an aborted PII download can no longer evade the R-092 detective control. | `app/api/admin/exports/[dataset]/route.ts` |
| Q-M3 | Reconciliation matcher N+1 eliminated. Per-session `payment.aggregate` replaced with one `payment.groupBy` keyed `orderId|intentId`; per-payment backing `findFirst` pair replaced with two batched `findMany` calls into lookup sets; per-finding `findUnique` in the upsert loop replaced with one batched `findMany` by reference. Nightly run at 5k scale is now a fixed handful of queries. Matching semantics unchanged (smoke S2 orphan/mismatch/rerun checks all pass). | `lib/payments/reconcile.ts` |
| C-M5 | `wipeOpenSeason` no longer deletes globally: `paymentReconFlag` deletes are scoped to the wiped season's order ids, `inventoryItem.reserved` reset is scoped to the season's products/add-ons, and the `stripeWebhookEvent` delete is removed entirely (global idempotency ledger, no season link — survives like the audit log). Header contract comment and DECISION-P12-5 updated to match. Verified: a cross-season recon flag survives the wipe (`.scratch/p12-fix-verify.ts`). | `lib/test-console.ts`, `DECISION-LOG.md` |
| C-H1 | Mojibake em-dashes (double-encoded `â€”`) replaced with real `—` in the drill-down card title and the per-label order-number cell. Byte-grep confirms no mojibake remains under `app/`. | `app/(admin)/admin/reports/page.tsx` |
| R-M2 | `STATE_NAMES` nine-state ceiling now carries a `ponytail:` comment (ceiling + USPS-table/geocoder upgrade path) and is logged as **DECISION-P12-7**. Behavior unchanged (unknown states already review-flagged). | `lib/legacy-import.ts`, `DECISION-LOG.md` |
| R-M3 | `mapMethodCode` returns `null` for unrecognized methods (and now positively recognizes deliver/local keywords). The caller still lands the row as `local_delivery` but adds a dry-run repair note AND an address-review flag — no more silent business default. Logged as **DECISION-P12-8**. | `lib/legacy-import.ts`, `DECISION-LOG.md` |
| C-M2 | `isUniqueViolation` centralized in new `lib/prisma-errors.ts`. The dead export in `legacy-import.ts` (zero importers) deleted along with its now-unused `Prisma` import; `draft-store.ts`'s private copy replaced with the shared import. | `lib/prisma-errors.ts`, `lib/legacy-import.ts`, `lib/order-builder/draft-store.ts` |

## Deferred (per brief)

R-M1 legacy-import god-file split, C-M3 export pagination helper, C-M4 empty if-branch, C-M6 banner palette tokenization, and minors S-L2, S-I1, S-I2, Q-L1, Q-L2, Q-L4, Q-L5, R-L1, R-L2, R-L4, C-L1–C-L8 (none had a trivial side-effect fix inside the touched lines).

## Verification

- `npm run ci` — lint, typecheck, migration guard, **77/77 unit tests** pass (exit 0).
- Full S1–S5 re-smoke after fixes: **46/46 PASS**, evidence rewritten in `workspace/.scratch/PHASE-P12-SMOKE.md` (scale re-seeded to 1,001 orders / 5,001 packages first; season restored to the clean one-demo-order state afterwards).
- Targeted fix verification (`.scratch/p12-fix-verify.ts`, `.scratch/p12-fix-verify-abort.ts`):
  - S-M1: aborted mid-stream export left an audit row `outcome=aborted, rows=2` of 1,001 available — PASS.
  - C-M5: cross-season recon flag and all 6 legacy-season orders survived a wipe — PASS.

## Blockers remaining

None. 0 blockers in the aggregate review; none introduced.
