# P10 Aggregate Review — arm-01

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Scope:** `arms/arm-01/workspace/` P10 touch-points only.
**Inputs:** `P10-security-arm-01.md`, `P10-quality-arm-01.md`, `P10-rules-arm-01.md`, `P10-clean-code-arm-01.md`
**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings.

## Counts

| Severity | Count |
|---|---|
| Blocker (security) | 1 |
| Major (High + Medium) | 15 |
| Minor (Low + Info) | 21 |
| **Total** | **37** |

Source roll-up before dedupe: Security 11, Quality 8, Rules 13, Clean-code 14 = 46 raw findings. 9 duplicates merged (see Dedupe notes).

## Blocker (security)

### B1 — Write-side-effect in the `getCurrentSeason` getter
`src/lib/storefront.ts:4-5`
Sources: Sec H-1, R-M5, CC H1.

`getCurrentSeason()` calls `applyScheduledSeasonStatuses(db)` on every read. Any unauthenticated storefront hit triggers a `findMany` + `$transaction` (flips CLOSED→OPEN, closes other seasons, upserts `current-season-id`) and writes a `season.status_auto_flipped` audit row with `actorStaffId: null`. No auth, no rate limit, no idempotency guard; concurrent requests can race the `updateMany`. Bypasses the cron secret boundary (`/api/cron/season-status`) and lets anonymous users cause privileged-looking state transitions. The cron route is the correct single trigger; the eager call duplicates that duty on a hot read path.

## Major — High

### A-H1 — Missing P10 smoke evidence archive
`arms/arm-01/workspace/.scratch/PHASE-P10-SMOKE.md` (absent)
Sources: Q H-1.

`PHASE-P10-EXPECTED.md` declares the evidence path; no `.scratch/` directory exists in arm-01. `scripts/p10-smoke.ts` is wired (`npm run smoke:p10`) but no archived run record (S1/S2/S3 results, timestamps, env) was produced. Smoke cannot be considered gated without the artifact.

### A-H2 — `repeatOrdersInBulk` fetches the repeat review twice per order
`src/domain/repeat-orders.ts:367` (and `:199`)
Sources: R-M4, CC H2.

`repeatOrdersInBulk` calls `getRepeatReview` to validate each line, then `createRepeatDraft` calls `getRepeatReview` again internally. Each review is a full pass (source order + target season + every line + N `resolveReplacementChain` walks + full target-season product list). A 50-order batch doubles the entire review cost. Reuse a single review or accept a precomputed one.

### A-H3 — `createRepeatDraft` re-fetches and re-validates the source order a third time
`src/domain/repeat-orders.ts:200, :226`
Sources: CC H3.

`getRepeatReview` already asserts `status === "FINALIZED"` and returns `sourceOrder.version`; `createRepeatDraft` re-checks `version` and issues `prisma.order.findFirstOrThrow({ where: { id, version, status: "FINALIZED" } })` — a third fetch with a competing validation site that can drift from `getRepeatReview`.

## Major — Medium

### A-M1 — Scheduled season status accepts past times
`src/domain/seasons.ts:100-132`
Sources: Sec M-1.

`scheduleSeasonStatus` validates finiteness but not `scheduledAt > now`. A manager can schedule a flip in the past that applies on the next tick and is audited as `season.status_scheduled` rather than `season.status_changed`, blurring deliberate vs. scheduled transitions. Both paths require `settings:manage`, so audit-integrity, not privilege.

### A-M2 — Customer-initiated repeat drafts have no actor attribution
`src/app/api/order/repeat/route.ts:51`
Sources: Sec M-2.

`createRepeatDraft` is called without `actorStaffId`; the audit row (`order.repeat_review_confirmed`) records `actorStaffId: null` and only `sourceOrderId`/`sourceVersion` — never the acting customer identity (clerk user id / customerId). Customer-driven drafts are not attributable to the customer who triggered them.

### A-M3 — Bulk repeat bypasses per-line replacement/recipient confirmation
`src/domain/repeat-orders.ts:346-394`
Sources: Sec M-3.

`repeatOrdersInBulk` auto-accepts `mappedProductId` and the original `recipientAddressId` for every line and creates drafts with no human confirmation. P10 EXPECTED (UR-007, G-011, G-012) requires confirming replacements AND recipients; the single-order path enforces this via the review page, the bulk path silently skips it. Staff-initiated (`orders:manage`), so integrity/process gap, not privilege.

### A-M4 — Inconsistent input validation in catalog API
`src/app/api/admin/catalog/route.ts:17-27, 77-87`
Sources: R-M2.

POST/PATCH/DELETE parse `request.json() as { ... }` and do manual field checks (`!body.sku?.trim()`, `(body.priceCents ?? -1) < 0`). Sibling P10 routes (`repeat`, `seasons`, `bulk-repeat`) all use Zod. Two validation patterns in the same feature.

