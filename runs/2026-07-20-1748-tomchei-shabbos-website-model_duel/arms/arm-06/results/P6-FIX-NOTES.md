# P6 FIX NOTES — arm-06 (Test 4 fix pass)

**Date:** 2026-07-29 · **Source list:** `AGGREGATE-REVIEW-P6.md` (5 majors / 21 minors)
**Result:** **5/5 majors fixed. 19/21 minors fixed, 2 deferred (m4, m7 — justifications below).**
**Verification:** lint ✓ · typecheck ✓ · migration-guard ✓ (10 migrations, in sync) · test:unit ✓ (7 suites; test-p6 now 38 checks) · test:domain ✓ (7 suites; test-p6-domain now 34 checks) · build ✓ · **re-smoke S1–S4: 30 checks, 0 failures** (`workspace/.scratch/PHASE-P6-SMOKE.md`).

---

## Majors — all 5 fixed

### M1. Bulk order actions were not season-scoped — FIXED
`runBulkOrderAction` (`lib/orders/bulk.ts`) now loads the open season up front (refusing with `DomainRuleError` when none is open) and pre-filters the candidate ids against it: any id that isn't an order in the open season is a deterministic skipped row — `"not an order in the open season"` — without revealing whether the id exists elsewhere. Parity with the order list, which is always season-scoped. Pinned by domain checks (bulk repeat **and** discard on a closed-season order skip by name, order untouched) and smoke **S2g**.

### M2. Bulk audit recorded only counts, not per-order outcomes — FIXED
The `bulk_action` summary audit (`app/api/admin/orders/bulk/route.ts`) now carries the full `results` array in its metadata (orderId, outcome, reason/draftRef per row) alongside the counts. The report that answered the HTTP call is exactly what lands on the audit trail. Smoke **S2h** reads the latest `bulk_action` row and asserts the per-order outcome list is present.

### M3. Keyless-host refund pretended the card was refunded — FIXED
Behavior inverted. `refundStripePayment` (`lib/payments/refund.ts`) now **refuses** with `DomainRuleError` when `STRIPE_SECRET_KEY` is unset: "Stripe is not configured on this host — refund the card in the Stripe dashboard; the local record voids itself when the refund webhook lands." No local void, no `payment_refund` audit, no cache recompute — the books never claim a refund the card never saw. The existing `charge.refunded` webhook sync remains the honest void path (it voids when Stripe evidence arrives). With keys, the Stripe refund is still attempted first and the local void only happens after it succeeds. The route's response no longer carries `stripeCalled`; the keyless answer is **422** with the operator instructions. Pinned by domain checks (refusal message, zero state change, zero audit, cash payments never reach Stripe) and smoke **S1d/S1e**.

### M4. Imports list leaked PRODUCTS batch metadata to customers-only staff — FIXED
`/admin/imports` (`app/(admin)/admin/imports/page.tsx`) now scopes the batch query by the viewer's permissions: both permissions → all batches; `customers.manage` only → CUSTOMERS batches; `catalog.manage` only → PRODUCTS batches. Filenames, row counts, and verdict tallies of the other kind no longer render. Smoke **S3h** stages a PRODUCTS batch as manager and asserts the restricted staff list page never mentions it.

### M5. Customers CSV had no in-file phone dedupe — FIXED
The import engine's `KindHandler` contract went from one `duplicateKey` to `duplicateKeys(): { key, label }[]` (`lib/imports/engine.ts`). `customers.ts` emits an email key plus a normalized-phone key when a phone is present, so two rows sharing a phone — in any formatting, `(732) 555-0199` ≡ `732-555-0199` — flag the later row as `"phone duplicates row N in this file"`. Only fully valid rows register their keys, so a row already invalid can't poison dedupe. Commit stays truthful under races: after `createMany(skipDuplicates)`, any "valid" row that didn't land is re-marked duplicate ("another import committed this email or phone first") before the payload is persisted — preview matches commit. Pinned by domain checks (in-file phone twin, commit lands exactly 1, counts stay truthful) and smoke **S3g**.

---

## Minors — 19 fixed, 2 deferred

