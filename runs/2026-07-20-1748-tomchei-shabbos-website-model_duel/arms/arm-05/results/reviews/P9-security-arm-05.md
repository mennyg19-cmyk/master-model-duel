# P9 Security Review — arm-05 (blind)

Scope: P9 delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling. Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 3 |
| Medium | 7 |
| Low | 4 |
| **Total** | **14** |

## High

### H1 — Cron bearer auth uses non-constant-time string comparison

- **Location:** `lib/cron-auth.ts:5`
- **Claim:** `authorizeCron` compares `request.headers.get("authorization")` to `` `Bearer ${secret}` `` with `!==`, leaking timing information that can recover `CRON_SECRET` byte-by-byte.
- **Evidence:** `if (!secret || request.headers.get("authorization") !== \`Bearer ${secret}\`)` — direct string inequality. `lib/delivery.ts` already imports `timingSafeEqual` for PIN checks; the cron path does not. Both pickup-expiry and payment-reminders crons depend on this gate (`app/api/cron/pickup-expiry/route.ts:6`, `app/api/cron/payment-reminders/route.ts:6`). Smoke S5 only asserts `missingBearer.status === 401` and a valid-bearer 200 — it never tests timing.

### H2 — Pickup stamp IDOR: no PICKUP fulfillment-method check

- **Location:** `lib/delivery.ts:424` `stampPickedUp`
- **Claim:** Any package with `pickupReadyAt` set can be stamped `PICKED_UP` regardless of its fulfillment method; the function never verifies `fulfillmentMethod.code === "PICKUP"`.
- **Evidence:** `stampPickedUp` only checks `if (!packageRecord.pickupReadyAt || packageRecord.status === "SENT")`. Contrast `markPickupReady` (line 401) which calls `pickupEligibility` (line 393) that explicitly asserts `fulfillmentMethod.code === "PICKUP"`. The schema (`prisma/schema.prisma:378`) allows `pickupReadyAt` on any package, so a DELIVERY/SHIP package with a stray `pickupReadyAt` value can be marked picked up. Exposed via `POST /api/admin/delivery` action `stamp_pickup` (`app/api/admin/delivery/route.ts:55`), reachable by any STAFF with `orders.write`.

### H3 — Pickup stamp IDOR: no pickup-location or door-list scoping

- **Location:** `lib/delivery.ts:416` `pickupDoorList`, `lib/delivery.ts:424` `stampPickedUp`, `app/api/admin/delivery/route.ts:30-32,55`
- **Claim:** `stampPickedUp` accepts any `packageId` from the request body with no ownership/location scoping; `pickupDoorList` returns every ready package across all pickup locations.
- **Evidence:** `pickupDoorList` filters only by `pickupReadyAt: { not: null }, pickupExpiresAt: { gt: new Date() }, status: { not: "PICKED_UP" }` — no `pickupLocationId` filter. `stampPickedUp` does `prisma.package.findUniqueOrThrow({ where: { id: packageId } })` with no scope predicate. A staff member at location A can mark a package routed to location B as picked up. The plan §P9 calls for "door list with picked-up stamp" — implicit per-location scope is missing. Recipient names and customer records are returned to any `orders.read` caller via the door-list GET.

## Medium

### M1 — PIN transmitted in URL query string on GET

- **Location:** `app/api/driver/[token]/route.ts:15`
- **Claim:** The optional route PIN is read from `searchParams.get("pin")` and echoed through the driver page (`app/driver/[token]/page.tsx:19`), placing the PIN in server access logs, browser history, and any Referer header.
- **Evidence:** `readDriverRoute(token, new URL(request.url).searchParams.get("pin") ?? undefined)`. The client builds `` `/api/driver/${token}?pin=${encodeURIComponent(pin)}` `` for the GET. POST sends the PIN in the body — inconsistent and leaks the secret on the read path.

### M2 — No audit trail for failed PIN attempts or throttle events

- **Location:** `lib/delivery.ts:118` `loadDriverLink`
- **Claim:** Failed PIN attempts increment `failedAttempts` and set `throttledUntil`, but no `auditEvent` or `packageAudit` row is written; brute-force attempts are invisible in the audit log.
- **Evidence:** The failure branch (lines 130-139) updates `failedAttempts`/`throttledUntil` only. The success branch resets them. No `prisma.auditEvent.create` anywhere in `loadDriverLink`. The plan §P9 risk note calls for "audit use" of magic links; throttle events are part of that.

### M3 — Magic-link TTL is 14 days for non-completed routes

- **Location:** `lib/delivery.ts:8` `MAGIC_LINK_TTL_MS`, `lib/delivery.ts:180` `expiresAt`
- **Claim:** A DRAFT/ACTIVE route link stays valid for 14 days regardless of activity, exceeding the plan's "expires on route completion (optional short grace)" intent.
- **Evidence:** `const MAGIC_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1_000;` and `expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS)`. Expiry is only shortened to `new Date()` when the last stop is delivered (line 287). A leaked DRAFT link remains live for two weeks.

### M4 — Method-switch audit does not record the preserved charge or label-void ID

