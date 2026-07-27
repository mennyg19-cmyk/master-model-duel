# P10 Aggregate Review — arm-04 (blind)

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Inputs:** P10-security, P10-quality, P10-rules, P10-clean-code specialist reviews
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings introduced. Severity mapping: security Critical/High → blocker; security Medium → major; security Low/Info → minor. Quality Medium → major; Low → minor. Rules High → major (or blocker if true blocker); Rules Medium → major; Low → minor. Clean-code Major → major; Minor → minor.

## Counts after dedupe

- **Blockers:** 0
- **Majors:** 10
- **Minors:** 16
- **Total:** 26

## Prioritized fix list

### Majors (builder should fix)

1. **`setSeasonSchedule` throws on a missing season instead of returning a `Result`** — `src/lib/seasons/schedule.ts:102-105` (called from `src/app/(admin)/admin/seasons/actions.ts:44`). Sibling `setSeasonStatus` returns `failure(...)` on a stale id; this one throws `P2025` and surfaces a 500. *(security Low + rules High → major)*
2. **`importPriorYearOrder` re-import does not update `amountPaidCents`** — `src/lib/imports/prior-year-orders.ts:108-117`. Update branch rewrites `subtotalCents`/`totalCents` but leaves `amountPaidCents`/`paymentStatus` from the first import, so a corrected export looks partially unpaid against `PAID`. *(quality Medium → major)*
3. **Scheduled season flip is not audited** — `src/lib/seasons/schedule.ts:33-76` (`applyScheduledSeasonFlips`). Only `CronRunLog` is written; no `season.status_changed` audit row, unlike the manual `setSeasonStatus` path. UR-008 treats both halves as the same switch; only one is audited. *(quality Medium → major)*
4. **`applyScheduledSeasonFlips` closes every open season when one is due to open, ignoring `closesAt`** — `src/lib/seasons/schedule.ts:53-60`. The `closed` `updateMany` drops the `closesAt: { lte: now }` filter, silently overriding a manager-typed future close schedule. *(rules Medium → major)*
5. **"Is this order repeatable?" expressed three ways with three semantics** — `src/components/account/order-summary-row.tsx:29` (allowlist), `src/app/(storefront)/account/orders/[orderId]/page.tsx:137` (denylist), `src/lib/orders/repeat-review.ts:163` (`notIn` includes `CANCELLED`), `:43` (`confirmRepeat` refuses only `DRAFT`). A `CANCELLED` order is hidden on both screens but repeatable by direct URL. Centralize on the shared `REPEATABLE` set. *(rules Medium → major)*
6. **`requireOpenStore` silently re-homed from `@/lib/store-state` to `@/lib/http/store-gate` across four storefront files** — `src/app/(storefront)/order/{page,actions,checkout/page,checkout/actions}.tsx`. No DECISION-LOG entry, no `codegraph_impact` run before re-pointing callers; the arm's own `codegraph.mdc` makes `codegraph_impact` mandatory before structural moves. *(rules Medium → major)*
7. **`repeat-plan.ts` is a mixed-concern god file** — `src/lib/orders/repeat-plan.ts` (490 lines, six concerns: build / decision contract / apply / auto-decisions / recipient resolution / greeting / add-on catalog). Split along read-model vs apply vs recipient seams, mirroring `seasons/{management,schedule,wizard}`. *(clean-code Major → major)*
8. **`Select` component bypassed in two of three P10 screens** — `src/app/(admin)/admin/catalog/replacements/page.tsx:161`, `src/app/(storefront)/account/orders/[orderId]/repeat/page.tsx:170,210`. Both hand-roll the `CONTROL_CLASSES` string (dropping `text-[var(--color-ink)]` and the disabled style). `Select` accepts a `className` override — pass `min-w-56`/`max-w-md` through instead. *(clean-code Major → major)*
9. **`bulkRepeat` and `bulkRepeatCustomerHistory` duplicate the per-row record and detail string** — `src/lib/orders/bulk-actions.ts:100-144` and `:154-197`. Skeleton (`randomUUID` → `boundedIds` → look-up map → loop → skip-missing → repeat → outcome record → `bulkReport`) and the detail-line + conflict/skip branching are repeated verbatim. Extract `recordRepeatOutcome(repeated, label)` + `describeRepeat(repeated)`. *(clean-code Major → major)*
10. **`createSeasonFromWizard` and `resolveReplacements` exceed the 3-level nesting rule** — `src/lib/seasons/wizard.ts:54-202` (5 levels, transaction callback is the sinkhole), `src/lib/catalog/replacements.ts:49-134` (4 levels, per-hop body). Extract `resolveWalk(walk, node, onSale)` and per-product copy helpers. *(clean-code Major → major)*

### Minors (priority order)

