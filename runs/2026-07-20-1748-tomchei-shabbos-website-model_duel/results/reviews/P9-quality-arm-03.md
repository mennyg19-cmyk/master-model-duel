# P9 Quality Review — arm-03 (blind)

**Reviewer:** external quality specialist
**Phase:** P9 — Routes, driver magic links, reroute, pickup, bulk
**Date:** 2026-07-22
**Tree:** `arms/arm-03/workspace`
**Smoke:** 5/5 PASS (self-reported, `.scratch/PHASE-P9-SMOKE.md`)

## Summary

Smoke passes, but the phase ships significant API-only surface with no admin UI, plus several correctness gaps in the route/reroute/pickup flows. Findings are findings only — no fixes applied.

## Counts

| Severity | Count |
|---|---|
| Critical | 0 |
| Major | 6 |
| Minor | 11 |
| Smoke-weakness | 3 |
| **Total** | **20** |

## Major findings

### M1. `confirmReroute` skips route validation entirely
`src/lib/routes/service.ts` `confirmReroute` (lines 725-817) never loads the route. It validates the package and voids the label, then creates a `RouteStop` with `routeId: input.routeId` — no check that the route exists, belongs to the season, or is in a state that accepts new stops (DRAFT/ASSIGNED/IN_PROGRESS). Contrast with `suggestReroutes`, `printRoute`, `reassignRoute`, `issueMagicLink`, `markStopDeliveredFromPrint`, all of which call `getRouteDetail(seasonId, routeId)` or `findFirst({ where: { id, seasonId } })`. A manager can reroute a package onto a COMPLETED route, leaving the route COMPLETED with a PENDING stop that no magic link can deliver (link 410s). Cross-season reroute is also possible.

### M2. `confirmReroute` + label void is non-atomic
`voidLabelForPackage` runs its own transaction (commits the VOIDED status + audit), then `confirmReroute` opens a second transaction for the method switch + stop creation. If the second transaction fails (e.g., FK violation from M1), the SHIP label is already voided with no rollback path. The package is left SHIP-method with a voided label and no route stop.

### M3. `reassignRoute` does not revoke existing magic links
`src/lib/routes/service.ts` `reassignRoute` (lines 235-276) updates `driverStaffId` and optionally `pinHash`, but never touches `DriverMagicLink.revokedAt`. Reassigning a route from driver A to driver B leaves driver A's issued magic link fully functional — scoped to all stops, PIN-unlocked if A knew the PIN. The EXPECTED scopes magic links to "expires on completion"; reassignment is an implicit scope change and should revoke. This is a security gap, not just a hygiene issue.

### M4. `reassignRoute` produces inconsistent ASSIGNED-with-no-driver state
Reassigning to `driverStaffId: null` (unassign) only flips DRAFT→ASSIGNED when a driver is provided; it never reverts ASSIGNED→DRAFT on unassign. Result: a route with `driverStaffId: null` and `status: ASSIGNED`. There is also no API to remove a stop from a route, so a delivery package placed on a route is stuck there until delivered — `switchFulfillmentMethod` delivery→SHIP throws 409 ("Remove from route before switching to shipping") but no removal endpoint exists.

### M5. Day-of notification is unrecoverable if first `start` fails after route is marked IN_PROGRESS
`startRouteViaMagicLink` commits the route as `IN_PROGRESS` inside a transaction, then calls `sendDayOfNotifications` *outside* the transaction (line 441). If the notification step throws, the API returns 500 but the route stays IN_PROGRESS. On retry, the early-return guard `if (link.route.status === IN_PROGRESS || COMPLETED) return link.route;` (lines 411-415) skips `sendDayOfNotifications` entirely — `dayOfNotifiedAt` is never set, notifications are never sent, and there is no retry path. Idempotency at the outbox level does not help because the function is never re-entered.