- **Location:** `lib/delivery.ts:310-321` `switchPackageMethod`
- **Claim:** The `delivery.method_switched` audit row stores the literal string `"checkout_snapshot_unchanged"` instead of the actual preserved customer charge in cents, and omits the voided label ID.
- **Evidence:** `details: { from, to, preservedCustomerChargeCents: packageRecord.orderId ? "checkout_snapshot_unchanged" : null }`. The plan §P9 requires "charge preserved + who/when audit" — the audit proves who/when but not the preserved amount. `voidPackageLabel` (`lib/shipping.ts:309`) writes its own `shipping.label_voided` audit with the label ID, but the method-switch row does not link to it.

### M5 — Reroute can add stops to a COMPLETED route

- **Location:** `lib/delivery.ts:326` `nearbyShippingPackages`, `lib/delivery.ts:351` `confirmReroute`
- **Claim:** Neither function checks `route.status`; a manager can confirm a reroute onto a route that is already `COMPLETED`, adding a new stop after completion.
- **Evidence:** `nearbyShippingPackages` does `prisma.deliveryRoute.findUniqueOrThrow({ where: { id: routeId }, include: { stops: ... } })` — no `status` predicate. `confirmReroute` calls it, then `switchPackageMethod`, then `transaction.deliveryRouteStop.create({ data: { routeId, packageId, sequence: sequence + 1 } })` — no status guard. Schema has no constraint preventing stops on a COMPLETED route.

### M6 — Label void + method switch + stop creation is not atomic

- **Location:** `lib/delivery.ts:299-323` `switchPackageMethod`, `lib/delivery.ts:351-363` `confirmReroute`
- **Claim:** `voidPackageLabel` runs outside the method-switch transaction; if the subsequent `$transaction` fails, the Shippo label is voided but the package remains on SHIP.
- **Evidence:** In `switchPackageMethod`, `await voidPackageLabel(packageId, actorId)` (line 300) executes before `prisma.$transaction(async (transaction) => { ... })` (line 305). `voidPackageLabel` itself commits its own `$transaction` (`lib/shipping.ts:315`). No compensating action or saga step. `confirmReroute` compounds this: it calls `nearbyShippingPackages` → `switchPackageMethod` → a separate stop-creation transaction (line 357), three independent commits.

### M7 — Driver GET response carries no `Cache-Control: no-store`

- **Location:** `app/api/driver/[token]/route.ts:12-19`
- **Claim:** The driver route response returns recipient name, full address label, and greeting (PII) with no cache-control header, allowing browser/proxy caching of stop PII on a shared device.
- **Evidence:** `GET` returns `NextResponse.json(await readDriverRoute(...))` with no headers. `readDriverRoute` (`lib/delivery.ts:231-245`) returns `recipientName`, `address` (joined line1/line2/city/state/postal), `greeting`, and `mapUrl` (encoded address). The plan §P9 risk note calls for "minimize stop data"; the data is necessary for delivery, but caching it on a borrowed phone is avoidable.

## Low

### L1 — Single shared `CRON_SECRET` across all crons

- **Location:** `lib/cron-auth.ts:4`
- **Claim:** Both P9 crons share one `CRON_SECRET`; compromise of any one caller's environment leaks a secret valid for every cron.
- **Evidence:** `process.env.CRON_SECRET` is the only secret. No per-cron rotation. P11 will add more crons on the same secret.

### L2 — `DeliveryNotification` has no retention or purge path

- **Location:** `lib/delivery.ts:95` `captureNotification`, `prisma/schema.prisma:435` `DeliveryNotification`
- **Claim:** PII-bearing notification records (customerId, packageId, payload) are retained indefinitely; the P11 email-log purge cron (R-172) targets email logs, not this table.
- **Evidence:** No `deleteMany` or purge job touches `DeliveryNotification` anywhere in `lib/delivery.ts` or the cron routes. The plan's retention open question (Q6) is unresolved for this table.

### L3 — `reassignRoute` does not validate the driver's role

- **Location:** `lib/delivery.ts:204` `reassignRoute`
- **Claim:** Any staff ID (including MANAGER or STAFF) can be assigned as a route driver; no check that `driverId` resolves to a `DRIVER`-role staff member.
- **Evidence:** `prisma.deliveryRoute.update({ where: { id: routeId }, data: { driverId } })` — no role lookup. The plan separates DRIVER from STAFF/MANAGER (UR-012); assigning a non-driver to a route is allowed silently.

### L4 — Fixture geocode makes the reroute proximity gate always-true

- **Location:** `lib/delivery.ts:43` `fixtureCoordinates`, `lib/delivery.ts:86` `isWithinHalfMile`
- **Claim:** Without Mapbox configured, every shipping package hashes to coordinates within ~0.0001° of every route stop, so `isWithinHalfMile` returns true for all candidates; the proximity filter is non-functional.
- **Evidence:** `fixtureCoordinates` returns `40.68 + digest[0]/10_000` and `-73.99 + digest[1]/10_000` — a ~0.01° band. `nearbyShippingPackages` falls back to this when no stored/cache hit. Not exploitable because manager confirmation is still required (M5 aside), but the "nearby" eligibility check is effectively a no-op in fixture mode, which the smoke (S3) does not distinguish from real geocoding.
