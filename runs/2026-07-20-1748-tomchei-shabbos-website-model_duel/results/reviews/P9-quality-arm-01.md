# Reviewer specialist — Quality

**Arm:** `arm-01`
**Tree / phase:** P9 (Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling)
**Output:** `results/reviews/P9-quality-arm-01.md`
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P9-EXPECTED.md`. Blind to model name. Findings only, no fixes.

Evidence reviewed: `src/domain/delivery.ts`, `src/domain/delivery-notifications.ts`, `src/app/api/admin/delivery/route.ts`, `src/app/api/driver/routes/[token]/route.ts`, `src/app/api/cron/pickup-expiry/route.ts`, `src/app/api/cron/payment-reminders/route.ts`, `src/lib/cron-auth.ts`, `src/app/(admin)/admin/delivery/page.tsx`, `src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx`, `src/app/(driver)/driver/routes/[token]/page.tsx`, `src/components/delivery-operations.tsx`, `src/components/driver-route.tsx`, `prisma/schema.prisma`, both P9 migrations, `scripts/p9-smoke.ts`, `.scratch/PHASE-P9-SMOKE.md`, `.scratch/PHASE-P9-STATUS.md`.

Smoke S1–S5 PASS and `npm run ci` PASS are corroborated by `.scratch/PHASE-P9-SMOKE.md`. Findings below are issues the smoke did not catch.

## Findings

### HIGH

#### H1 — Expired pickups can still be stamped `PICKED_UP`
`stampPickup` (`src/domain/delivery.ts:533`) only checks `pickupReadyAt`; it never checks `pickupExpiredAt`. After `expireUnclaimedPickups` sets `pickupExpiredAt`, staff can still tap "Picked up" in the door list (`src/components/delivery-operations.tsx:202`) and move the package to `PICKED_UP`, silently overriding the expiry cron. EXPECTED S5 intends expiry to be terminal for unclaimed pickups. The smoke never stamps an expired package, so the gap is unexercised.

#### H2 — Driver `deliver` endpoint falsely reports "completed" on any post-deliver error
`src/app/api/driver/routes/[token]/route.ts:35-39` catches *any* throw from `accessDriverRoute` after a successful `markStopDelivered` and returns `{ completed: true }`. A PIN lockout, an expired link from a *different* cause, or a transient DB error all surface to the driver UI as "Route complete. This link is now expired." (`src/components/driver-route.tsx:40-44`), discarding the real error and hiding a still-open route. Only the true COMPLETED path should map to `completed: true`.

#### H3 — `confirmRouteReroute` does not check route status
`src/domain/delivery.ts:447` adds a stop and increments `printRevision` without verifying the route is still `PLANNED`/`IN_PROGRESS`. A reroute can be confirmed against a `COMPLETED` route, producing a new `PENDING` stop on a finished route and bumping `printRevision` after the printable manifest has already been issued. The nearby-suggestion list is also fetched unconditionally.

#### H4 — `markStopDelivered` has no row-level concurrency guard
`accessDriverRoute` (`src/domain/delivery.ts:195`) runs outside the delivery transaction and only updates `lastUsedAt`/`failedAttempts`; the stop update at `src/domain/delivery.ts:312` is an unconditional `update` with no `where: { id, status: "PENDING" }` guard. Two concurrent "Mark delivered" taps on the same stop both pass access, both write `status: "DELIVERED"`, both create a `DriverDeliveryAudit` row, and the second `remaining === 0` check can re-fire the COMPLETED transition. EXPECTED S1 requires "audit on every Delivered tap" — a double-tap produces a duplicate audit and can double-count toward completion.

### MEDIUM

#### M1 — `switchFulfillmentMethod` delivery→shipping orphans the `DeliveryStop`
`switchFulfillmentMethod` (`src/domain/delivery.ts:345`) changes `fulfillmentMethodId` and `groupingKey` but never removes an existing `DeliveryStop`. A delivery package already on a route, switched back to shipping via the API, leaves a `DeliveryStop` (with `packageId` unique) pointing at a now-shipping package; the route still lists it as a stop. The admin UI filters out `deliveryStop` packages from the switch list (`src/app/(admin)/admin/delivery/page.tsx:67`) so the surface is API-only, but the domain function itself is not invariant-preserving.

#### M2 — `markPickupReady` checks inventory but does not reserve it
`markPickupReady` (`src/domain/delivery.ts:505`) gates on `onHand - reserved >= quantity` per line but never increments `reserved`. Two pickup packages for the same `tracksInventory` product with `onHand = 1` both pass the eligibility check and both get a `pickup-ready` notification, over-promising a single unit. EXPECTED says "eligibility when inventory available" — eligibility is checked, but the eligibility is not made durable against concurrent ready-marks.

#### M3 — `accessDriverRoute` lockout check happens before PIN verification but resets on success only
Not a bug per se, but the lockout is bypassable in one path: when `lockedUntil` is set and a correct PIN is supplied, the function throws "Too many" before evaluating the PIN, so the lock is honored — however `failedAttempts` is not reset on a locked-out correct attempt, and `lastUsedAt` is not advanced. Combined with H4, a driver who locks mid-route cannot recover without a DB-side reset (the smoke itself does `prisma.driverMagicLink.update` to clear the lock at `scripts/p9-smoke.ts:299`), which is not exposed to operators.

### LOW

#### L1 — `findNearbyShippingPackages` capped at `take: 200`
`src/domain/delivery.ts:428` silently truncates the candidate set; eligible shipping packages beyond the first 200 (ordered by default) are never offered as reroute suggestions. No pagination, no warning to the operator.

#### L2 — `sendPaymentReminders` capped at `take: 500` and not season-scoped
`src/domain/delivery.ts:619` reminds the first 500 finalized unpaid/partial orders across all seasons. A large back-log can silently drop reminders for older or later orders, and closed seasons are not excluded.

#### L3 — `confirmRouteReroute` writes no route-level `AuditLog`
The reroute path writes a `PackageAudit` via `switchFulfillmentMethod` and bumps `printRevision`, but emits no `AuditLog` entry for the route-level mutation (contrast `createDeliveryRoute` and `reassignDeliveryRoute`, which do). The audit trail for "who added this stop to this route" is indirect only.

#### L4 — `markPickupReady` writes no `PackageAudit`
`stampPickup` and `expireUnclaimedPickups` both write `PackageAudit`; `markPickupReady` does not, so the "ready" transition is unattributed in the package audit history.

#### L5 — `switchFulfillmentMethod` grows `groupingKey` indefinitely
Each switch appends `:method:${Date.now()}` (`src/domain/delivery.ts:379`). Repeated switches lengthen the key without bound; harmless today but unbounded string growth on a unique key.

#### L6 — Print route page has no `@media print` styling
`src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx` only hides nav when `print=1`; there are no `@media print` rules, page-break hints, or per-stop card break controls beyond `break-inside-avoid` on each stop card. EXPECTED S2 calls for "printed fallback" — it renders, but is not print-optimized.

#### L7 — S2 smoke does not exercise "completable from printed fallback only"
EXPECTED S2: "same route completable from printed fallback only." `scripts/p9-smoke.ts:308-317` asserts the print HTML contains the stop list and greeting-card label and that the Google Maps URL encodes the address, but never drives a delivery from the printed fallback alone. The "printed fallback only" path is asserted by rendering, not by completion.

#### L8 — Cron routes do not record a `CronRun`
`src/app/api/cron/pickup-expiry/route.ts` and `src/app/api/cron/payment-reminders/route.ts` return counts only. The schema has a `CronRun` model for idempotent job tracking; P9 crons do not use it, so duplicate cron invocations within the same window are not deduplicated at the job level (only at the notification-upsert level for payment reminders, and not at all for pickup expiry beyond the `pickupExpiredAt: null` guard).

#### L9 — Admin delivery `GET` returns 409 for missing route
`src/app/api/admin/delivery/route.ts:69-73` maps every non-`AccessDeniedError` (including `findUniqueOrThrow`'s `P2025` for an unknown `routeId`) to 409. A missing route should be 404.

#### L10 — Driver API returns 401 for non-auth failures
`src/app/api/driver/routes/[token]/route.ts:42-47` returns 401 for expired links, wrong PIN, and validation errors alike. Expired/locked and malformed-body (400) states are indistinguishable from auth failure at the status-code level.

## Severity counts

- **High:** 4 (H1–H4)
- **Medium:** 3 (M1–M3)
- **Low:** 10 (L1–L10)
- **Total:** 17

No stubs found. No regressions vs P8 surface (admin layout nav, env, schema, migrations all consistent). Smoke S1–S5 and `npm run ci` pass per `.scratch/PHASE-P9-SMOKE.md`; the findings above are gaps the smoke does not cover.
