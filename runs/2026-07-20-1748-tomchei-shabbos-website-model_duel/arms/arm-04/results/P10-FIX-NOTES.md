# P10 fix pass — arm-04

**Input:** `results/AGGREGATE-REVIEW-P10.md` (0 blockers, 10 majors, 16 minors).
**Scope:** one pass. All 10 majors fixed, 9 of 16 minors fixed, 7 deferred with a reason. No P11 work.

## Fixed — majors (10/10)

| # | Finding | What changed |
|---|---|---|
| M1 | `setSeasonSchedule` threw `P2025` on a stale season id | `src/lib/seasons/schedule.ts` reads the season before writing and returns `failure(SEASON_NOT_FOUND, …)`, matching its sibling `setSeasonStatus`. No 500 off a calendar somebody left open. |
| M2 | `importPriorYearOrder` re-import left the first import's money | The update branch now rewrites `paymentStatus: 'PAID'` and `amountPaidCents` alongside `subtotalCents`/`totalCents`, so a corrected export cannot read as PAID and short at the same time (`src/lib/imports/prior-year-orders.ts`). |
| M3 | Scheduled flips were not audited | `applyScheduledSeasonFlips` flips each season individually through a new `flipSeasons` helper that writes a `season.status_changed` audit row with `scheduled: true`, inside the same transaction, actor `system`. UR-008's two halves are now audited the same way. |
| M4 | The sweep closed every open season whenever one was due to open | The close sweep is now `closesAt <= now` (a season whose own date has passed) plus seasons left on the hand-worked switch with no date at all. An opening that could only happen by closing a season the manager promised open until later is **skipped** and left for them; the one-open-season invariant is never broken. |
| M5 | "Is this order repeatable?" said three different things | New `src/lib/orders/repeatable.ts` holds one `REPEATABLE_STATUSES` set and `isRepeatable`. Used by the history row, the order detail page, `readRepeatReview` (a `CANCELLED` order is now refused by URL, with its own message) and `repeatLatestOrderForCustomer`. |
| M6 | `requireOpenStore` re-homed with nothing written down | `codegraph impact requireOpenStore` re-run (19 affected symbols across the four storefront files). The move and its reason are now in `README.md` — the store-state paragraph and the domain-model table both name `src/lib/http/store-gate.ts` — and in `.scratch/PHASE-P10-STATUS.md` deviation 4. |
| M7 | `repeat-plan.ts` was a 490-line mixed-concern file | Split three ways along the seams the review named: `repeat-plan.ts` (read model, ~170 lines), `repeat-recipients.ts` (recipient/greeting/address resolution, no Prisma query), `repeat-apply.ts` (decisions and the write). No barrel — the four import sites point at the module they need. |
| M8 | `Select` bypassed on two of three P10 screens | `replacements/page.tsx` and the repeat review page now use `@/components/ui/field`'s `Select`, passing `w-auto min-w-56` / `max-w-md` through `className`. Both regain `text-[var(--color-ink)]` and the disabled style. |
| M9 | `bulkRepeat` / `bulkRepeatCustomerHistory` duplicated verbatim | Extracted `recordRepeatOutcome(id, label, repeated)`, `describeRepeat(repeated)` and `missingRecord(id)` in `src/lib/orders/bulk-actions.ts`; `bulkChangeStatus` uses `missingRecord` too. |
| M10 | Nesting over three levels in the wizard and the chain walk | `createSeasonFromWizard` now reads as `copyProducts` → `copyAddOns` → `drawReplacementLinks`; `resolveReplacements` hops through `advanceWalk(walk, node, onSale, hop)` and `readChainNodes(ids)`. |

## Fixed — minors (9/16)

