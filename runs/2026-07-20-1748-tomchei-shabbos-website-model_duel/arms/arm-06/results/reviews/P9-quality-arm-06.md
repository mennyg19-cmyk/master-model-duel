# P9 Quality Review — arm-06 (blind)

**Phase:** P9 — Delivery routes, driver magic links, reroute, pickup, bulk
**Spec:** `shared/phases/PHASE-P9-EXPECTED.md`, `shared/MERGED-BUILD-PLAN.md` § P9
**Scope:** `arms/arm-06/workspace/` — `lib/routes/{builder,geo,optimize,links,lifecycle,reroute,switch,print,events}.ts`, `lib/pickup/readiness.ts`, `lib/bulk/schedule.ts`, `lib/notify/outbox.ts`, `lib/payments/reminders.ts`, `lib/admin/follow-ups.ts`, `lib/cron-auth.ts`, `app/(driver)/drive/[token]/{page,drive-app}.tsx`, `app/api/drive/[token]/{route,pin/start/deliver}/route.ts`, `app/api/admin/routes/**`, `app/api/admin/pickup/**`, `app/api/admin/bulk-schedules/route.ts`, `app/api/admin/follow-ups/route.ts`, `app/api/admin/packages/[packageId]/switch/route.ts`, `app/api/cron/{pickup-expiry,payment-reminders}/route.ts`, `app/(admin)/admin/{routes,pickup,bulk,follow-ups}/**`, `app/(admin)/admin/packages/[packageId]/method-switch.tsx`, migration `20260729072213_p9_delivery_routes`.
**Rubric:** `kit/prompts/reviewer/review-quality.md` — correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.
**Evidence read:** `.scratch/PHASE-P9-STATUS.md`, `.scratch/PHASE-P9-SMOKE.md` (30/0), `scripts/test-p9.mts`, `scripts/test-p9-domain.mts`, all P9 lib + routes + pages + migration.

## Summary

All five EXPECTED items are implemented and smoke S1–S5 pass (30 checks, 0 failures). No stubs; the Mapbox/Google/Resend/Twilio seams are honest (nearest-neighbor + dev geocoder + outbox capture). The keystone laws hold: hashed magic-link tokens, per-customer day-of grouping, atomic Delivered claim, manager-confirmed reroute, SENT refusal, label void on method switch, pickup-ready-once, bearer-guarded crons. Findings below are two real partial-failure windows (label void outside the flip transaction; silent stage-skip when the season closes mid-route), a notification-idempotency gap on bulk re-schedule, and operational/smoke holes the suites do not exercise.

## Findings

### Blocker

