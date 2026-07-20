# Reviewer specialist — Clean-code

**Arm:** `arm-01`
**Tree / phase:** P10 — Seasons management, repeat orders, replacement mappings
**Output:** `results/reviews/P10-clean-code-arm-01.md`
**Scope:** P10 new/modified files under `arms/arm-01/workspace/` (`domain/repeat-orders.ts`, `domain/seasons.ts`, `components/repeat-review.tsx`, `components/catalog-manager.tsx`, `components/settings-hub.tsx`, `lib/admin-operations.ts`, `lib/storefront.ts`, `app/api/admin/seasons/route.ts`, `app/api/admin/orders/[orderId]/repeat/route.ts`, `app/api/admin/orders/bulk-repeat/route.ts`, `app/api/order/repeat/route.ts`, `app/api/cron/season-status/route.ts`, `app/api/admin/catalog/route.ts`, `app/api/admin/settings/route.ts`, `app/(admin)/admin/orders/[orderId]/repeat/page.tsx`, `app/(admin)/admin/orders/[orderId]/page.tsx`, `app/(admin)/admin/settings/page.tsx`, `app/(admin)/admin/catalog/page.tsx`, `app/(storefront)/account/orders/[orderId]/repeat/page.tsx`, `app/(storefront)/account/orders/[orderId]/page.tsx`). Findings only, no fixes. Blind to model name.

Focus: duplication, naming, god files, pattern drift. `clean-code` is in arm rules — review applies.

## Summary

P10 lands the season wizard, scheduled auto-flip, replacement-chain resolution, and the customer/staff repeat-review flow on top of the right primitives (`requirePermission` / `AccessDeniedError`, `$transaction` + `auditLog`, `getRepeatReview` as a shared domain seam, the `current-season-id` setting). The clean-code debt clusters in three places: **a write-side-effect baked into the `getCurrentSeason` getter** (every storefront read now runs a season-flip transaction), **double and triple fetches of the same source order across the repeat path** (`repeatOrdersInBulk` → `createRepeatDraft` → `getRepeatReview` each re-fetch the order and re-validate it), and **business-rule + schema + response-helper drift** between the customer and staff repeat routes. Smaller issues: a `__REMOVE__` magic string, dead defensive fallbacks in the review component, a misleading `keptDecisions` name, and a passthrough wrapper left behind in `admin-operations.ts`.

## Findings

### High

1. **Write-side-effect in the `getCurrentSeason` getter** — `lib/storefront.ts` now opens `getCurrentSeason()` with `await applyScheduledSeasonStatuses(db)`. Every storefront read (every customer-facing page that calls `getCurrentSeason`) now runs a Prisma transaction that may flip season status, close other OPEN seasons, upsert `current-season-id`, and write an `auditLog` row — on a GET. The cron route (`app/api/cron/season-status/route.ts`) is the correct single trigger for auto-flip; calling it from the read path is "just in case" code and means the cron is now redundant on any traffic. It also couples a read to a write and to audit logging, and turns a hot path into a transactional one. Violates "no just-in-case code" and "one pattern per concern" (auto-flip belongs to the cron). (lib/storefront.ts)

2. **`repeatOrdersInBulk` fetches the repeat review twice per order** — `domain/repeat-orders.ts:367` calls `getRepeatReview(prisma, requested.orderId)` to check that every line has a mapping/recipient, then calls `createRepeatDraft(prisma, …)` which at `:199` calls `getRepeatReview` again internally. Each `getRepeatReview` is a full review (source order + target season + every line + N `resolveReplacementChain` walks + the full target-season product list). For a 50-order bulk batch this doubles the entire review cost. The pre-check should reuse a single review or `createRepeatDraft` should accept a precomputed review. (domain/repeat-orders.ts)

3. **`createRepeatDraft` re-fetches and re-validates the source order a third time** — `getRepeatReview` already fetches the source order, asserts `status === "FINALIZED"`, and returns `sourceOrder.version`; `createRepeatDraft` then re-checks `review.sourceOrder.version !== input.sourceVersion` (`:200`) and issues `prisma.order.findFirstOrThrow({ where: { id, version, status: "FINALIZED" }, … })` (`:226`) — a third fetch of the same order with a third FINALIZED/version assertion. The review already established all of this; the re-fetch is redundant work and a competing validation site that can drift from `getRepeatReview`. (domain/repeat-orders.ts)

### Medium

4. **`repeatSchema` duplicated across customer and staff routes** — `app/api/order/repeat/route.ts:8-18` and `app/api/admin/orders/[orderId]/repeat/route.ts:7-16` declare the same Zod schema (`sourceVersion` + `decisions[]` with `sourceLineId` / `productId` nullable / `recipientAddressId`). Two sources of truth for the repeat payload; the domain already owns `RepeatLineDecision`. Move the schema next to `createRepeatDraft` (or export a shared `repeatDecisionSchema`) so the wire shape and the domain type can't drift. (api/order/repeat/route.ts, api/admin/orders/[orderId]/repeat/route.ts)

5. **"Target season must be OPEN" rule is not centralized** — the customer route (`app/api/order/repeat/route.ts:43-49`) and the customer page (`app/(storefront)/account/orders/[orderId]/repeat/page.tsx:25`) both enforce `targetSeason.status === "OPEN"` before repeating, but `createRepeatDraft` / `getRepeatReview` and the staff route + staff page enforce nothing. A staff user can repeat a finalized order into a CLOSED target season; a customer cannot. The business rule lives in the edges instead of the domain. Centralize the OPEN check in `getRepeatReview` (or `createRepeatDraft`) so both paths inherit it. (domain/repeat-orders.ts, routes, pages)