1. **`confirmRepeat` reuses the plan read outside its write transaction** — `src/lib/orders/repeat-review.ts:78-140`. `applyRepeatPlan` validates `productId` against the in-memory `plan.catalog`, not the live DB, so a product deactivated between GET and POST still lands on the draft. *(rules Low)*
2. **`resolveReplacements` runs uncached on every render of the replacements page** — `src/lib/catalog/replacements.ts:49-134` called from `replacements/page.tsx:52-65`. Each `revalidatePath` bounce re-runs up to 8 `db.product.findMany` queries. *(rules Low)*
3. **`importPriorYearOrder` upserts addresses by `addressKey`, so a second recipient at the same street is filed under the first one's name** — `src/lib/imports/prior-year-orders.ts:221-256`. `recipientName` is not guarded the way `lastGreeting` is. *(rules Low)*
4. **`closestPricedProduct` falls back to the whole catalog when the source category is empty, but not when it is merely non-empty and far away** — `src/lib/catalog/replacements.ts:145-165`. A $54 basket donor is offered only the $200 basket, never the $46 box. Silent product decision with no DECISION-LOG entry. *(rules Low)*
5. **`SEASON_ALREADY` error code reused for "season not found"** — `src/lib/seasons/management.ts:43`. Misleading for log/monitoring consumers that group by `code`. *(security Info + quality Low)*
6. **`listRepeatableOrders` is dead code with a wider filter than the UI** — `src/lib/orders/repeat-review.ts:161-168`. No import sites; its `notIn: ['DRAFT','DISCARDED']` includes `CANCELLED`, contradicting the detail-page repeat-button guard. *(quality Low + clean-code Minor)*
7. **`repeat-order.ts` re-exports symbols nobody imports from there** — `src/lib/orders/repeat-order.ts:35` re-exports `REPEAT_NOTHING_TO_COPY`/`REPEAT_SOURCE_NOT_FOUND` from `repeat-plan.ts`; consumers import them directly from `repeat-plan.ts`. *(clean-code Minor)*
8. **Action-helper pattern inconsistent within P10** — `src/app/(admin)/admin/seasons/actions.ts:83-90` defines local `done`/`back`; `src/app/(admin)/admin/catalog/replacements/actions.ts:19-39` inlines `revalidatePath` + `redirectWithFlash`. Pick one (the `seasons` shape matches the rest of the admin tree). *(clean-code Minor)*
9. **Data-fetching pattern drift between `seasons/page.tsx` and `seasons/new/page.tsx`** — `seasons/page.tsx:32` uses `listSeasons()`; `seasons/new/page.tsx:31` and `replacements/page.tsx:31` inline `db.season.findMany`. Three P10 admin screens, three copies of "list seasons desc," one through lib. *(clean-code Minor)*
10. **`AddressColumns` object literal duplicated** — `src/lib/orders/repeat-plan.ts:307-314` and `:401-417` (plus a line-snapshot fallback). Extract `addressColumnsFromSaved(addr)` / `addressColumnsFromLine(line)`. *(clean-code Minor)*
11. **Validation error message omits the received value** — `src/app/(admin)/admin/seasons/actions.ts:25` (and `schedule.ts:93,96`). Messages state the expected set but not what was received. *(clean-code Minor)*
12. **`mappingOptions` runs a DB query from a page-local helper** — `src/app/(admin)/admin/catalog/replacements/page.tsx:190-221`. Data access belongs in `lib/catalog/replacements.ts` next to `resolveReplacements`. *(clean-code Minor)*
13. **Missing P10 smoke / status evidence** — `arms/arm-04/workspace/.scratch/PHASE-P10-STATUS.md` and `.scratch/PHASE-P10-SMOKE.md` are absent (arm-03 has both). S1–S4 cannot be confirmed from the archive alone. *(quality Low, process)*
14. **Cron season-flip persists first 200 chars of `error.message` into `CronRunLog.detail`** — `src/lib/cron/job-run.ts:54-70`. Database/driver errors can carry connection-string fragments; a sanitiser that strips known secret patterns would be more defensible than a length cap. *(security Info)*
15. **Cron season-flip has no replay or rate-limit protection** — `src/lib/cron/authorize.ts:19-28`. Static bearer secret is replayable; job is idempotent so damage is nil, but noted for completeness. *(security Info)*
16. **`createSeasonFromWizard` with `linkReplacements` mutates products in the source (past) season** — `src/lib/seasons/wizard.ts:170-177`. Authorized and audited, but past-season catalogue data is mutable after close; data-integrity note. *(security Info)*

## Notes

- No security Critical/High findings; no blockers.
- Two cross-specialist dupes were merged: `setSeasonSchedule` missing-season (security Low + rules High → major) and `SEASON_ALREADY` reuse (security Info + quality Low → minor), plus `listRepeatableOrders` dead code (quality Low + clean-code Minor → minor).
- The `importPriorYearOrder` update-branch bug (major #2) and the `addressKey` upsert naming bug (minor #3) are distinct findings on the same file.
- The scheduled-flip audit gap (major #3) and the scheduled-flip `closesAt` override (major #4) are distinct findings on the same function.