### A-M5 — Duplicate audit log on status change
`src/app/api/admin/settings/route.ts:93-107`
Sources: R-M3.

Every PATCH writes a `settings.storefront_updated` audit row; when `storeStatus`/`scheduledStatus` is set, `setSeasonStatus`/`scheduleSeasonStatus` (`seasons.ts:87-95, 119-130`) already write `season.status_changed`/`season.status_scheduled`. Two audit rows per status change for the same actor/moment.

### A-M6 — Scheduled auto-flip has no platform cron registration
`src/app/api/cron/season-status/route.ts`; no `vercel.json` in workspace
Sources: Q M-1.

The bearer-authed cron sweep endpoint exists but no `vercel.json` `crons` entry (or external scheduler) invokes it. `applyScheduledSeasonStatuses` only runs lazily from `getCurrentSeason`. UR-008's "scheduled auto-flip at configured time" only fires on the next storefront request after due time; during a quiet period the season stays in the prior state indefinitely. The cron route is effectively dead code without a scheduler.

### A-M7 — Repeat draft silently drops fulfillment method on code mismatch
`src/domain/repeat-orders.ts:284-292`
Sources: Q M-2.

Target fulfillment method is resolved by matching `sourceLine.fulfillmentMethod.code` against target-season methods. If no method with that code exists, `method` is `null` and `fulfillmentMethodId` is written `null` with no error/flag. The draft line has no fulfillment method, surfacing as a broken checkout/packaging flow later. Smoke only exercises a `SHIPPING` code present in both seasons, so this path is untested.

### A-M8 — `setSeasonStatus` always promotes the touched season to current
`src/domain/seasons.ts:82-86`
Sources: Q M-3.

Closing the current season upserts `current-season-id` to that now-closed season. If another season is still `OPEN`, the storefront reports the current season as closed (ordering blocked) while an open season exists but is not "current". Open/closed semantics of `current-season-id` vs. an existing open season are inconsistent.

### A-M9 — "Target season must be OPEN" rule is not centralized
`src/domain/repeat-orders.ts`, customer + staff routes/pages
Sources: CC M5, Sec I-2.

The customer route (`api/order/repeat/route.ts:43-49`) and customer page enforce `targetSeason.status === "OPEN"` before repeating, but `createRepeatDraft`/`getRepeatReview` and the staff route + staff page enforce nothing. A staff user can repeat a finalized order into a CLOSED target season; a customer cannot. The business rule lives in the edges instead of the domain. Centralize the OPEN check in `getRepeatReview`/`createRepeatDraft` so both paths inherit it.

### A-M10 — `repeatSchema` duplicated across customer and staff routes
`src/app/api/order/repeat/route.ts:8-18`, `src/app/api/admin/orders/[orderId]/repeat/route.ts:7-16`
Sources: CC M4.

Same Zod schema (`sourceVersion` + `decisions[]` with `sourceLineId` / `productId` nullable / `recipientAddressId`) declared in both routes. Two sources of truth for the repeat payload; the domain already owns `RepeatLineDecision`. Move the schema next to `createRepeatDraft` (or export a shared `repeatDecisionSchema`).

### A-M11 — "Close other OPEN seasons + upsert `current-season-id`" logic duplicated three ways
`src/domain/seasons.ts:34-42, :69-86, :286-294`
Sources: CC M6.

`applyScheduledSeasonStatuses`, `setSeasonStatus`, and `createSeasonFromTemplate` each independently: (a) `updateMany` other OPEN seasons to CLOSED, (b) `appSetting.upsert` `current-season-id`, (c) write an `auditLog`. Three copies of the same "promote this season to current" operation. Extract one `promoteCurrentSeason(tx, seasonId, action, actorStaffId, metadata)`.

### A-M12 — Inconsistent HTTP response + error-handling pattern across P10 routes
`src/app/api/cron/season-status/route.ts:9`, `src/app/api/admin/orders/bulk-repeat/route.ts:34`
Sources: CC M7, R-L4.

The cron route uses `Response.json(...)` while every admin/customer route in P10 uses `NextResponse.json(...)`. Separately, `bulk-repeat/route.ts:34` `throw error` for any non-`AccessDeniedError` (→ Next 500), whereas `seasons/route.ts`, the single-repeat routes, and the settings route all catch and return `400` with `error.message`. Two response helpers and two error strategies in the same phase. Pick one per concern.

## Minor — Low

### A-L1 — State-changing cron endpoint exposed as GET
`src/app/api/cron/season-status/route.ts:5`
Sources: Sec L-1.