| # | Fix |
|---|---|
| m1 | Impersonation stop (`app/api/admin/impersonation/stop/route.ts`) re-checks `staff.impersonate` on the original account (with its overrides) before restoring the session — a revoked override ends the session with 403, same gate as the start |
| m2 | POS checkout (`lib/payments/pos.ts`) refuses `amountCents` above the order total (`DomainRuleError`) instead of silently over-posting |
| m3 | Media upload (`app/api/admin/media/route.ts`) refuses to assign a photo to a product in a non-OPEN season (422 naming the season status) — same open-season gate as ordering/imports |
| m5 | Audit log page redacts PII metadata keys (`resetToken`, `phone`, `address`, `email`) unless the viewer holds `customers.manage`; managers keep the full detail |
| m6 | `discardOrder` accepts an audit context and writes `order_discard` **inside** the discard transaction (`recordAudit(entry, tx)`); a failed audit now rolls back the discard, matching the payment verbs' UR-011 discipline. New `AuditAction` literal. Smoke **S4e** proves exactly one in-tx audit per bulk discard |
| m8 | Orders + customers filter forms adopt the kit `<Input>`/`<Select>` (focus ring, one styling approach) — no more hand-rolled controls on the two list pages |
| m9 | README: title → P6, new "What P6 ships" section, four new Patterns rows (import engine, bulk runner, list controls, dashboard queries) |
| m10 | Dead `GET /api/admin/imports` deleted (zero callers; the page queries Prisma directly) |
| m11 | Order-detail audit query drops the `["-"]` sentinel — `in: []` already matches nothing |
| m12 | `parseCustomerListParams` drops the never-firing `|| DEFAULT_PAGE_SIZE` |
| m13 | `first()` exported from `lib/admin/order-list.ts`; `directory.ts` calls it instead of forking the array-picker |
| m14 | New `components/admin/pagination-nav.tsx` + `buildListHref` helper own the Prev/Next chrome and URL building for both list pages |
| m15 | Magic `25` in the orders page replaced by the shared `DEFAULT_PAGE_SIZE` via `buildListHref` |
| m16 | `imports/[batchId]/page.tsx` merges the two `next/navigation` imports into one |
| m17 | POS checkout: unknown method throws `DomainRuleError` (422) instead of `?? "CASH"` — schema drift can never silently post cash |
| m18 | POS shell surfaces a failed address-book fetch ("Could not load this customer's address book — type the address manually") instead of substituting `[]` |
| m19 | `repeatOrder` rides the shared `run()` busy/error/refresh lane; only the draftRef extraction stays repeat-specific |
| m20 | `countByVerdict(rows)` computed once per stage/commit and reused for both the batch row and the audit metadata |
| m21 | Import preview owns the single `—`-for-missing sentinel; the page passes raw `string | null` data through (dead `?? "—"` side eliminated) |

### Deferred

- **m4 (dev-auth route has no rate limit):** the route is hard-disabled whenever `VERCEL_ENV` is set (production **and** preview), so it is local-dev hygiene only; a limiter would add a new infra pattern for a seam that can never be reached in deployment. Revisit if dev-auth ever ships to a deployed env.
- **m7 (P6 migration timestamp sorts before the applied P5 migration):** renaming an already-applied migration breaks the `_prisma_migrations` history of every existing dev database to fix an ordering that is verifiably safe today (P6 touches no P5-dependent objects; `migration-guard` + migrated dev DBs prove it). The fragility note stays in `PHASE-P6-STATUS.md` deviation 5; the next migration simply gets a fresh timestamp.

## Contract changes reviewers should know

1. `POST /api/admin/payments/[paymentId]/refund` on a keyless host now answers **422** with operator instructions and changes nothing (was: 200 with a local void + `stripeCalled:false`). The response body no longer carries `stripeCalled`.
2. Bulk actions skip out-of-season ids with `"not an order in the open season"` and refuse entirely when no season is open (422).
3. `bulk_action` audit metadata now includes `results[]` (per-order outcomes); new `order_discard` audit action is written per discard, in-tx.
4. `/admin/imports` lists only the batch kinds the viewer's permissions cover.
5. Import `KindHandler.duplicateKey` → `duplicateKeys(): DedupeKey[]` — any future kind implements the plural form.
6. Transition error messages use ASCII `->` (WIN1252 DB can't store "→" — see Notes).

## Notes

- **Smoke-found bug, fixed before green (mirrors P5's S4c find):** the first re-smoke run 500'd on S4c — the M2 audit write embedded per-row skip reasons, and `IllegalTransitionError`'s message used "→" (U+2192), which the WIN1252-encoded embedded Postgres rejects on insert. Both transition errors (`lib/orders/state-machine.ts`, `lib/packages/stages.ts`) now use ASCII arrows with a comment recording why. The class predates this pass; any audit write carrying a transition message would have failed identically.
- One pre-existing dashboard-test assumption needed an honest update for M3: the collection-queue assertion relied on the old fake void making the refund order UNPAID. The fixture now includes an explicit FINALIZED/UNPAID order for queue coverage, and asserts the refused-refund order stays **out** of the queue.
- Re-smoke grew from 25 to **30 checks**: S1d/S1e rewritten for the refusal, new legs S2g (season scoping), S2h (per-order audit), S3g (phone dedupe), S3h (list scoping), S4e (transactional discard audit).