6. **"Close other OPEN seasons + upsert `current-season-id`" logic duplicated three ways** — `applyScheduledSeasonStatuses` (`domain/seasons.ts:34-42`), `setSeasonStatus` (`:69-86`), and `createSeasonFromTemplate` (`:286-294`) each independently: (a) `updateMany` other OPEN seasons to CLOSED, (b) `appSetting.upsert` `current-season-id`, (c) write an `auditLog`. Three copies of the same "promote this season to current" operation. Extract one `promoteCurrentSeason(transaction, seasonId, action, actorStaffId, metadata)` and call it from all three. (domain/seasons.ts)

7. **Inconsistent HTTP response + error-handling pattern across P10 routes** — the cron route (`app/api/cron/season-status/route.ts:9`) uses `Response.json(...)`, while every admin/customer route in P10 uses `NextResponse.json(...)`. Separately, `bulk-repeat/route.ts:34` `throw error` for any non-`AccessDeniedError` (→ Next 500), whereas `seasons/route.ts`, the single-repeat routes, and the settings route all catch and return `400` with `error.message`. Two response helpers and two error strategies in the same phase. Pick one per the "one pattern per concern" rule. (api/cron/season-status/route.ts, api/admin/orders/bulk-repeat/route.ts)

8. **`__REMOVE__` magic string in the review component** — `components/repeat-review.tsx` uses the sentinel `"__REMOVE__"` in three places (`:58`, `:82`, `:166`) to mean "drop this line", threaded through `productChoices` and the `productId` decision. It is an unnamed magic value shared between the UI and the wire payload, and it collides with the empty-string "no choice yet" state in the same `Record`. Extract a named constant (e.g. `REMOVE_LINE = "__REMOVE__"`) co-located with `RepeatLineDecision`, and ideally model "remove" as `productId: null` rather than a sentinel string the server must decode. (components/repeat-review.tsx)

9. **Dead defensive fallback in repeat submit** — `components/repeat-review.tsx:86-88` sends `recipientAddressId: recipientChoices[line.sourceLineId] || addresses[0]?.id || ""`. The preceding `hasUnresolvedLine` check (`:56-63`) already blocks submit when a non-removed line has no `recipientChoices` value, so the `addresses[0]?.id` branch can never execute. It is "just in case" code that also silently picks a recipient the user never chose if the guard ever regresses. Drop the fallback or make the guard the single source of truth. (components/repeat-review.tsx)

### Low

10. **`keptDecisions` name is misleading** — `domain/repeat-orders.ts:209` builds `keptDecisions` from every review line, including entries where `productId` is `null` (i.e. the line the user is removing). The collection holds *all* decisions, not the kept ones; `!keptDecisions.some((entry) => entry.productId)` at `:215` confirms "kept" is a subset. Rename to `decisions` / `resolvedDecisions` so the name matches the contents. (domain/repeat-orders.ts)

11. **`line.recipientAddressId!` non-null assertion in bulk repeat** — `domain/repeat-orders.ts:382` asserts `recipientAddressId: line.recipientAddressId!` after the `:369-373` guard that rejects lines with a falsy `recipientAddressId`. The assertion is correct only because of a runtime guard three lines up; the compiler can't see the invariant and a refactor that moves the guard will silently let `null` through. Prefer an explicit `if (!line.recipientAddressId) throw …` (or filter) over `!`. (domain/repeat-orders.ts)

12. **`repeatOrders` is now a passthrough wrapper** — `lib/admin-operations.ts:151-156` reduced `repeatOrders` to `return repeatOrdersInBulk(db, actorStaffId, requestedSources)` with no added behavior. It exists only to preserve the old call site. Either inline the callers onto `repeatOrdersInBulk` or keep the facade with a comment explaining the boundary; as-is it is a zero-logic delegation that can rot independently. (lib/admin-operations.ts)

13. **`index === 0` "closest price" label is coupled to domain sort order** — `components/repeat-review.tsx:163` labels the first suggestion `· closest price` based on `index === 0`. The "closest price" claim is true only because `getRepeatReview` sorts `suggestions` by `Math.abs(priceCents - snapshot)` then name. The component silently depends on a sort order owned by another module; if the domain sort changes (e.g. to alphabetical), the label lies. Either compute "closest" in the component from the snapshot or have the domain mark `isClosestPrice` on the suggestion. (components/repeat-review.tsx)

14. **Near-identical inventory-create conditional spreads in season wizard** — `domain/seasons.ts:241-262` has two inline `...(product.inventoryItem ? { inventoryItem: { create: { targetKind: "PRODUCT"|"ADD_ON", onHand: 0, reserved: 0 } } } : {})` blocks differing only in `targetKind` and which source flag gates them. Rule of 2 is met; a small `cloneInventory(targetKind)` helper would remove the duplicated shape and the `onHand: 0` magic that appears twice. (domain/seasons.ts)

## Counts

| Severity | Count |
|---|---|
| High | 3 |
| Medium | 6 |
| Low | 5 |
| **Total** | **14** |