Mutates season state and writes audit logs but is a GET. Bearer header mitigates browser CSRF (custom header forces preflight), but a state-mutating GET violates safe-method semantics and is fragile to any future proxy/intermediate that strips headers or caches the response.

### A-L2 — `assertReplacementMapping` runs outside the update transaction
`src/app/api/admin/catalog/route.ts:100-114`
Sources: Sec L-2.

Cycle/sanity check runs against `db` before the `$transaction` that performs the `updateMany`. Between check and commit, a concurrent edit could alter the replacement graph and introduce a cycle. Requires two concurrent manager edits, so impact is low, but validation is not atomic with the write.

### A-L3 — `assertReplacementMapping` does not require the replacement product to be active
`src/domain/repeat-orders.ts:58-97`
Sources: Sec L-3.

Assert validates kind, later-season, and cycle, but not `replacement.isActive`. A manager can map a product to an inactive replacement; `resolveReplacementChain` then returns null at the end (`product.isActive ? product.id : null`), silently breaking the chain. Data-integrity gap.

### A-L4 — No rate limiting on customer repeat endpoint
`src/app/api/order/repeat/route.ts`
Sources: Sec L-4.

A signed-in customer can spam POST to create unbounded draft orders (each with a random `draftReference`). No rate limit or per-customer draft cap. Low impact (drafts are cheap, no payment), but enables DB/audit row flooding.

### A-L5 — Replacement chain resolution is N+1 per line
`src/domain/repeat-orders.ts:22-56`
Sources: Sec L-5.

