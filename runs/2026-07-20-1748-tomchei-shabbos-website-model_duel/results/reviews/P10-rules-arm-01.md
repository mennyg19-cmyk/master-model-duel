# P10 Rules Review — arm-01

Reviewer specialist: Rules. Blind to model name.
Scope: P10 changes under `arms/arm-01/workspace/` (seasons, repeat orders, replacement mappings).
Rules graded: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`, `grill-protocol` (per `arms/arm-01/ARM.md`). Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 6 |
| Low | 7 |
| **Total** | **13** |

Strengths: domain logic is split into `src/domain/repeat-orders.ts` and `src/domain/seasons.ts` (concern split, not size). Naming is descriptive and boolean-friendly (`isActive`, `hasConfirmedReplacements`). No narration comments. Optimistic-concurrency via `version` is consistent across catalog/season mutations. Zod validation is used on the new repeat/seasons/bulk routes. Cycle detection in `resolveReplacementChain` and `assertReplacementMapping` is explicit. Audit logging is present on every state change.

## Medium findings

### M1 — Dead wrapper, zero call sites (clean-code: dead code, Rule of 2)
`src/lib/admin-operations.ts:151-156` — `repeatOrders()` is a one-line passthrough to `repeatOrdersInBulk`. Grep across `src/` finds no caller. Rule of 2 fails (0 call sites). Delete it; routes import `repeatOrdersInBulk` directly.

### M2 — Inconsistent input validation in catalog API (clean-code: one pattern per concern)
`src/app/api/admin/catalog/route.ts:17-27, 77-87` — POST/PATCH/DELETE parse `request.json() as { ... }` and do manual field checks (`!body.sku?.trim()`, `(body.priceCents ?? -1) < 0`). The sibling P10 routes (`repeat/route.ts`, `seasons/route.ts`, `bulk-repeat/route.ts`) all use Zod schemas. Two validation patterns in the same feature.

### M3 — Duplicate audit log on status change (clean-code: consistency)
`src/app/api/admin/settings/route.ts:93-107` writes an `settings.storefront_updated` audit row on every PATCH. When `storeStatus` or `scheduledStatus` is set, `setSeasonStatus` / `scheduleSeasonStatus` (`src/domain/seasons.ts:87-95, 119-130`) already write `season.status_changed` / `season.status_scheduled`. Two audit rows per status change for the same actor/moment.

### M4 — `getRepeatReview` runs twice per bulk order (ponytail: efficiency)
`src/domain/repeat-orders.ts:367` — `repeatOrdersInBulk` calls `getRepeatReview` to validate, then calls `createRepeatDraft`, which calls `getRepeatReview` again (line 199). For a 50-order batch that is 100 review passes plus the doubled Prisma includes. The review already computed in the loop should be passed through.

### M5 — Write side-effect on every storefront read (clean-code: read/write separation)
`src/lib/storefront.ts:5` — `getCurrentSeason` calls `applyScheduledSeasonStatuses(db)` on every invocation. Every storefront page load (customer browse, account order detail, admin order detail) triggers a season sweep. Cheap when nothing is due, but a read endpoint silently mutates seasons and the `current-season-id` setting, and can race with concurrent requests. Cron route already exists (`api/cron/season-status`); the eager call duplicates that responsibility.

### M6 — `createSeasonFromTemplate` silently overwrites existing replacement mappings (workflow: never silently choose business logic)
`src/domain/seasons.ts:266-272` — for each template product it sets `replacementProductId: clonedProduct.id` and increments `version`, unconditionally. If a template product already points to a later replacement, that mapping is clobbered with no check and no DECISION-LOG entry. The UI copy describes "forward replacement mappings," but the overwrite-when-already-mapped branch is a silent business decision.

## Low findings

### L1 — Magic string `"__REMOVE__"` (clean-code: magic values)
`src/components/repeat-review.tsx:58, 82, 166, 173` — sentinel used four times. Extract a named constant.

### L2 — Magic strings for `targetKind` (clean-code: magic values)
`src/domain/seasons.ts:245, 256` — `"PRODUCT"` / `"ADD_ON"` literals. Use the enum / named constants.

### L3 — Vague error message (clean-code: error handling)
`src/app/api/admin/settings/route.ts:53` — `"Admin settings are invalid."` does not say which field failed (followUpDays range, sender name, ops alert, or webhook label).

### L4 — Inconsistent error handling in bulk-repeat route (clean-code: consistency)
`src/app/api/admin/orders/bulk-repeat/route.ts:34` — non-`AccessDeniedError` errors are re-thrown (→ 500). Sibling routes (`repeat/route.ts:43-46`, `catalog/route.ts`) catch and return 400 with the error message.

### L5 — Catalog POST drops `imageUrl`, silently defaults `category` (clean-code: consistency; workflow: silent business logic)
`src/app/api/admin/catalog/route.ts:50,54` — POST never persists `imageUrl` (PATCH does), and defaults `category` to `"Gifts"` with no flag. Newly created products can't get an image; the default category is an unlogged business choice.

### L6 — Misleading recipient fallback (clean-code: anti-AI-tics)
`src/components/repeat-review.tsx:86-88` — `recipientChoices[line.sourceLineId] || addresses[0]?.id || ""`. The `hasUnresolvedLine` guard (lines 56-63) already ensures a recipient is chosen for kept lines, so the `addresses[0]?.id` fallback is dead for kept lines and only fires for removed lines (whose recipient is ignored server-side). Reads as if a missing pick is auto-filled; it isn't. Simplify.

### L7 — Convoluted price guard (clean-code: anti-AI-tics)
`src/app/api/admin/catalog/route.ts:35` — `(body.priceCents ?? -1) < 0` paired with `Number.isInteger(body.priceCents)`. `Number.isInteger` already rejects `undefined`; the `?? -1` is defensive for a condition that can't happen. Drop the fallback.