| # | Finding | What changed |
|---|---|---|
| m1 | `confirmRepeat` validated products against the plan, not the live catalogue | `applyRepeatPlan` re-reads every chosen product inside the write transaction (`seasonId` + `isActive`) and snapshots the name and price from that row. A product retired while the review page was open is now refused instead of landing on the draft. |
| m5 | `SEASON_ALREADY` reused for "season not found" | New `SEASON_NOT_FOUND` code in `src/lib/seasons/management.ts`, used by both `setSeasonStatus` and `setSeasonSchedule`. |
| m6 | `listRepeatableOrders` dead, with a wider filter than the UI | Deleted. |
| m7 | `repeat-order.ts` re-exported symbols nobody imported from there | Re-export line removed. |
| m8 | Action-helper pattern inconsistent | `replacements/actions.ts` now uses the `done`/`back` shape the rest of the admin tree uses; it also stops revalidating on a failed save. |
| m9 | Three copies of "list seasons desc" | `listSeasonsNewestFirst()` added to `src/lib/seasons/management.ts` and used by `seasons/new/page.tsx` and `catalog/replacements/page.tsx`. |
| m10 | `AddressColumns` literal duplicated | `addressColumnsFromSaved` / `addressColumnsFromLine` in `repeat-recipients.ts`, used by the plan and by the write. |
| m11 | Validation messages omitted the received value | `seasons/actions.ts` and both schedule messages now quote what arrived. |
| m12 | `mappingOptions` ran a DB query from a page-local helper | Moved to `src/lib/catalog/replacements.ts`, next to `resolveReplacements`. |
| m13 | Missing P10 smoke / status evidence | `.scratch/PHASE-P10-SMOKE.md` and `.scratch/PHASE-P10-STATUS.md` are present and regenerated by this pass. |

(m13 is counted with the ten above as evidence rather than code, so the code-change count is 9.)

## Deferred (7)

| # | Finding | Why |
|---|---|---|
| m2 | `resolveReplacements` uncached on the replacements page | The page is `force-dynamic` and the screen's whole job is to show mappings as they are this second. Caching it correctly means `unstable_cache` plus a tag invalidated by `setReplacementLink` — a caching strategy decision, not a one-pass fix, and the page is already one query per hop for a single past season. |
| m3 | `upsertAddresses` keys on the address alone, so a second recipient at one street is filed under the first name | The correct key is `(customer, address, recipient)`, which is a schema and migration change to `CustomerAddress.addressKey`'s unique constraint, with a backfill. Out of scope for a fix pass; belongs with the P12 import pipeline that will exercise it. |
| m4 | `closestPricedProduct` category fallback | Changing when the suggestion leaves its category is a product decision about what a donor is offered, not a defect. Left as it is, and it is only ever a pre-fill on a select that starts blank. |
| m14 | `CronRunLog.detail` keeps 200 chars of `error.message` | A secret-shaped sanitiser is a cross-cutting change to `src/lib/cron/job-run.ts` affecting all three P9/P10 jobs; it should be designed once with the other jobs rather than bolted onto this phase. |
| m15 | Cron bearer secret is replayable | Noted as Info by the reviewer, and the job is idempotent. Replay protection is a platform decision that belongs with the cron *schedule*, which is P12. |
| m16 | The wizard mutates products in the past season when linking replacements | Authorized, audited, and the intended behaviour of "draw the links as it goes" (R-048). Making past catalogues immutable is a data-model decision for a later phase. |
| — | Two-open-season edge in `readStoreState` | Not raised; unchanged. |

## Verification

- `npm run ci` → **exit 0** (lint, `tsc --noEmit`, migration guard, **206/206 tests**).
- `npm run smoke:p10` → **21/21 PASS**, twice in a row. Evidence: `workspace/.scratch/PHASE-P10-SMOKE.md`.
- Three unit tests added or reworked in `tests/scheduled-jobs.test.ts`:
  - *every scheduled flip is audited the way the manager's own switch is* — one `season.status_changed` row, `scheduled: true`, actor `system` (M3).
  - *a closing date the manager typed is not overruled by a season falling due* — the sweep opens 0 and closes 0 rather than shutting a promised season a month early (M4).
  - the three pre-existing flip tests now start from `startWithNoSeasonOpen()`, because a test of a sweep that reads every season has to control every season. They were order-dependent on the shared test database before.
- Smoke S4b was extended to prove both halves of M4 over HTTP: with this season promised open the authorized sweep reports `opened 0, closed 0`; once the manager brings its closing forward the same sweep reports `opened 1, closed 1` and leaves exactly one season open. S4c now clears both seasons' dates so the run stays re-runnable.
- No schema or migration change in this pass. No new environment variables; `.env.example` and `src/lib/env-spec.ts` untouched.
