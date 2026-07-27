# P9 Quality Review — arm-05 (blind)

Reviewer specialist: Quality
Phase: P9 — Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling
Scope: route builder, magic-link lifecycle, method switch + label void, reroute confirm, pickup eligibility, bulk notify, EXPECTED S1–S5.
Evidence: `arms/arm-05/workspace/` (lib/delivery.ts, app/api/driver/[token]/, app/api/admin/delivery/, app/api/cron/*, app/admin/delivery/page.tsx, scripts/smoke-p9.ts, prisma/schema.prisma) and `.scratch/PHASE-P9-STATUS.md` + `.scratch/PHASE-P9-SMOKE.md`.

Findings only — no fixes.

## Counts

- Critical: 0
- High: 3
- Medium: 5
- Low: 5
- Info: 3

## Critical

(none)

## High

### H1 — Mapbox not wired; geocoder is a fixture

- Location: `lib/delivery.ts` lines 43–84 (`fixtureCoordinates`, `geocodeAddress`); `app/admin/delivery/page.tsx` (no map UI).
- Claim: Plan § P9 #1 requires a Mapbox route builder from delivery packages with geocode + cache (R-074, R-179, G-030 admin map). The implementation never calls Mapbox. `geocodeAddress` returns `fixtureCoordinates` (deterministic fake lat/lng derived from a SHA-256 digest) and persists `provider: "fixture"` into the `GeocodeCache`. There is no admin map UI in `app/admin/delivery/page.tsx` — only a form, a routes list, and print links.
- Evidence: `fixtureCoordinates` returns `40.68 + digest[0]/10000` / `-73.99 + digest[1]/10000` (lib/delivery.ts:43–49). `geocodeAddress` falls back to it whenever no stored lat/lng and no cache hit (lib/delivery.ts:58–60). Grep for `mapbox|Mapbox` across the workspace returns no matches. The phase status note says "local geocode caching" but the provider is literally `fixture`. EXPECTED S2 only verifies Google Maps destination encoding (a URL string), so the smoke passes without Mapbox; the admin map requirement is unmet.

### H2 — `expirePickupPackages` does not change package status; no unclaimed report

- Location: `lib/delivery.ts` lines 433–440 (`expirePickupPackages`); `app/api/cron/pickup-expiry/route.ts`.
- Claim: Plan § P9 #4 requires "unclaimed-pickup report" and a pickup-expiry cron. EXPECTED S5 checks "unclaimed/expiry". The cron handler calls `expirePickupPackages`, which selects overdue packages and writes `packageAudit` rows with `action: "pickup.expired"` — but never updates `Package.status` or `pickupExpiresAt`. Expired packages keep their pre-expiry status (New/Printed/Packed) and simply vanish from `pickupDoorList` because that query filters `pickupExpiresAt: { gt: new Date() }` (lib/delivery.ts:418). There is no function or endpoint that returns unclaimed/expired packages for staff review.
- Evidence: `expirePickupPackages` body: `findMany` + `packageAudit.createMany` + `return overdue.length` (lib/delivery.ts:433–440). No `prisma.package.update`. `pickupDoorList` excludes both picked-up and expired (lib/delivery.ts:416–422). The smoke only asserts `expirePickupPackages() >= 1` (scripts/smoke-p9.ts:119) — it counts overdue rows, not status transitions or a report.

### H3 — `confirmReroute` is not atomic with `switchPackageMethod`

- Location: `lib/delivery.ts` lines 351–363 (`confirmReroute`); 292–324 (`switchPackageMethod`).
- Claim: Plan § P9 #3 requires reroute to void the printed-not-shipped label (via P8), add to route, and update print batch. `confirmReroute` calls `switchPackageMethod(packageId, "DELIVERY", actorId)` — which runs its own `$transaction` (void label + update method + audit) — and then opens a *second* `$transaction` to create the `DeliveryRouteStop` and audit. If the second transaction fails, the label is voided and the method switched but the package is not on the route: an orphaned state with no compensating action.
- Evidence: `switchPackageMethod` ends with `return prisma.$transaction(async (transaction) => { ... })` (lib/delivery.ts:305–323). `confirmReroute` then calls `prisma.$transaction(async (transaction) => { ... })` separately (lib/delivery.ts:357–362). The stop creation re-runs `nearbyShippingPackages` (lib/delivery.ts:352) for validation but does not lock the package row between the two transactions.

## Medium

### M1 — No route admin detail (JSON) endpoint

- Location: `app/api/admin/delivery/[routeId]/route.ts` lines 10–25 (GET handler).
- Claim: Plan § P9 #1 requires "route admin list/detail/reassign/print". List (`listRoutes`), reassign (`reassignRoute`), and print (`routePdf`) are present. Detail is not — the GET on `/api/admin/delivery/[routeId]` always returns a PDF (or 404), never a JSON view of the route. There is no admin UI screen that shows a single route's stops, driver, and status.
- Evidence: GET handler builds `routePdf` and returns it with `content-type: application/pdf` (app/api/admin/delivery/[routeId]/route.ts:14–21). No JSON branch. `app/admin/delivery/page.tsx` lists routes but has no detail view, reassignment UI, or per-route stop table — only print links.

### M2 — Follow-up call-center filters (R-079) missing

- Location: `lib/delivery.ts` (no follow-up function); `app/api/admin/delivery/route.ts` (no follow-up action).
- Claim: Plan § P9 #5 requires "follow-up call-center with filters (R-079)". No code in `lib/delivery.ts`, `lib/admin-operations.ts`, or any admin route references follow-up, call-center, or contact-attempts filtering. Grep for `follow-up|followUp|call.?center|unclaimed` across `lib/` returns no matches.
- Evidence: `lib/delivery.ts` exports: `createRoute`, `listRoutes`, `reassignRoute`, `routePrintDocument`, `routePdf`, `readDriverRoute`, `startDriverRoute`, `deliverDriverStop`, `switchPackageMethod`, `nearbyShippingPackages`, `confirmReroute`, `scheduleBulkDelivery`, `pickupEligibility`, `markPickupReady`, `pickupDoorList`, `stampPickedUp`, `expirePickupPackages`, `sendPaymentReminders`. No follow-up/call-center function. EXPECTED #5 lists "follow-up call-center filters"; not exercised by smoke and not present in code.

### M3 — Magic-link grace period not implemented

- Location: `lib/delivery.ts` lines 283–289 (completion branch of `deliverDriverStop`).
- Claim: Plan § P9 #2 says the magic link "expires on route completion (optional short grace)". Open question 3 proposes a 2-hour default, manager-configurable. The code sets `expiresAt: new Date()` immediately when the last stop is delivered — no grace, no manager setting, no configurability.
- Evidence: `deliverDriverStop` completion block: `prisma.driverRouteLink.update({ where: { id: link.id }, data: { expiresAt: new Date() } })` (lib/delivery.ts:287). `MAGIC_LINK_TTL_MS` is a 14-day creation TTL (lib/delivery.ts:8); no constant for grace. `loadDriverLink` rejects when `link.expiresAt <= new Date()` (lib/delivery.ts:123).

### M4 — `pickupDoorList` excludes picked-up packages; "stamp" removes the row instead of marking it

- Location: `lib/delivery.ts` lines 416–422 (`pickupDoorList`); 424–431 (`stampPickedUp`).
- Claim: EXPECTED #4 says "door list + picked-up stamp". The door list query filters `status: { not: "PICKED_UP" }`, so once `stampPickedUp` sets status to `PICKED_UP`, the package disappears from the door list. There is no view that shows the stamp alongside the door-list row (e.g., a "picked up at" column on the same list). The semantics read as "open pickups only" rather than "door list with stamps".
- Evidence: `pickupDoorList` where clause: `pickupReadyAt: { not: null }, pickupExpiresAt: { gt: new Date() }, status: { not: "PICKED_UP" }` (lib/delivery.ts:418). `stampPickedUp` sets `status: "PICKED_UP"` (lib/delivery.ts:428). No separate "all pickups with stamps" view is exported.

### M5 — `sendPaymentReminders` dedupe key is per order, not per schedule

- Location: `lib/delivery.ts` lines 442–455 (`sendPaymentReminders`).
- Claim: The dedupe key is `payment-reminder:${schedule.orderId}` — one reminder per order ever. If staff reschedule a bulk delivery (creating a second `BulkDeliverySchedule` row for the same order) the second schedule never triggers a reminder because the dedupe key collides with the first. R-080 implies a recurring reminder cron; the current key makes reminders one-shot per order and immune to rescheduling.
- Evidence: `captureNotification({ ..., dedupeKey: \`payment-reminder:${schedule.orderId}\` ... })` (lib/delivery.ts:451). `BulkDeliverySchedule` has no unique constraint on `orderId` (schema.prisma:450–462), so multiple schedules per order are allowed at the data layer but silently de-duplicated at the notification layer.

## Low

### L1 — `switchPackageMethod` audit records a placeholder, not the preserved charge

- Location: `lib/delivery.ts` lines 310–321.
- Claim: Plan § P9 #3 requires "charge preserved + who/when audit". The audit `details.preservedCustomerChargeCents` is set to the literal string `"checkout_snapshot_unchanged"` when `orderId` is present, or `null` otherwise. The actual preserved amount (e.g., the order's `fulfillmentCents` or the package's rate snapshot) is never read or recorded, so the audit cannot prove *what* was preserved — only that the snapshot was left alone.
- Evidence: `preservedCustomerChargeCents: packageRecord.orderId ? "checkout_snapshot_unchanged" : null` (lib/delivery.ts:318). The `packageRecord` include does not pull `order` (lib/delivery.ts:293–296), so no charge amount is available to log.

### L2 — `pickupEligibility` only inspects the first inventory row

- Location: `lib/delivery.ts` lines 385–398.
- Claim: `pickupEligibility` reads `line.orderLine.product.inventoryItems[0]` and checks `quantityOnHand - quantityReserved >= line.quantity`. If a product has multiple `InventoryItem` rows (e.g., multiple lots/locations), only the first is considered. A package can be marked eligible when the first row has stock but the aggregate does not, or ineligible when the first row is empty but other rows cover the line.
- Evidence: `const inventory = line.orderLine.product.inventoryItems[0];` (lib/delivery.ts:395). No sum across `inventoryItems`.

### L3 — `startDriverRoute` has no state-machine guard

- Location: `lib/delivery.ts` lines 247–263.
- Claim: `startDriverRoute` unconditionally sets `status: "ACTIVE"` and `startedAt: link.route.startedAt ?? new Date()`. There is no check that the current status is `DRAFT` (or `ACTIVE` for a re-start). Calling start on a `COMPLETED` route would re-activate it (the completion branch in `deliverDriverStop` sets `expiresAt: now()`, but `loadDriverLink` would already reject an expired link, so this is hard to hit in practice — still, the lib function lacks the guard).
- Evidence: `startDriverRoute` body has no `where: { status: ... }` guard (lib/delivery.ts:249–253). The day-of notification is idempotent via dedupeKey, so repeated starts are no-op notifications, but the status transition is unguarded.

### L4 — `expirePickupPackages` audit `details: {}` is empty

- Location: `lib/delivery.ts` lines 433–440.
- Claim: The expiry audit row is written with `action: "pickup.expired"` and `details: {}`. `PackageAudit.actorId` is optional and left null (system-initiated) — acceptable — but the empty `details` loses the reason and the expiry timestamp that `pickupExpiresAt` carried. The audit cannot answer "when did this expire?" without re-reading the package row.
- Evidence: `data: overdue.map((packageRecord) => ({ packageId: packageRecord.id, action: "pickup.expired", details: {} }))` (lib/delivery.ts:435–437).

### L5 — `nearbyShippingPackages` "same street" is exact `line1` equality, not a cluster

- Location: `lib/delivery.ts` lines 341–343.
- Claim: Plan § P9 #3 says "same street cluster". The implementation treats "same street" as `address.line1 === candidate.address!.line1 && city === city && state === state` — exact house-number-and-street match. A package at "10 Route Street" and a route stop at "10 Route Street" match; "10 Route Street" and "12 Route Street" do not, even though they are on the same street. The half-mile haversine branch (lib/delivery.ts:86–93) compensates for nearby-but-different addresses, but the explicit "same street cluster" requirement is not implemented as a cluster.
- Evidence: `isSameStreet = routeAddresses.some((address) => address.line1 === candidate.address!.line1 && address.city === candidate.address!.city && address.state === candidate.address!.state)` (lib/delivery.ts:341–343).

## Info

### I1 — `captureNotification` upsert is a no-op on duplicate dedupeKey

- Location: `lib/delivery.ts` lines 95–108.
- Claim: `captureNotification` uses `upsert` with `update: {}`. On a duplicate dedupeKey the existing row is kept and the new payload is discarded. This is correct for idempotency (the first capture wins), but means a retried notification with a corrected payload will be silently ignored. Acceptable for the test-capture channel; worth noting if real channels are wired in P11.
- Evidence: `update: {}` (lib/delivery.ts:106).

### I2 — `scheduleBulkDelivery` allows multiple schedules per order with no audit row

- Location: `lib/delivery.ts` lines 365–383.
- Claim: Each call creates a new `BulkDeliverySchedule` row and fires fresh notifications (dedupeKey includes `schedule.id`). There is no check for an existing schedule on the same order, and no `auditEvent` row is written for the scheduling action. Rescheduling is silent at the audit layer.
- Evidence: `prisma.bulkDeliverySchedule.create({ data: { orderId, deliveryDate, window, scheduledById: actorId } })` (lib/delivery.ts:372). No `auditEvent.create` in this function.

### I3 — Driver page PIN input has no submit-on-Enter; only the "Open stops" button submits

- Location: `app/driver/[token]/page.tsx` lines 43–44.
- Claim: The PIN `<input>` has no `onKeyDown` / form submit binding; the user must click "Open stops". Minor mobile UX gap on a phone-viewport page (the primary target for magic links).
- Evidence: `<label>Route PIN (if provided)<input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value)} /></label>` and a separate `<button onClick={() => void load()}>Open stops</button>` (app/driver/[token]/page.tsx:43–44). No `<form>` wrapping the PIN input.