1. **Label void runs OUTSIDE the method-flip transaction — a crash between the two leaves the package SHIPPED with no label.** Both `confirmRouteReroute` (`reroute.ts:69-76`) and `switchPackageMethod` (`switch.ts:162-173`) call `voidLabel(...)` before `prisma.$transaction(...)`. `voidLabel` commits its own transaction (voids the `Shipment`, writes `label_void` event + audit). If the subsequent flip transaction then fails (DB error, unique-constraint collision, process kill between commit and the flip's `tx.package.update`), the label is already VOIDED but `package.channel` is still `SHIPPED` and `package.stage` is unchanged. The org is billed for a void, the package has no active label, and the manager sees a SHIPPED package that can't ship and can't reroute (the `PURCHASING`/`PURCHASED` legs are gone). There is no compensating re-buy or rollback. The smoke S3e/S3f only exercises the happy path (void then flip both succeed); the void-then-flip-fails window is unexercised. The fix is structural: pass the flip's `tx` into the void path so the void and the channel flip commit atomically, or document a manual recovery (re-buy label) and surface it in the UI.

### Major

2. **`markStopDelivered` silently skips the stage advance when the season is closed, but still completes the route and writes the audit.** `lifecycle.ts:171,196-208` reads `const season = await getOpenSeason()` outside the transaction, then `if (season && pkg.order.seasonId === season.id)` guards the `stage -> terminalStage` advance. If the season closes between route build and the Delivered tap (manager close, or the P10 auto-flip firing mid-run), `season` is null and the package stays at PACKED/PRINTED while the route flips COMPLETED, the link expires, and a `delivered` PackageEvent is written. The package board then shows a delivered package as still in-progress, and the nightly print batch may re-file it. Either advance the stage unconditionally (the package WAS delivered — the route is the authority, not the season flag) or refuse the tap with a clear error when the season closed. The smoke and domain suite always run with an open season, so this regression is unexercised.

3. **Bulk re-schedule is not idempotent against re-notify — a second `scheduleBulkDelivery` for a different day re-notifies the same customers.** `schedule.ts:39-50` selects candidates with `bulkScheduleItems: { none: {} }`, so packages already on a schedule are excluded. But the dedupe is per-package, not per-customer-per-day. If a manager schedules Day A (notifies customers), then later schedules Day B for packages that were NOT on Day A's schedule, customers who also had packages on Day A get a second `bulk_scheduled` email + SMS. The EXPECTED S4 only asserts "one email + SMS per customer" for a single schedule action; the cross-schedule double-notify path is not exercised. The outbox has no per-`(kind, customerId, deliveryDay)` idempotency key — `sendNotification` writes a row per call unconditionally. For day-of/pickup-ready the per-stop/per-package stamp (`dayOfNotifiedAt`, `pickupReadyNotifiedAt`) dedupes; bulk has only `BulkDeliverySchedule.notifiedAt` (per-schedule, not per-customer). Add a per-customer-per-day dedupe stamp on the package or the schedule item, or accept the double-notify and document it.

4. **`route_stops` RESTRICT on `packageId` blocks order discard for any routed package, with no UI recovery.** Migration `20260729072213` line 152 sets `ON DELETE RESTRICT` on `route_stops.packageId`. Once a package sits on any route (PLANNED, STARTED, or COMPLETED), it cannot be deleted, so an order discard that deletes packages (`order_discard`) will throw a FK violation if any package was ever routed. There is no staff flow to remove a package from a COMPLETED route (reassign and reroute both require PLANNED). A fraud/cancellation discard on a delivered order is a manual-SQL-only recovery. The status doc notes the RESTRICT lesson but only for the cross-season cleanup collision, not the discard path. Either cascade the stop deletion on order discard, or add a "remove from route" affordance for terminal routes.

### Minor

5. **`startRoute` and `scheduleBulkDelivery` link only the first order id on the outbox row when a customer spans multiple orders.** `lifecycle.ts:144` and `schedule.ts:92` set `orderId: [...entry.orderIds][0]`. The outbox FK is `ON DELETE SET NULL`, so deleting that one order orphans the audit link to the other orders. The metadata carries `orderCount` but not the order ids. A reconciliation query joining outbox to "which orders were on this notification" loses the secondary orders. Record all order ids in metadata.

6. **`loadFollowUps` "bulk" reason only surfaces the LATEST schedule's customers.** `follow-ups.ts:77` takes `schedules[0]` (ordered desc). A call-center agent filtering `?reason=bulk` to call customers from an earlier same-day run sees only the most recent batch. Historical bulk follow-ups are invisible. Either list customers across all un-delivered schedules, or add a `?scheduleId=` filter.

7. **`nearbyShippedSuggestions` geocodes every candidate on every scan with no cap.** `builder.ts:278-280` calls `geocodeAddress` per candidate inside the loop. The dev geocoder is deterministic and cached, so locally this is cheap; with a live Mapbox/Google geocoder behind the same seam, a "Scan for candidates" click on a route with 200 SHIPPED packages fires 200 geocode calls (cache hits after the first pass, but cold = 200 API calls). Cap concurrency or rely solely on the cached `lat/lng` already stored on the package's own `routeStops`/`recipientAddress` geocode.

8. **`reassignStop` deletes and recreates the stop, changing its `id`.** `builder.ts:209-224` deletes the source stop and creates a new one on the target route. The `stop_reassigned_out` event references the old (now-deleted) `stopId`; the `stop_reassigned_in` references the new id. Any external reference to the old stop id dangles. In practice reassign is PLANNED-only (no `deliveredAt`/`dayOfNotifiedAt` to lose), so this is a reference-stability nit, not data loss. An update-in-place (change `routeId` + re-seq) would preserve the id.

9. **PIN lock gives 5 tries per 10-minute window — ~2,160 tries over the 72h link TTL.** `links.ts:16-17` sets `PIN_MAX_FAILURES=5`, `PIN_LOCK_MS=10min`. For a 4-digit PIN (10,000 space), an attacker who forwards the link gets ~2,160 attempts over the link's 72h life — ~21.6% coverage. The link also expires on route completion, which usually cuts this short, and the PIN is optional. Acceptable for a low-value delivery link, but worth noting if PINs ever protect higher-value routes.

10. **`sweepPaymentReminders` counts `candidates.length` before the `outstandingCents <= 0` skip, so the CronRun message can overstate candidates.** `reminders.ts:46-49,70` — a UNPAID/PARTIAL order with `totalCents === 0` (comp) passes the query filter but is skipped at `if (outstandingCents <= 0) continue`. The reported `${candidates.length} candidate order(s)` includes the skipped one. Cosmetic, but the CronRun message is the only audit of sweep scope.

11. **`bulk_delivery_schedule_items` CASCADE on `packageId` deletion does not decrement `bulk_delivery_schedules.packageCount/customerCount`.** Migration line 170. If a package is deleted (draft discard — but see finding 4, RESTRICT blocks routed ones), the schedule row's counts drift high. Low-impact since the items are the source of truth and the counts are presentational.

12. **`loadDriverRouteView` returns `contents` from `pkg.lines` but the driver app never shows the package `greeting` flag.** `lifecycle.ts:69-71` builds contents lines but omits the greeting; the printed manifest (`print.ts:84`) does show "Greeting card enclosed". A driver on the phone app doesn't know to hand over the card. Minor UX gap vs the printed fallback.

## Count by severity

- Blocker: 1
- Major: 3
- Minor: 8
- Total: 12
