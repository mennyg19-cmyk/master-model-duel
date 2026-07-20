# P10 Security Review — arm-01 (blind)

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Scope:** `arms/arm-01/workspace/` P10 surface only (seasons, repeat orders, replacement mappings, season-status cron).
**Reviewer focus:** trust boundaries, auth, secrets, IDOR, injection.
**Method:** findings only — no fixes. No new scope beyond P10.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 5 |
| Info | 2 |

Auth posture is generally sound: staff routes gate on `requirePermission`, customer repeat verifies source-order ownership before drafting, replacement chains have cycle detection, and prices are server-derived. The findings below are integrity/audit/availability gaps, not classic injection or auth bypass.

## Findings

### H-1 — Unauthenticated storefront traffic triggers season auto-flip + audit writes
`src/lib/storefront.ts:4-5` — `getCurrentSeason()` calls `applyScheduledSeasonStatuses(db)` on every read. Any unauthenticated visitor hitting a storefront page can trigger:
- a `findMany` for due seasons,
- a `$transaction` that flips a season from CLOSED→OPEN, closes other seasons, mutates `current-season-id`, and
- writes an `auditLog` row (`season.status_auto_flipped`).

The auto-flip is meant to be a privileged cron operation (`/api/cron/season-status`), but it is also reachable through the public read path with no auth, no rate limit, and no idempotency guard. Concurrent storefront requests can race the `updateMany` optimistic guard, and an attacker can force repeated audit-log writes by refreshing storefront pages. This bypasses the cron secret boundary and lets anonymous users cause privileged-looking state transitions attributed to no actor (`actorStaffId` null on the auto-flip audit entry, `src/domain/seasons.ts:44-51`).

### M-1 — Scheduled season status accepts past times
`src/domain/seasons.ts:100-132` — `scheduleSeasonStatus` only validates that the date is finite; it does not require `scheduledAt` to be in the future. A manager can schedule a status flip in the past, which immediately applies on the next storefront/cron tick and is audited as `season.status_scheduled` rather than `season.status_changed`. This lets an actor disguise an immediate live-store flip as a pre-scheduled one, blurring the audit trail between deliberate and scheduled transitions. Both paths require `settings:manage`, so this is an audit-integrity issue, not a privilege escalation.

### M-2 — Customer-initiated repeat drafts have no actor attribution
`src/app/api/order/repeat/route.ts:51` calls `createRepeatDraft(db, parsed.data)` without `actorStaffId`. The resulting audit log (`order.repeat_review_confirmed`, `src/domain/repeat-orders.ts:328-341`) records `actorStaffId: null` and only the `sourceOrderId`/`sourceVersion` — it never records the acting customer identity (clerk user id or customerId). A customer-driven repeat draft is therefore not attributable to the customer who triggered it. Integrity/audit gap.

### M-3 — Bulk repeat bypasses per-line replacement/recipient confirmation
`src/domain/repeat-orders.ts:346-394` — `repeatOrdersInBulk` auto-accepts `mappedProductId` and the original `recipientAddressId` for every line and creates drafts with no human confirmation of replacements or recipients. P10 EXPECTED (UR-007, G-011, G-012) requires confirming replacements AND recipients; the single-order path enforces this via the review page, but the bulk path silently skips it. Staff-initiated (`orders:manage`), so this is an integrity/process gap rather than a privilege issue, but it means N customer drafts can be created without the per-recipient confirmation the phase mandates.

### L-1 — State-changing cron endpoint exposed as GET
`src/app/api/cron/season-status/route.ts:5` — the endpoint mutates season state and writes audit logs but is a GET. The required `Authorization: Bearer <CRON_SECRET>` header mitigates browser CSRF (custom header forces preflight), but a state-mutating GET violates safe-method semantics and is fragile to any future proxy/intermediate that strips headers or caches the response.

### L-2 — `assertReplacementMapping` runs outside the update transaction
`src/app/api/admin/catalog/route.ts:100-114` — the replacement cycle/sanity check runs against `db` before the `$transaction` that performs the `updateMany`. Between the check and the commit, another concurrent edit could alter the replacement graph and introduce a cycle. Requires two concurrent manager edits, so impact is low, but the validation is not atomic with the write.

### L-3 — `assertReplacementMapping` does not require the replacement product to be active
`src/domain/repeat-orders.ts:58-97` — the assert validates kind, later-season, and cycle, but not `replacement.isActive`. A manager can map a product to an inactive replacement; `resolveReplacementChain` then returns null at the end (`product.isActive ? product.id : null`), silently breaking the chain. Data-integrity gap, not a security bypass.

### L-4 — No rate limiting on customer repeat endpoint
`src/app/api/order/repeat/route.ts` — a signed-in customer can spam POST to create unbounded draft orders (each with a random `draftReference`). No rate limit or per-customer draft cap. Low impact (drafts are cheap, no payment), but enables DB/audit row flooding.

### L-5 — Replacement chain resolution is N+1 per line
`src/domain/repeat-orders.ts:22-56` — `resolveReplacementChain` issues one `findUnique` per hop, and `getRepeatReview` awaits it per source line serially (`Promise.all` over lines, but each line's chain is sequential). A deep chain or large order amplifies DB load on the customer repeat-review read path. DoS-surface, low.

### I-1 — Duplicate-season-year not prevented
`src/domain/seasons.ts:134-168` — `createSeasonFromTemplate` validates year > template year but does not check for an existing season with the same year. A manager can create multiple seasons for one year. Data-integrity only.

### I-2 — Staff repeat route has no target-season OPEN guard
`src/app/api/admin/orders/[orderId]/repeat/route.ts` — unlike the customer route, the staff repeat route does not verify the target season is OPEN before creating a draft. Likely intentional (staff may repeat into a closed season for admin reasons), noted for completeness.

## Out of scope (noted, not scored)

- Customer `recipientAddressId` ownership is correctly enforced inside `createRepeatDraft` (`customerId: review.sourceOrder.customerId` filter) — no IDOR.
- Prices are server-derived from `product.priceCents` + option adjustment — no client price tampering.
- `createRepeatDraft` validates chosen product belongs to the target season, is active, and matches the source line kind — no cross-season/kind injection.
- Cron secret comparison uses `timingSafeEqual` with a length guard — no timing leak.
- Source-order optimistic-concurrency (`version`) is checked in `createRepeatDraft`.