### M6. No admin UI for pickup, bulk delivery, or route assignment
- `src/app/(admin)/admin/pickup/` — does not exist. Door list, stamp, unclaimed report, follow-up queue are API-only (`/api/admin/pickup`).
- `src/app/(admin)/admin/bulk-delivery/` — does not exist. Bulk scheduling is API-only.
- `src/components/admin/routes-admin.tsx` create form has no driver selector and sends no `driverStaffId`.
- `src/components/admin/route-detail.tsx` has no reassign button, no driver display, and no `print-deliver` button. Printed-fallback delivery (the EXPECTED's S2 flow) is reachable only via raw API.

The admin nav (`src/components/admin/shell.tsx` line 12) links only `/admin/routes`. Pickup and bulk are unreachable from the UI. The EXPECTED explicitly calls out "door list + picked-up stamp, unclaimed report" and "bulk delivery scheduling" as user-facing flows; they are backend stubs here.

## Minor findings

### m1. `runPaymentReminderCron` has dead code
`src/lib/pickup/bulk.ts` line 78: `if (order.paymentStatusCached === "PAID") continue;` — the query (lines 67-74) already filters `paymentStatusCached` to `UNPAID`/`PARTIAL`, so `PAID` never reaches the loop.

### m2. `suggestReroutes` has dead SENT guard
`src/lib/routes/service.ts` line 692: `if (pkg.stage === PackageStage.SENT) continue;` — the query (lines 670-674) already filters `stage: { in: [NEW, PRINTED, PACKED] }`, so SENT is excluded.

### m3. `orderInventoryAvailable` redundant condition
`src/lib/pickup/service.ts` line 23: `if (inv.onHand < inv.reserved && availableUnits(inv) < 0) return false;` — `availableUnits = onHand - reserved`, so `availableUnits < 0` is identical to `onHand < reserved`. The `&&` is tautological.

### m4. `requireCronBearer` uses non-constant-time comparison
`src/lib/cron/auth.ts` line 11: `match[1] !== secret` — string inequality short-circuits on first differing byte. Low risk for a cron secret, but a timing-safe compare (`crypto.timingSafeEqual`) is the standard.

### m5. `scheduleBulkDelivery` throws raw `Error` not `ApiError`
`src/lib/pickup/bulk.ts` line 134: `throw new Error("Some packages missing or not bulk delivery")` — surfaces as 500 instead of a 4xx. Other branches in the same module use `ApiError` with proper status codes.

### m6. `markStopDelivered` / `markStopDeliveredFromPrint` bypass the stage machine
Both set `stage: PackageStage.SENT` directly via `tx.package.update`, skipping `transitionPackage` and its `packageAuditLog` row. Every other stage transition in the codebase goes through `transitionPackage` (which writes both `PackageAuditLog` and `AuditLog`). The delivery path writes only `AuditLog`, so `PackageAuditLog` is incomplete for delivered packages.

### m7. BULK_DELIVERY stops are deliverable via magic link but skipped by day-of notification
`sendDayOfNotifications` (lines 463-465) filters `code !== "PER_PACKAGE_DELIVERY" && code !== "DELIVERY"`, skipping BULK_DELIVERY stops. But `createRouteFromPackages` accepts BULK_DELIVERY packages and `markStopDelivered` delivers any stop. A mixed route with a bulk stop will silently not send the day-of notification for that stop while still allowing the driver to mark it delivered.

### m8. `doorList` includes expired-but-not-picked-up packages
`src/lib/pickup/service.ts` `doorList` (lines 107-121) filters `pickupReadyAt: not null, pickedUpAt: null` but does not exclude `pickupExpiresAt < now`. Expired packages appear on both the door list and the unclaimed report simultaneously. Either intentional (staff can still hand them out) or a drift from the EXPECTED's separation of "door list" vs "unclaimed report".

### m9. `runPickupExpiryCron` never resolves the package
The cron captures `pickup-expired` notifications but does not update `Package.pickupExpiresAt`, `pickedUpAt`, `stage`, or any "expired" flag. The same package is re-queried on every cron run (notifications are idempotent so no double-send, but the package is never closed out).

### m10. `stubAssignLabelToRoute` is dead code
`src/lib/shipping/labels.ts` lines 332-338 — the stub is never called anywhere in the P9 flow. `isVoidable` checks `routeAssignedAt == null` but nothing ever sets it, so the guard is always true.

### m11. `stampPickedUp` multi-stage advance is non-atomic
`src/lib/pickup/service.ts` lines 144-154 advances NEW→PRINTED→PACKED→PICKED_UP via three separate `transitionPackage` transactions. If the second fails (concurrent edit / version mismatch), the package is left in PRINTED with no `PICKUP_STAMPED` audit (that audit is written after the loop). The `pickedUpAt` stamp is also written after the loop, so a partial failure leaves an intermediate stage with no stamp.

## Smoke-weakness findings

### s1. S1 manually clears the PIN lock mid-test
`scripts/smoke-p9.mjs` lines 189-192: after deliberately triggering the throttle, the test directly UPDATEs `driverMagicLink` to reset `pinFailCount` and `pinLockedUntil` before issuing the correct PIN. The "correct PIN after throttle window expires" path is therefore never exercised naturally; the lock is bypassed by DB mutation.

### s2. S5 self-patches its own broken assertion
`scripts/smoke-p9.mjs` lines 568-608: the S5 pass expression originally included `(door.json?.doorList || []).some((p) => p.id === pickup.pkg.id) === false`, which was wrong because `door` was fetched *after* `stamp` (so the package was already removed). The script then overwrites `s5.pass` (lines 595-608) with a re-evaluation that drops the door-list check entirely. The door-list-then-stamp sequence is never actually validated — the door list assertion is silently skipped.

### s3. S2 "complete via printed fallback only" is asserted only by API response
The EXPECTED S2 says "same route completable from printed fallback only." The smoke verifies `deliveredPrint.json?.ok` and `deliveredPrint.json?.completed`, but never verifies that the magic-link path was *not* used (e.g., no START_ROUTE / DELIVERED events on the route's magic links for route2). A route could pass S2 while still being magic-link-completable and the test would not catch it.

## Notes

- All five EXPECTED checklist items have backing API implementations; the gaps are in UI exposure, validation, and atomicity, not missing features.
- `writeAudit` calls for driver-initiated actions (`ROUTE_STARTED`, `ROUTE_COMPLETED`, `DRIVER_DELIVERED` via magic link) intentionally omit `actorId` and rely on `meta.magicLinkId` for attribution — this is correct given drivers are not staff users.
- Geocode cache (`GeocodeCache` table) and `geocodePackageAddress` are wired and deterministic; the "Mapbox route builder" claim in the EXPECTED is satisfied by a local deterministic geocoder, not actual Mapbox. Acceptable for P9 scope but worth flagging.
