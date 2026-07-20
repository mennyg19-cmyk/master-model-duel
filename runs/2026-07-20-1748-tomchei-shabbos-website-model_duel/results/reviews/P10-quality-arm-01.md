# Reviewer specialist — Quality

**Arm:** `arm-01`
**Tree / phase:** P10 — Seasons management, repeat orders, replacement mappings
**Output:** `results/reviews/P10-quality-arm-01.md`
**Scope:** `arms/arm-01/workspace/` vs `shared/phases/PHASE-P10-EXPECTED.md`
**Mode:** Findings only, no fixes. Blind to model name.

## Summary

P10 is substantially implemented: replacement-mapping chain resolution, customer/staff repeat review page with dual confirmation, single + bulk repeat, season wizard with forward-mapping clone, manual Open/Closed switch, and scheduled auto-flip (lazy + cron sweep). Domain logic is well-guarded (optimistic concurrency, cycle detection, kind/year invariants, audit on every state change). The main gaps are process evidence and a few silent-degradation edge paths.

## Findings

### H-1 — Missing P10 smoke evidence archive
**Severity:** High
**Location:** `arms/arm-01/workspace/.scratch/PHASE-P10-SMOKE.md` (absent)
`PHASE-P10-EXPECTED.md` declares the evidence path `arms/{id}/workspace/.scratch/PHASE-P10-SMOKE.md`. No `.scratch/` directory exists in arm-01. The harness shows `scripts/p10-smoke.ts` is wired (`npm run smoke:p10`), but no archived run record (S1/S2/S3 results, timestamps, env) was produced. Smoke cannot be considered gated without the evidence artifact.

### M-1 — Scheduled auto-flip has no platform cron registration
**Severity:** Medium
**Location:** `src/app/api/cron/season-status/route.ts`; no `vercel.json` in workspace
The bearer-authed cron sweep endpoint exists, but there is no `vercel.json` `crons` entry (or any external scheduler) to invoke it. `applyScheduledSeasonStatuses` is only called lazily from `getCurrentSeason` (`src/lib/storefront.ts:5`). UR-008's "scheduled auto-flip at configured time" therefore only fires on the next storefront request after the due time; during a quiet period the season stays in the prior state indefinitely. The cron route is effectively dead code without a scheduler.

### M-2 — Repeat draft silently drops fulfillment method on code mismatch
**Severity:** Medium
**Location:** `src/domain/repeat-orders.ts:284-292` (`createRepeatDraft`)
The target fulfillment method is resolved by matching `sourceLine.fulfillmentMethod.code` against target-season methods (`methodsByCode.get(...)`). If the target season has no method with that code, `method` is `null` and `fulfillmentMethodId` is written as `null` with no error or flag. The resulting draft line has no fulfillment method, which will surface as a broken checkout/packaging flow later. The smoke script only exercises a `SHIPPING` code present in both seasons, so this path is untested.

### M-3 — `setSeasonStatus` always promotes the touched season to current
**Severity:** Medium
**Location:** `src/domain/seasons.ts:82-86`
Closing the current season upserts `current-season-id` to that now-closed season. If another season is still `OPEN`, the storefront reports the current season as closed (ordering blocked) while an open season exists but is not "current". The "archive stays browsable off-season" requirement is met via `/collections`, but the open/closed semantics of `current-season-id` vs. an existing open season are inconsistent.

### L-1 — Customer repeat page can 500 on direct same-season URL access
**Severity:** Low
**Location:** `src/app/(storefront)/account/orders/[orderId]/repeat/page.tsx:24`
The page calls `getRepeatReview`, which throws `"Choose an order from an earlier season to repeat."` when `sourceOrder.seasonId === targetSeason.id`. The page only guards `targetSeason.status !== "OPEN"` (→ `notFound()`); the same-season throw is unhandled and surfaces as a 500. The repeat link is hidden for same-season orders, but direct URL entry is not defended.

### L-2 — Catalog PATCH does not normalize empty-string replacement to null
**Severity:** Low
**Location:** `src/app/api/admin/catalog/route.ts:100-125`
`assertReplacementMapping` runs only when `body.replacementProductId` is truthy. An empty string is falsy, so validation is skipped and `replacementProductId: ""` is written to the DB (a non-null empty string on a `String?` field). The UI sends `null`, but the API does not normalize `""` → `null`, leaving the door open for other clients.

### L-3 — Bulk repeat button has no confirmation step
**Severity:** Low
**Location:** `src/components/admin-order-actions.tsx:11-30` (`BulkRepeatButton`)
"Repeat finalized on page" immediately POSTs every finalized order on the rendered page (up to 25) to `/api/admin/orders/bulk-repeat` with no confirm dialog. A misclick creates up to 25 drafts. Conflicts are reported in a message, but applied drafts are created unconditionally.

### L-4 — `createSeasonFromTemplate` overwrites existing forward mappings
**Severity:** Low
**Location:** `src/domain/seasons.ts:266-272`
The wizard sets each prior product's `replacementProductId` to the new clone, overwriting any prior chain link (e.g., to a bridge-season product). The bridge product's chain becomes orphaned. For repeat resolution this is fine (latest wins), but the previous mapping is lost without audit of the override.

## Severity counts

- Critical: 0
- High: 1
- Medium: 3
- Low: 4
- Total: 8
