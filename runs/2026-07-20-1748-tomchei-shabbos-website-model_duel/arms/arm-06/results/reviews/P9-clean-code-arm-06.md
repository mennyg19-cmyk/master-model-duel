# P9 Clean-code review — arm-06

**Phase:** P9 — Delivery routes, driver magic links, reroute, pickup, bulk (per `shared/phases/PHASE-P9-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P9)
**Rule source:** `arms/arm-06/.cursor/rules/clean-code.mdc`
**Scope:** new and modified files under `arms/arm-06/workspace/` for P9 — `lib/routes/*`, `lib/pickup/readiness.ts`, `lib/bulk/schedule.ts`, `lib/payments/reminders.ts`, `lib/notify/outbox.ts`, `app/api/admin/routes/**`, `app/api/admin/pickup/**`, `app/api/admin/bulk-schedules/**`, `app/api/cron/pickup-expiry/**`, `app/api/cron/payment-reminders/**`, `app/api/drive/[token]/**`, `app/(admin)/admin/routes/**`, `app/(admin)/admin/pickup/**`, `app/(admin)/admin/bulk/**`, `app/(driver)/drive/[token]/**`, `lib/audit.ts`, `lib/packages/stages.ts`, `prisma/schema.prisma` (DeliveryRoute/RouteStop/RouteEvent/DriverRouteLink/BulkDeliverySchedule*).
**Mode:** findings only, no fixes. Blind to model name.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 12 |

## Major

### M1 — `nearbyShippedSuggestions` geocodes every SHIPPED candidate on every scan (no pre-filter, N geocodes + N×stops haversines per request)
`lib/routes/builder.ts:266-312` loads ALL non-SENT SHIPPED packages in the season with no proximity pre-filter, then for each candidate calls `geocodeAddress` (cache or not) and runs an O(stops) haversine loop. At the P12 scale baseline (5k packages), a single "scan for candidates" tap geocodes thousands of packages and runs tens of thousands of distance computations in one request. The geocode cache helps repeat scans, but the first scan after a season's worth of SHIPPED packages is a cold N geocodes + N×stops haversines. The same-street check (`streetKey`, line 299) needs no geocode and could short-circuit before the geocode; a postal-code or bounding-box pre-filter on the candidate query would bound the geocode set. The rest of P9 (`buildRoute`, `scheduleBulkDelivery`) bounds its queries — this one doesn't. Violates: anti-AI-tics ("just in case" work at scale), one-pattern-per-concern.

### M2 — `voidLabel` runs OUTSIDE the flip transaction; a rollback leaves the org with a voided label and no delivery membership
`lib/routes/reroute.ts:69-89` voids the label via `voidLabel` (its own DB write + Shippo call), then opens `prisma.$transaction` for the channel flip + stop create + package event + route event. `lib/routes/switch.ts:163-178` has the same shape. The "void then flip" ordering is forced (you can't flip to delivery while a live label exists), but the Shippo void is irreversible and external; if the local `$transaction` rolls back (P2002, connection drop), the package is still `SHIPPED` while the carrier label is already voided — the org paid for a void and got no reroute. The audit row (`recordAudit`, reroute.ts:121, also outside the tx) can also fail after a successful commit, leaving a durable reroute with no audit trail. Either make the void compensable (a "void pending" state the sweeper reconciles) or commit the audit inside the tx. Violates: error handling (irreversible external call before local atomic), anti-AI-tics.

### M3 — `loadSwitchable` / reroute throw `NotFoundError` for a closed-season package (misleading 404)
`lib/routes/switch.ts:42-44` and `lib/routes/reroute.ts:49` both do:
```ts
if (pkg.order.season.status !== "OPEN") {
  throw new NotFoundError("Package in the open season", packageId);
}
```
A package in a closed season exists — it's a domain rule violation, not a missing record. `NotFoundError` maps to 404 in `mapDomainError`, so the operator sees "package not found" when the package is right there; the season is just closed. `buildRoute` and `scheduleBulkDelivery` use `DomainRuleError` for the no-open-season case. Two files, two call sites, same wrong error class, with a `targetType` string ("Package in the open season") that isn't a model name. Violates: error handling (messages must say what went wrong AND the expected state), pattern drift.

## Minor

### m1 — `reprintBatch` `NotFoundError` swallow duplicated between switch and reroute
`lib/routes/switch.ts:189-192` and `lib/routes/reroute.ts:131-134` both:
```ts
await reprintBatch({ orderId: pkg.order.id, createdById: input.ctx.staff.id }).catch((error: unknown) => {
  if (error instanceof NotFoundError) return;
  throw error;
});
```
Two sites, identical pattern. The "reprint is best-effort after a method switch/reroute" contract is duplicated, and it's unclear whether `reprintBatch` can legitimately 404 (no printable artifacts) — if not, the catch is dead defensive code. Extract a `reprintBestEffort(orderId, staffId)` helper. Violates: duplicated logic, anti-AI-tics.

### m2 — `byCustomer` grouping loop duplicated between `startRoute` and `scheduleBulkDelivery`
`lib/routes/lifecycle.ts:120-132` and `lib/bulk/schedule.ts:55-61` both build a `Map<customerId, { customer, orderIds: Set, recipients: string[], stopIds/packageIds: [] }>` from a flat list, then iterate it to send one notification per distinct customer. The shapes differ slightly (lifecycle keys on `order.customer.id` and tracks `stopIds`; bulk keys on `pkg.order.customerId`), but the "group by customer, notify once" law is the same and the loop is copy-pasted. A `groupByCustomer<T>(items, getCustomer, getRecipient, getOrderId)` helper would collapse both. Violates: duplicated logic.

### m3 — `assertSwitchable` / `confirmRouteReroute` duplicate the "active stop" and "stuck PURCHASING" pre-flight checks
`lib/routes/switch.ts:54-59` (`assertSwitchable`) and `lib/routes/reroute.ts:56-65` both find an active route stop on a PLANNED/STARTED route and find a PURCHASING shipment stuck mid-flight, with near-identical error messages. `assertLabelVoidable` (switch.ts:73-86) and the reroute inline block both then check PURCHASING then PURCHASED. The "package already on an active route" and "label purchase stuck mid-flight" guards are spelled twice with minor wording variations. Extract a shared `assertPackageReroutable(pkg)` helper. Violates: duplicated logic, pattern drift.

### m4 — `DAY_MS` / `24 * 60 * 60 * 1000` magic value spelled four ways across P9
- `lib/payments/reminders.ts:18` defines `const DAY_MS = 24 * 60 * 60 * 1000;` and uses it.
- `lib/pickup/readiness.ts:126` inlines `policy.unclaimedAfterDays * 24 * 60 * 60 * 1000`.
- `lib/pickup/readiness.ts:156` inlines `policy.expireAfterDays * 24 * 60 * 60 * 1000`.
- `lib/routes/links.ts:15-17` spells `72 * 60 * 60 * 1000` and `10 * 60 * 1000` inline.

The codebase has a date helper module (P1 helper ladder). Day-in-millis is a magic value spelled four times. Centralize as `MILLIS_PER_DAY` / `MILLIS_PER_HOUR` / `MILLIS_PER_MINUTE` in the dates lib. Violates: magic values, one-pattern-per-concern.

### m5 — `REROUTE_SUGGESTION_RADIUS_MILES` ownership: lives in `builder.ts`, is the G-023 law, not re-checked on confirm
`lib/routes/builder.ts:19` exports `REROUTE_SUGGESTION_RADIUS_MILES = 0.5`, consumed only by `nearbyShippedSuggestions` in the same file. `lib/routes/reroute.ts` (the confirm path) doesn't reference it — the 0.5-mile law is enforced only on the suggestion side. If the suggestion list is stale (route edited between scan and confirm), `confirmRouteReroute` accepts any SHIPPED package regardless of distance. The constant is the G-023 contract value and arguably belongs in `lib/routes/geo.ts` next to `haversineMiles` (which implements the law), and the confirm path should re-check it. Violates: magic-values ownership, naming (named for the suggestion, not the law).

### m6 — `RerouteSuggestion` interface duplicated between `builder.ts` and `route-actions.tsx`
`lib/routes/builder.ts:245-253` declares `export interface RerouteSuggestion`, and `app/(admin)/admin/routes/[routeId]/route-actions.tsx:12-20` re-declares a local `interface RerouteSuggestion` with the same fields. The API returns the server type; the client re-declaration can drift silently — adding a field server-side won't break the client (silently dropped), removing one won't compile-fail it. Import the shared type. Violates: type/schema drift, one-pattern-per-concern.

### m7 — `DriverStopCard` / `DriverRouteView` duplicated between `lifecycle.ts` and `drive-app.tsx`
`lib/routes/lifecycle.ts:15-31` declares `DriverStopCard` and `DriverRouteView`, and `app/(driver)/drive/[token]/drive-app.tsx:11-27` re-declares both verbatim. Same drift class as m6. Violates: type/schema drift.

### m8 — `loadLinkByToken` + PIN-cookie guard duplicated across the three `/api/drive/[token]/*` routes
`app/api/drive/[token]/route.ts:14-25`, `start/route.ts:14-24`, and `deliver/route.ts:22-32` each repeat: load link by token, map `state` to 404/410, then `if (link.pinHash) { const jar = await cookies(); if (!(await verifyPinCookie(...))) return 403 pin_required }`. Three sites, same ~10-line guard, with the 404/410 status mapping spelled inline three times and slightly different error messages per route. Extract a `requireActiveLink(token)` (returns `{ link } | NextResponse`) and a `requirePinPassed(link)` helper. Violates: duplicated logic, pattern drift.

### m9 — `loadRouteDetail` ships `link.pinHash` to the admin route detail API (least-read)
`lib/routes/builder.ts:176` selects `link: { select: { id: true, expiresAt: true, pinHash: true, createdAt: true } }`. The admin route detail API (`app/api/admin/routes/[routeId]/route.ts:17`) returns the `route` object verbatim, and the route detail page (`[routeId]/page.tsx:50-53`) only reads `expiresAt` and `pinHash !== null` (for "PIN protected" display). The `pinHash` value itself is never displayed but is shipped to every staff browser with `fulfillment.manage`. The driver-link module's own comment ("the token hash never leaves the DB — staff see existence + expiry only") is the same honesty class; the PIN hash is a credential hash and shouldn't ride to the client. Project to `hasPin: pinHash !== null` server-side. Violates: least-read, the module's own honesty class.

### m10 — `AuditAction` lags `PackageEventAction` for P9 events (type drift, mirror of P8 m3)
`lib/packages/stages.ts:42-46` adds `method_switch`, `reroute`, `delivered`, `pickup_ready`, `pickup_expired` to `PackageEventAction`. `lib/audit.ts:50-56` adds `route_create`, `route_reassign`, `route_link_create`, `route_reroute`, `method_switch`, `bulk_schedule` to `AuditAction`. The P9 `PackageEvent` actions `delivered`, `reroute`, `pickup_ready`, `pickup_expired` are NOT in `AuditAction`. Today `recordAudit` is only called for `method_switch`, `route_*`, `bulk_schedule` — so the compiler is happy — but the two unions are out of lockstep for P9, exactly the drift P8 m3 called out. `pickup_ready` / `pickup_expired` / `delivered` are plausible audit candidates (a pickup-ready sweep touching customer packages; a delivered tap via magic link). Keep the two lists in lockstep or derive `AuditAction` from `PackageEventAction`. Violates: type/schema drift, one-typing-discipline-per-concern.

### m11 — Three route loaders (`loadRouteDetail` / `loadDriverRouteView` / `loadRouteForPrint`), no shared base
`lib/routes/builder.ts:158-182` (`loadRouteDetail`), `lib/routes/lifecycle.ts:33-48` (`loadDriverRouteView`), and `lib/routes/print.ts:26-46` (`loadRouteForPrint`) each run `prisma.deliveryRoute.findUnique` with a hand-rolled `stops` include selecting a different subset. The shapes are genuinely different (driver view minimizes PII; print needs greeting+lines; admin needs events+link), so a single include is wrong — but the three are unowned and share no base constant. Adding a `RouteStop` field two of three need means editing three queries. At minimum document why each exists; consider a shared `routeStopsBaseInclude` extended per consumer. Violates: pattern drift.

### m12 — `window_` identifier in `bulk-schedule-form.tsx`
`app/(admin)/admin/bulk/bulk-schedule-form.tsx:17` declares `const [window_, setWindow] = useState("")`. `window` is a global, so the trailing underscore avoids the collision — but `window_` reads as a typo. Rename to `deliveryWindow` / `setDeliveryWindow` (the field is the delivery window, per the label "Window (optional)"). Violates: naming (clarity).

## Notes (not findings)

- `lib/routes/links.ts` is correctly disciplined: raw token returned ONCE (`createDriverLink`), only SHA-256 hash stored, PIN throttled DB-side with a 5-strike lock and counter reset on success, PIN cookie HMAC-bound to the link id and its own expiry so it can't outlive or cross routes. The `safeEqual` constant-time compare is used for both PIN and cookie.
- `lib/routes/optimize.ts` is a clean provider seam: Mapbox when configured and ≤11 stops, deterministic nearest-neighbor otherwise, ANY provider failure falls back silently to the documented fallback. The `code !== "Ok"` and waypoint-count assertions are honest validation, not "just in case" guards.
- `lib/routes/geo.ts` is pure and unit-testable (haversine, streetKey, normalizedAddressKey, oneLineAddress, googleMapsDirectionsUrl) — the 0.5-mile law and the street-cluster fallback live in one module with no DB/HTTP.
- `lib/notify/outbox.ts` is the right P9→P11 seam: every send is an `OutboxMessage` row, channel policy is a typed `NOTIFY_CHANNELS` map (time-sensitive = EMAIL+SMS, follow-ups = EMAIL only), and `sendNotification` returns the channel list so callers can assert "one email + one SMS per customer" without opening the outbox.
- `markStopDelivered` (`lifecycle.ts:181-208`) uses an atomic `updateMany ... where deliveredAt IS NULL` for the stop claim and an optimistic `version` check for the package stage advance — double-tap and two-device safety is correctly enforced at the DB, not in app logic.
- The four cron routes (`pickup-expiry`, `payment-reminders`, plus the existing `nightly-print`, `shipping-maintenance`) all gate on `isCronAuthorized` and write a `CronRun` row with OK/FAILED + message — one cron pattern, applied consistently.
- `sweepPickupExpiry` and `sweepPaymentReminders` both wrap the body in try/catch that flips the `CronRun` to FAILED and rethrows — the cron trail is durable even when the sweep throws.