`resolveReplacementChain` issues one `findUnique` per hop, and `getRepeatReview` awaits it per source line serially (`Promise.all` over lines, but each line's chain is sequential). A deep chain or large order amplifies DB load on the customer repeat-review read path. DoS-surface, low.

### A-L6 — Customer repeat page can 500 on direct same-season URL access
`src/app/(storefront)/account/orders/[orderId]/repeat/page.tsx:24`
Sources: Q L-1.

`getRepeatReview` throws `"Choose an order from an earlier season to repeat."` when `sourceOrder.seasonId === targetSeason.id`. The page only guards `targetSeason.status !== "OPEN"` (→ `notFound()`); the same-season throw is unhandled and surfaces as a 500. The repeat link is hidden for same-season orders, but direct URL entry is not defended.

### A-L7 — Catalog PATCH does not normalize empty-string replacement to null
`src/app/api/admin/catalog/route.ts:100-125`
Sources: Q L-2.

`assertReplacementMapping` runs only when `body.replacementProductId` is truthy. An empty string is falsy, so validation is skipped and `replacementProductId: ""` is written to the DB (a non-null empty string on a `String?` field). The UI sends `null`, but the API does not normalize `""` → `null`, leaving the door open for other clients.

### A-L8 — Bulk repeat button has no confirmation step
`src/components/admin-order-actions.tsx:11-30` (`BulkRepeatButton`)
Sources: Q L-3.

"Repeat finalized on page" immediately POSTs every finalized order on the rendered page (up to 25) to `/api/admin/orders/bulk-repeat` with no confirm dialog. A misclick creates up to 25 drafts. Conflicts are reported in a message, but applied drafts are created unconditionally.

### A-L9 — `repeatOrders` is a dead passthrough wrapper
`src/lib/admin-operations.ts:151-156`
Sources: R-M1, CC L12.

`repeatOrders()` is a one-line passthrough to `repeatOrdersInBulk` with no caller (Rule of 2 fails, 0 call sites). Routes import `repeatOrdersInBulk` directly. Delete it.

### A-L10 — `createSeasonFromTemplate` overwrites existing forward mappings
`src/domain/seasons.ts:266-272`
Sources: R-M6, Q L-4.

The wizard sets each prior product's `replacementProductId` to the new clone and increments `version`, unconditionally. If a template product already points to a later replacement, that mapping is clobbered with no check and no DECISION-LOG entry. The UI copy describes "forward replacement mappings," but the overwrite-when-already-mapped branch is a silent business decision. For repeat resolution latest wins, but the previous mapping is lost without audit of the override.

### A-L11 — `__REMOVE__` magic string in the review component
`src/components/repeat-review.tsx:58, 82, 166, 173`
Sources: R-L1, CC M8.

Sentinel `"__REMOVE__"` used four times to mean "drop this line", threaded through `productChoices` and the `productId` decision. Unnamed magic value shared between UI and wire payload, colliding with the empty-string "no choice yet" state in the same `Record`. Extract a named constant co-located with `RepeatLineDecision`; ideally model "remove" as `productId: null` rather than a sentinel the server must decode.

### A-L12 — Misleading recipient fallback in repeat submit
`src/components/repeat-review.tsx:86-88`
Sources: R-L6, CC M9.

`recipientAddressId: recipientChoices[line.sourceLineId] || addresses[0]?.id || ""`. The preceding `hasUnresolvedLine` guard (`:56-63`) already blocks submit when a non-removed line has no `recipientChoices` value, so the `addresses[0]?.id` branch can never execute. "Just in case" code that silently picks a recipient the user never chose if the guard ever regresses. Drop the fallback or make the guard the single source of truth.

### A-L13 — Magic strings for `targetKind`
`src/domain/seasons.ts:245, 256`
Sources: R-L2.

`"PRODUCT"` / `"ADD_ON"` literals. Use the enum / named constants.

### A-L14 — Vague error message
`src/app/api/admin/settings/route.ts:53`
Sources: R-L3.

`"Admin settings are invalid."` does not say which field failed (followUpDays range, sender name, ops alert, or webhook label).

### A-L15 — Catalog POST drops `imageUrl`, silently defaults `category`
`src/app/api/admin/catalog/route.ts:50, 54`
Sources: R-L5.

POST never persists `imageUrl` (PATCH does), and defaults `category` to `"Gifts"` with no flag. Newly created products can't get an image; the default category is an unlogged business choice.

### A-L16 — Convoluted price guard
`src/app/api/admin/catalog/route.ts:35`
Sources: R-L7.

`(body.priceCents ?? -1) < 0` paired with `Number.isInteger(body.priceCents)`. `Number.isInteger` already rejects `undefined`; the `?? -1` is defensive for a condition that can't happen. Drop the fallback.

### A-L17 — `keptDecisions` name is misleading
`src/domain/repeat-orders.ts:209`
Sources: CC L10.

`keptDecisions` is built from every review line, including entries where `productId` is `null` (the line the user is removing). The collection holds all decisions, not the kept ones; `!keptDecisions.some((entry) => entry.productId)` at `:215` confirms "kept" is a subset. Rename to `decisions` / `resolvedDecisions`.

### A-L18 — `line.recipientAddressId!` non-null assertion in bulk repeat
`src/domain/repeat-orders.ts:382`
Sources: CC L11.

Asserts `recipientAddressId: line.recipientAddressId!` after the `:369-373` guard that rejects lines with a falsy `recipientAddressId`. The assertion is correct only because of a runtime guard three lines up; the compiler can't see the invariant and a refactor that moves the guard will silently let `null` through. Prefer an explicit `if (!line.recipientAddressId) throw …` over `!`.

### A-L19 — `index === 0` "closest price" label is coupled to domain sort order
`src/components/repeat-review.tsx:163`
Sources: CC L13.

Labels the first suggestion `· closest price` based on `index === 0`. True only because `getRepeatReview` sorts `suggestions` by `Math.abs(priceCents - snapshot)` then name. The component silently depends on a sort order owned by another module; if the domain sort changes, the label lies. Compute "closest" in the component from the snapshot or have the domain mark `isClosestPrice`.

### A-L20 — Near-identical inventory-create conditional spreads in season wizard
`src/domain/seasons.ts:241-262`
Sources: CC L14.

Two inline `...(product.inventoryItem ? { inventoryItem: { create: { targetKind: "PRODUCT"|"ADD_ON", onHand: 0, reserved: 0 } } } : {})` blocks differing only in `targetKind` and which source flag gates them. Rule of 2 met; a small `cloneInventory(targetKind)` helper would remove the duplicated shape and the `onHand: 0` magic that appears twice.

## Minor — Info

### A-I1 — Duplicate-season-year not prevented
`src/domain/seasons.ts:134-168`
Sources: Sec I-1.

`createSeasonFromTemplate` validates year > template year but does not check for an existing season with the same year. A manager can create multiple seasons for one year. Data-integrity only.

## Dedupe notes

Merged duplicates (9):
- Write-side-effect in `getCurrentSeason`: Sec H-1 + R-M5 + CC H1 → B1 (3→1).
- `repeatOrdersInBulk` double review: R-M4 + CC H2 → A-H2 (2→1).
- `repeatOrders` dead wrapper: R-M1 + CC L12 → A-L9 (2→1).
- `createSeasonFromTemplate` overwrite: R-M6 + Q-L4 → A-L10 (2→1).
- `__REMOVE__` magic string: R-L1 + CC M8 → A-L11 (2→1).
- Misleading recipient fallback: R-L6 + CC M9 → A-L12 (2→1).
- Inconsistent HTTP response + error-handling: CC M7 + R-L4 → A-M12 (2→1).
- "Target season OPEN" rule not centralized: CC M5 + Sec I-2 → A-M9 (2→1).

A-M9 (centralization gap) and the staff-route OPEN-guard note (Sec I-2) share a location but make the same claim; folded. No new findings introduced.

