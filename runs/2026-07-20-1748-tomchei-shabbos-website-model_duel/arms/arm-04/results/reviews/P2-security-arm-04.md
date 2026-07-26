# P2 Security Review — arm-04 (blind)

**Phase:** P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine
**Scope:** P2 delta + regressions in `arms/arm-04/workspace/`. No fixes, no new scope.
**Reviewer:** External security specialist
**Date:** 2026-07-26

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 3 |

P2 ships schema and engine only (no routes), so most trust-boundary enforcement is deferred to the route layer. The findings below are about gaps the engine itself leaves open, plus one stock-integrity design choice that will bite later phases if not addressed before P5/P7.

## Findings

### MAJOR-1 — Order engine has no authorization or ownership primitive

**File:** `src/lib/orders/order-service.ts:37-159` (`finalizeOrder`, `transitionOrder`, `discardDraft`)

`finalizeOrder(orderId, actor = null)` and `transitionOrder(orderId, to, actor = null)` accept any `orderId` and operate. The `actor` parameter defaults to `null`, which `recordAudit` records as `"system"` (`src/lib/audit.ts:17`). There is no check that the calling user owns the order (`Order.customerId`) or that a staff member has `orders.manage`.

Consequences:
- A future route that forgets to pass the staff `AuditActor` will mutate order state and log it as `"system"` with no human accountability. The default-null makes the easy path the wrong path.
- IDOR protection (customer finalizing another customer's draft, staff cancelling an order they cannot see) must be added at every route that calls these functions in P4/P5/P6. The engine gives the route layer no help — no `assertOwnedBy(customerId)`, no `requirePermission`-shaped guard.

Recommend (P5 gate, not P2): drop the `actor = null` default on `transitionOrder` so the caller is forced to pass either a real `StaffContext` or an explicit `null` for a customer-initiated action. P2 is schema/engine; the gap is acceptable now, but the signature is the contract future phases will copy.

### MAJOR-2 — Inventory release on cancel has no per-order reservation record

**File:** `src/lib/inventory/reserve.ts:41-59`, `src/lib/orders/order-service.ts:207-212`, `prisma/schema/inventory.prisma:9-24`

`InventoryItem.reserved` is a single integer per product/add-on. `reserveUnits` increments it; `releaseUnits` decrements it. There is no `Reservation` table tying reserved units to the order that reserved them.

`releaseInventoryFor(tx, order.lines)` computes the release quantity from the order's *current* lines, not from a snapshot taken at finalize. In P2 this is safe because lines are immutable after finalize. The moment a later phase adds post-place line edits, quantity changes, or comp adjustments (P5 order edits, R-036), the release on cancel will over- or under-release against the shared counter, and the `InventoryItem_reserved_within_on_hand` CHECK constraint cannot detect it because the counter stays in range.

The state machine also permits `PLACED → CANCELLED` and `IN_FULFILLMENT → CANCELLED` (`src/lib/orders/state-machine.ts:14-21`). Once P7 advances packages past `PACKED`/`SENT`, releasing stock on cancel from `IN_FULFILLMENT` would put physical-into-a-box units back on the shelf. P2 has no fulfillment progress, so this is latent — but the schema has no `Reservation` row to reconcile against, so the fix is structural and cheaper to land now than after P7.

### MINOR-1 — `applyScheduledSeasonFlips` has no bearer-secret guard

**File:** `src/lib/seasons.ts:17-60`

Per R-185, all crons require bearer-secret auth. P2 ships the function with no auth check; it trusts the future route wrapper (P12). The function is exported from a `server-only` module and is callable from any server context. A later route that wires this up without a bearer check would let any unauthenticated request flip seasons open/closed. Acceptable for P2 (no route exists), but the function should at least document the required wrapper, or accept a `callerSecret` argument so the contract is explicit.

### MINOR-2 — `recordAudit` writes free-form `detail` JSON with no sanitization

**File:** `src/lib/audit.ts:23-40`, `prisma/schema/identity.prisma:84-103`

The schema comment on `AuditEvent.detail` says "Never store secrets or full payment data here." `recordAudit` passes `input.detail` through verbatim with no allow-list or redaction. Current callers (`order-service.ts`, `packages.ts`, `staff-service.ts`) write safe fields (`orderNumber`, `recipientName`, `totalCents`, `from`/`to`). `recipientName` is PII but appropriate for an internal audit log. The risk is a future caller writing a check number, Stripe intent id, or full payment reference into `detail`. No programmatic guard prevents it. A typed `AuditDetail` shape per action would close this.

### MINOR-3 — Engine service functions exported with no auth, callable on any id

**File:** `src/lib/fulfillment/packages.ts:16-56` (`advancePackageStage`), `src/lib/orders/payment-status.ts:17-36` (`recomputeOrderPaymentStatus`)

Same pattern as MAJOR-1. `advancePackageStage({ packageId, expectedVersion, stage })` accepts any `packageId` with no staff-permission check; the optimistic-version guard prevents stale writes but not unauthorized ones. `recomputeOrderPaymentStatus(orderId)` recomputes the cached payment status for any `orderId`. Both rely on the route layer to call `requirePermission('orders.manage')` first. Acceptable for P2 (no routes), but the package-stage advance is a staff-only operation per UR-001 and the engine signature gives no hint of that.

## Out of scope (noted, not counted)

- `linkCustomerIdentity` (`src/lib/customers.ts:14-51`) overwrites `externalAuthId` on normalized-email match without checking Clerk email-verification status. This is a P1 identity concern, not P2 delta.
- `client-error` endpoint rate limit is global, not per-IP (intentional per the comment — `x-forwarded-for` is forgeable). Not a P2 file.
- `health` endpoint leaks `authProvider` and `latencyMs` to unauthenticated callers. Low value, not a P2 delta.

## Trust boundary map (P2 delta)

| Boundary | Enforcement in P2 | Gap |
|---|---|---|
| Customer ↔ own order | None in engine | MAJOR-1 (deferred to P4/P5 routes) |
| Staff ↔ `orders.manage` | None in engine | MAJOR-1 (deferred to routes) |
| Cron ↔ bearer secret | None in `seasons.ts` | MINOR-1 (deferred to P12 route) |
| Audit detail ↔ secrets | None in `recordAudit` | MINOR-2 |
| Inventory ↔ per-order reservation | None in schema | MAJOR-2 (structural) |
| Package stage ↔ staff-only | None in `advancePackageStage` | MINOR-3 |

## Positive notes

- `reserveUnits` is a single conditional UPDATE with row lock + re-checked `onHand - reserved >= quantity` (`reserve.ts:24-38`); the race for the last unit is correctly closed. Smoke S5 confirms.
- `InventoryItem_single_target` and `InventoryItem_reserved_within_on_hand` CHECK constraints are hand-written in the migration (`migration.sql:652-655`) and tested (`inventory.test.ts:89-112`). The database itself rejects oversell even if the engine has a bug.
- `Order.version` optimistic concurrency + `updateMany` with `status` guard (`order-service.ts:66-73`, `:118-125`) prevents double-finalize and lost updates; smoke S4 confirms.
- `Season.nextOrderNumber` increment is inside the finalize transaction, so rollback returns the number (gapless); smoke S4 confirms 1..10 with no gaps.
- `signed-cookie.ts` uses HMAC-SHA256 with `timingSafeEqual` and rejects the placeholder secret at env validation (`env-spec.ts:26-30`). Not a P2 file but exercised by P2 seed.
- `request-ip.ts` only reads `x-forwarded-for` when `TRUST_PROXY_HEADERS=true`, preventing IP forgery in audit rows.
- `report-client-error` bounds body to 4KB, truncates fields, and rate-limits globally (the comment correctly notes per-IP would key on a forgeable header).
- `result.ts` keeps `cause` server-side and only `publicMessage` may reach the browser.
