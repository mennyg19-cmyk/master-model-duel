# Reviewer specialist — Quality

**Arm:** `arm-02`
**Tree / phase:** P9 (Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling)
**Output:** `results/reviews/P9-quality-arm-02.md`
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P9-EXPECTED.md`. Blind to model name. Findings only, no fixes.

Evidence reviewed: `lib/routes/links.ts`, `lib/routes/driver-access.ts`, `lib/routes/geo.ts`, `lib/routes/service.ts`, `lib/routes/print.ts`, `lib/pickup.ts`, `lib/cron.ts`, `lib/bulk-delivery.ts`, `lib/notifications.ts`, `lib/addresses/geocode.ts`, `lib/rate-limit.ts`, `lib/domain/package-stage.ts`, `app/api/admin/routes/route.ts`, `app/api/admin/routes/[id]/route.ts`, `app/api/admin/routes/[id]/link/route.ts`, `app/api/admin/routes/[id]/start/route.ts`, `app/api/admin/routes/[id]/reroute/route.ts`, `app/api/admin/routes/[id]/print/route.ts`, `app/api/admin/routes/[id]/stops/[stopId]/delivered/route.ts`, `app/api/admin/packages/[id]/method/route.ts`, `app/api/admin/bulk-delivery/route.ts`, `app/api/admin/pickup/ready/route.ts`, `app/api/admin/pickup/door-list/route.ts`, `app/api/cron/pickup-expiry/route.ts`, `app/api/cron/payment-reminders/route.ts`, `app/api/d/[token]/pin/route.ts`, `app/api/d/[token]/start/route.ts`, `app/api/d/[token]/stops/[stopId]/delivered/route.ts`, `app/(admin)/admin/routes/page.tsx`, `app/(admin)/admin/routes/[id]/page.tsx`, `app/(admin)/admin/pickup/page.tsx`, `app/(admin)/admin/follow-up/page.tsx`, `app/d/[token]/page.tsx`, `components/driver/route-client.tsx`, `components/admin/route-actions.tsx`, `components/admin/pickup-actions.tsx`, `components/admin/bulk-delivery-form.tsx`, `components/admin/route-map.tsx`, `prisma/schema.prisma`, `.scratch/PHASE-P9-SMOKE.md`, `.scratch/PHASE-P9-STATUS.md`.

Smoke S1–S5 (46/46 PASS) and `npm run ci` PASS are corroborated by `.scratch/PHASE-P9-SMOKE.md`. Findings below are issues the smoke did not catch.

## Findings

### HIGH

#### H1 — `createRouteLink` writes the PIN hash outside the transaction
`lib/routes/links.ts:50-67` runs the revoke-old + create-new link inside a `$transaction`, but the `pinHash` update is a separate, non-transactional `db.routeLink.update` afterward (`if (pin) { await db.routeLink.update(...) }`). The URL and token are returned to the manager regardless. If that second write fails (DB blip, network drop), the link exists with `pinHash: null` — i.e. no PIN required — while the manager already texted a 4-digit PIN to the driver. The route is then wide open to anyone who sees the URL. EXPECTED S1 requires an "optional PIN" as a security gate; a failed pinHash write silently disables it, and the smoke never exercises a pinHash-write failure.

#### H2 — `sendPickupReadyNotifications` marks ready before notifying, with no retry on throw
`lib/pickup.ts:59-73` stamps `pickupReadyAt` first, then calls `notifyCustomer`. `notifyCustomer` → `captureNotification` only swallows `P2002` (dedupe collision) and rethrows every other DB error. If the notification insert throws, the package is already `pickupReadyAt`-stamped, and the next sweep filters it out (`!entry.pickupReadyAt && !entry.pickupExpiredAt`), so the customer is never notified. The doc-comment claims "the dedupe key backstops a race," but a dedupe key only backstops a *re-run*; a thrown first run is lost, not retried. EXPECTED S5 wants "ready notification exactly once" — here it can be exactly zero.

#### H3 — `confirmReroute` stop-position race (no transaction around aggregate + insert)
`lib/routes/service.ts:402-411` reads `db.routeStop.aggregate({ _max: { position } })` and then creates the new stop in a separate, non-transactional call. Two concurrent reroutes onto the same route can both read the same max position and both insert at `max + 1`, producing two stops with the same `position` (the `@@index([routeId, position])` is non-unique). `buildRoute` correctly wraps its stop inserts in a `$transaction`; `confirmReroute` does not. The smoke only reroutes one package at a time, so the race is unexercised.

#### H4 — `requireCronAuth` compares the bearer secret with non-timing-safe `!==`
`lib/cron.ts:13` does `if (header !== \`Bearer ${env.CRON_SECRET}\`)`. The PIN path (`lib/routes/links.ts:103`) carefully uses `timingSafeEqual`; the cron bearer path does not. A timing attack on the cron endpoint can leak the secret byte-by-byte. EXPECTED S5 requires "bearer auth" for the crons; the auth is correct functionally but leaks the secret via timing, inconsistent with the PIN posture elsewhere.

### MEDIUM

#### M1 — `markStopDelivered` has no row-level concurrency guard on the stop
`lib/routes/service.ts:170-222` reads `stop.deliveredAt` inside the transaction, then updates with `tx.routeStop.update({ where: { id: stop.id }, data: { deliveredAt: new Date() } })` — the `where` does not include `deliveredAt: null`. Two concurrent "Delivered" taps on the same stop can both read `deliveredAt: null`, both write, and both create a `packageAudit` row. The `remaining === 0` count then runs in each transaction; both can observe zero remaining and both re-fire the COMPLETED transition + link-expiry `updateMany`. EXPECTED S1 requires "audit on every Delivered tap" — a double-tap duplicates the audit and can double-count completion.

#### M2 — `scheduleBulkDelivery` is not idempotent per scheduling intent
`lib/bulk-delivery.ts:37-57` creates a new `BulkDeliverySchedule` row (new id) on every call, and the dedupe key is `bulk|${schedule.id}|${customer.id}`. Clicking "Schedule + notify" twice with the same date/window notifies every affected customer twice — different `schedule.id` means different dedupe keys. EXPECTED S4 says "one email + SMS per customer"; that holds per schedule, but a double-click or a re-submit on timeout double-notifies the whole audience with no operator opt-out.

#### M3 — `startRoute` captures no day-of notification for BULK_DELIVERY routes
`lib/routes/service.ts:138-159` filters stops to `stop.package.fulfillmentMethod.kind === "PER_PACKAGE_DELIVERY"` before capturing day-of notifications. A route built from a `BULK_DELIVERY` method captures 0 notifications on start. Bulk customers are notified once at scheduling time, but if the schedule was created long before the route starts they get no day-of heads-up. EXPECTED S1/S4 say "route start notifies day-of once" / "route start → idempotent day-of notification"; the smoke only exercises this on a per-package route, so the bulk-route gap is unexercised.

#### M4 — `confirmReroute` appends the stop without re-ordering
`lib/routes/service.ts:403-411` always sets `position: (lastPosition._max.position ?? 0) + 1`, so the rerouted package becomes the last stop regardless of geography. The route's nearest-neighbor order — built in `buildRoute` via `nearestNeighborOrder` — is broken after a reroute; the printed route sheet (`renderRouteSheet`) and the driver stop list then show the rerouted stop last even when it is geographically mid-route. EXPECTED calls for "map reroute"; the map shows the point, but the driving order is wrong.

### LOW

#### L1 — `buildRoute` `maxStops` selects the N oldest, not the N nearest
`lib/routes/service.ts:62-63` applies `take: input.maxStops` to the candidate query ordered by `createdAt: asc` *before* `nearestNeighborOrder` runs. So `maxStops` caps by creation time, not by proximity to the warehouse. The name implies "the N nearest stops"; the semantic is "the N oldest undelivered packages."

#### L2 — `buildRoute` geocodes candidates sequentially
`lib/routes/service.ts:73-76` awaits `geocodeAddress` in a `for` loop. For a large route this is a serial round-trip per stop (Mapbox mode) or a serial DB upsert per stop (local mode). Could be parallelized; no `Promise.all`.

#### L3 — `RouteMap` `suggestion` kind is dead code
`components/admin/route-map.tsx:8,30,45` defines a `suggestion` kind and an orange color for it, but `app/(admin)/admin/routes/[id]/page.tsx:46-53` only ever passes `stop`/`delivered` points. Reroute suggestions are rendered as a separate HTML list, never as map points. The `suggestion` branch in `MapPoint` and `color.suggestion` are unused.

#### L4 — `renderRouteSheet` prints the full Google Maps URL as a size-7 line
`lib/routes/print.ts:77` pushes `Maps: ${googleMapsUrl(...)}` into the PDF at size 7. The URL is long and will wrap/overflow the letter page width. The deep link is meant for the phone (S2), not paper; the printed fallback should carry the address, not a 90-character URL.

#### L5 — `sendPickupReadyNotifications` and `expireOverduePickups` mutate per-package in a loop with no atomicity
`lib/pickup.ts:59-73` and `lib/pickup.ts:134-141` each run a `db.$transaction` per package inside the loop. A mid-loop failure leaves some packages mutated and others not, and `runCronJob` records the whole run as `failed`, but the partial mutation is not rolled back and not retried on the next sweep (the readied/expired stamps persist).

#### L6 — `startRoute` writes a new `AuditLog` row on every call
`lib/routes/service.ts:126-134` creates an `auditLog` entry unconditionally, even for an idempotent re-start that captures 0 notifications (the dedupe keys make the notifications a no-op, but the audit row is still written). Repeated starts spam the audit log with "route.started" rows that carry `notificationsCaptured: 0`.

#### L7 — `payment-reminders` cron sends EMAIL only, inconsistent channel posture
`app/api/cron/payment-reminders/route.ts:39-48` captures only `EMAIL` notifications. Every other P9 notification path (bulk, pickup-ready, day-of) uses `notifyCustomer`, which sends email + SMS when a phone is on file. EXPECTED does not mandate SMS for reminders, but the channel policy is inconsistent across P9 — a customer with a phone gets an SMS for "your package is ready" but only an email for "you still owe money."

## Severity counts

- HIGH: 4 (H1–H4)
- MEDIUM: 4 (M1–M4)
- LOW: 7 (L1–L7)
- Total: 15 findings
