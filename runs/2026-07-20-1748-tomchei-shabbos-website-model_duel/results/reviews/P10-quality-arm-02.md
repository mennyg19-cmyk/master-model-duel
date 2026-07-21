# Reviewer specialist — Quality

**Arm:** `arm-02`
**Tree / phase:** P10 (Seasons management, repeat orders, replacement mappings)
**Output:** `results/reviews/P10-quality-arm-02.md`
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P10-EXPECTED.md`. Blind to model name. Findings only, no fixes.

Evidence reviewed: `lib/repeat.ts`, `lib/cron.ts`, `lib/rate-limit.ts`, `lib/order-builder/draft-store.ts`, `app/api/repeat/route.ts`, `app/api/admin/orders/[id]/repeat/route.ts`, `app/api/admin/repeat/bulk/route.ts`, `app/api/admin/seasons/route.ts`, `app/api/admin/seasons/[id]/route.ts`, `app/api/admin/season-status/route.ts`, `app/api/admin/products/[id]/route.ts`, `app/api/cron/season-flip/route.ts`, `app/(storefront)/account/orders/page.tsx`, `app/(storefront)/account/orders/[id]/page.tsx`, `app/(storefront)/account/orders/[id]/repeat/page.tsx`, `app/(admin)/admin/orders/[id]/page.tsx`, `app/(admin)/admin/customers/page.tsx`, `app/(admin)/admin/catalog/page.tsx`, `app/(admin)/admin/settings/page.tsx`, `components/account/repeat-review.tsx`, `components/admin/repeat-order-button.tsx`, `components/admin/bulk-repeat.tsx`, `components/admin/catalog-manager.tsx`, `components/admin/settings/season-management.tsx`, `components/admin/settings/orders-tab.tsx`, `tests/repeat.test.ts`, `prisma/schema.prisma`, `.scratch/PHASE-P10-SMOKE.md`, `.scratch/PHASE-P10-STATUS.md`, `.scratch/p10-ci-output.log`.

Smoke S1–S3 (22/22 PASS) and `npm run ci` PASS (lint + typecheck + migration guard + 71 tests) are corroborated by `.scratch/PHASE-P10-SMOKE.md` and `.scratch/p10-ci-output.log`. The four EXPECTED items are all implemented and exercised. Findings below are issues the smoke did not catch.

## Findings

### HIGH

#### H1 — `appendToDraft` is a read-modify-write with no transaction or optimistic lock; lost cart lines under concurrency
`lib/repeat.ts:305-318` does `findActiveDraft` → `parseCart` → `cart.lines = [...cart.lines, ...newLines]` → `saveDraft`, and `saveDraft` (`lib/order-builder/draft-store.ts:56-59`) just `update`s the whole cart column. There is no `$transaction`, no `where: { updatedAt }` version check, no row lock. Two concurrent writes to the same draft — a customer confirming a repeat in one tab while the storefront adds a line in another, or two staff bulk-repeat runs racing on the same POS draft — both read the same base cart, both append, and the later `update` clobbers the earlier, silently dropping that writer's lines. `repeat-review.tsx:180` explicitly promises "Items join your current draft — nothing already in your cart is lost." The smoke only ever writes one draft at a time, so the race is unexercised. This is the core data path for both customer repeat (`appendRepeatToCustomerDraft`) and staff repeat (`repeatOrderIntoPosDraft` → `appendToDraft`).

### MEDIUM

#### M1 — Auto-flip closes the previously-open season via `updateMany` with no `AuditLog` entry
`app/api/cron/season-flip/route.ts:43-58` opens the newest overdue season and, as a side effect, `tx.season.updateMany({ where: { status: "OPEN", id: { not: season.id } } })` closes whatever season was open before. That closure writes no `AuditLog` row — only the `season.autoflip.open` and the closesAt-driven `season.autoflip.close` (lines 29-34) are audited. So when the schedule flips the store from season A to season B, A's transition OPEN→CLOSED is unauditable: no actor, no timestamp, no detail. The `closed` array in the response also undercounts (it only collects closesAt-driven closes), so the smoke label "closed the old one" passes only because it checks `oldOpenAfter.status === "CLOSED"` directly, not the audit trail. EXPECTED S2 requires the flip; the audit gap means a manager cannot trace an automated closure back to the schedule that caused it.

#### M2 — Bulk repeat has no transaction across the per-customer loop; a mid-loop throw leaves orphan POS drafts and no audit row
`app/api/admin/repeat/bulk/route.ts:53-83` iterates up to `BULK_LIMIT = 200` customers, each doing `findActiveDraft` + `loadRepeatableOrder` + `repeatOrderIntoPosDraft` (which itself appends to a draft). None of this is wrapped in a single transaction. If any iteration throws (DB blip, deadlock), the request 500s but the drafts already created in prior iterations persist as ACTIVE POS drafts — and `writeAudit` (line 77) is never reached, so the partial run has no audit row at all. The smoke's "re-running bulk skips customers with a POS draft in progress" check actually relies on this side effect (it re-runs against the same drafts), so a partial-failure state is indistinguishable from a completed run. EXPECTED R-058 wants "bulk repeat of customer history"; atomicity is not guaranteed.

#### M3 — `buildRepeatPlan` fetches the entire product catalog on every call; 200× in a bulk run
`lib/repeat.ts:152-154` runs `db.product.findMany({ ... })` with no season filter — every product across every season — for each repeat plan build. `repeatOrderIntoPosDraft` calls it once per order, and the bulk route calls `repeatOrderIntoPosDraft` per customer, so a 200-customer bulk run is 200 full-catalog scans. The bulk route also loads every finalized order in the source season with no `take` (line 36-40) before deduping in memory. There is no caching or hoisting of the product map across the loop. Correct, but scales poorly; the smoke only has 3 customers so the cost is invisible.

### LOW

#### L1 — `RepeatReview` uses the wrong `apiFetch` generic and drops `unassigned` from the body type
`components/account/repeat-review.tsx:58` calls `apiFetch<{ ok: boolean; added: number }>`. `ApiResult<T>` already discriminates on `ok` (`lib/api-client.ts:4-7`), so the `ok: boolean` inside `T` is misleading — `result.ok` on line 72 is the discriminator, not the body field — and the server's `unassigned` field is missing from the type. No runtime impact (the body is never read), but the annotation misrepresents the contract to the next reader.

#### L2 — `RepeatReview` ignores `unassigned`; a customer whose legacy recipient failed validation gets no notice
`app/api/repeat/route.ts:60` returns `{ ok, added, unassigned }`, but `repeat-review.tsx:58,72-76` only checks `result.ok` and then `router.push("/order")`. When an imported recipient fails today's address validation, the line lands in the cart unassigned (DECISION-P10-7) — but the customer is pushed straight to the builder with no message that an item has no recipient and needs one assigned before checkout. The review page warns per-line about invalid addresses (line 160-163), but the confirm flow hides the aggregate outcome.

#### L3 — `repeatOrderIntoPosDraft` throws a raw `Error(built.error)` → 500 with an internal message
`lib/repeat.ts:357-358` does `if (!built.ok) throw new Error(built.error)`. On the staff auto-map path the decisions are built from the plan itself, so `buildRepeatCartLines` cannot legitimately fail (every picked productId is a candidate or null). The throw is defensive, but if it ever fires it surfaces the internal error string as a 500 body via the route handler, instead of a controlled `Response.json({ error }, { status: 400 })`. Leaks an internal message on a path the smoke never hits.

#### L4 — `confirmSchema` caps `decisions` at 300; a prior order with more lines cannot be repeated
`app/api/repeat/route.ts:14-24` sets `.max(300)` on the decisions array. A finalized prior order with >300 lines (a large imported Mishloach Manos list) gets a 400 "Repeat payload is invalid" with no way to repeat it at all. Undocumented and unexercised.

#### L5 — New-season wizard allows `copyFromSeasonId` to be the currently OPEN season, mutating live catalog replacement links mid-sale
`app/api/admin/seasons/route.ts:50-90` does not reject `copyFromSeasonId === openSeason.id`. Copying the open season seeds `replacementId` on every still-unmapped live product (`if (!source.replacementId) await tx.product.update(...)`) while that catalog is actively selling — repeat chains for in-flight orders now point at next-season copies. Functionally safe (the copies are in a CLOSED season), but a manager can accidentally rewire the live catalog's replacement graph by picking the wrong source in the wizard dropdown, which lists every season including the open one.

## Severity counts

- HIGH: 1 (H1)
- MEDIUM: 3 (M1–M3)
- LOW: 5 (L1–L5)
- Total: 9 findings
