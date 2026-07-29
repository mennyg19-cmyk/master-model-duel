# Aggregate Review — P9 — arm-06

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-06 (late join)
**Phase:** P9 — Delivery routes, driver magic links, reroute, pickup, bulk delivery scheduling
**Inputs:** P9-security, P9-quality, P9-rules, P9-clean-code (arm-06, all blind)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings. Mixed-severity clusters resolve to the highest severity (Blocker > Major > Minor).

## Counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 6 |
| Minor | 27 |
| **Total** | **34** |

Source totals (pre-dedupe): security 6 (0B/1M/5m), quality 12 (1B/3M/8m), rules 6 (0B/0M/6m), clean-code 15 (0B/3M/12m) = 39. 5 clusters merged (B1: 2 src — Blocker + Major → Blocker; M1: 2 src — Major + Minor → Major; M5: 2 src — Minor + Major → Major; m1: 2 src — Minor + Minor → Minor; m6: 2 src — Minor + Minor → Minor) → 5 duplicates removed → net 34 unique. No security blockers were raised by the security specialist; the single Blocker comes from quality + clean-code (label-void transaction integrity) and survives aggregation.

## Blockers (1)

### B1 — Label void runs OUTSIDE the method-flip transaction — a crash between the two leaves the package SHIPPED with no label
**Sources:** quality Blocker 1, clean-code Major 2
**Location:** `lib/routes/reroute.ts:69-89` (`confirmRouteReroute` — `voidLabel` then `prisma.$transaction`); `lib/routes/switch.ts:162-173` / `:163-178` (`switchPackageMethod` — same shape); `lib/routes/reroute.ts:121` (`recordAudit` outside the tx)
**Claim:** Both `confirmRouteReroute` and `switchPackageMethods` call `voidLabel(...)` before `prisma.$transaction(...)`. `voidLabel` commits its own transaction (voids the `Shipment`, writes `label_void` event + audit) and is an irreversible external Shippo call. If the subsequent flip transaction then fails (DB error, `P2002` unique-constraint collision, connection drop, process kill between commit and the flip's `tx.package.update`), the label is already VOIDED but `package.channel` is still `SHIPPED` and `package.stage` is unchanged. The org is billed for a void, the package has no active label, and the manager sees a SHIPPED package that can't ship and can't reroute (the `PURCHASING`/`PURCHASED` legs are gone). There is no compensating re-buy or rollback; the audit row (`recordAudit`, also outside the tx) can fail after a successful commit, leaving a durable reroute with no audit trail. Smoke S3e/S3f only exercises the happy path (void then flip both succeed); the void-then-flip-fails window is unexercised. Fix scope: pass the flip's `tx` into the void path so the void and the channel flip commit atomically, make the void compensable (a "void pending" state the sweeper reconciles), or document a manual recovery (re-buy label) and surface it in the UI. Violates: error handling (irreversible external call before local atomic), anti-AI-tics.

## Majors (6)

### M1 — PIN throttle is inadequate for a 4-digit PIN over the 72h link lifetime
**Sources:** security Major 1, quality Minor 9
**Location:** `lib/routes/links.ts:15-17` (`LINK_TTL_MS = 72h`, `PIN_MAX_FAILURES = 5`, `PIN_LOCK_MS = 10min`); `lib/routes/links.ts:123` (`checkPin` — increments `pinFailures`, locks on 5th, resets counter to 0 on lock); `lib/routes/links.ts:32` (`isPinFormat` — 4-digit, 10 000 space)
**Claim:** `checkPin` increments `pinFailures` per wrong guess, locks for 10 minutes on the 5th failure, and resets the counter to 0 on lock (`pinFailures: locksNow ? 0 : failures`). No exponential backoff, no permanent lockout, no per-IP throttle — the only control is the per-link 5-attempts-then-10-min-lock cycle. The lockout cadence yields 5 attempts per 10 minutes = 30/hour. Over the 72h link TTL the budget is `72 × 6 × 5 = 2 160` guesses — ~21.6% coverage of the 10 000-value PIN space within a single link's lifetime, at a constant rate with no escalation. The PIN is the only barrier once the unguessable URL token leaks (forwarded text, shared-device browser history, server access log) — exactly the leakage scenario the plan's risk register calls out, where "throttle PIN attempts" is the named mitigation. A ~1-in-5 success probability against the stated mitigation over a 3-day window is too high for a credential protecting recipient addresses and delivery audit integrity. The same 4-digit PIN is also trivially brute-forceable offline if the `pinHash` column leaks (SHA-256 of `drive-pin:${routeId}:${pin}` — the routeId cuid is a salt, but 10 000 candidates is milliseconds regardless of salt); the online throttle is the only meaningful control, and it is the weak one. The link also expires on route completion (usually cuts this short) and the PIN is optional — acceptable for a low-value delivery link today, but worth noting if PINs ever protect higher-value routes. Security rates Major; quality rates Minor — highest wins.

### M2 — `markStopDelivered` silently skips the stage advance when the season closes mid-route
**Sources:** quality Major 2
**Location:** `lib/routes/lifecycle.ts:171` (`const season = await getOpenSeason()` outside the transaction); `lib/routes/lifecycle.ts:196-208` (`if (season && pkg.order.seasonId === season.id)` guards the `stage -> terminalStage` advance)
**Claim:** `markStopDelivered` reads `const season = await getOpenSeason()` outside the transaction, then `if (season && pkg.order.seasonId === season.id)` guards the `stage -> terminalStage` advance. If the season closes between route build and the Delivered tap (manager close, or the P10 auto-flip firing mid-run), `season` is null and the package stays at PACKED/PRINTED while the route flips COMPLETED, the link expires, and a `delivered` PackageEvent is written. The package board then shows a delivered package as still in-progress, and the nightly print batch may re-file it. Either advance the stage unconditionally (the package WAS delivered — the route is the authority, not the season flag) or refuse the tap with a clear error when the season closed. The smoke and domain suite always run with an open season, so this regression is unexercised.

### M3 — Bulk re-schedule is not idempotent against re-notify — a second `scheduleBulkDelivery` for a different day re-notifies the same customers
**Sources:** quality Major 3
**Location:** `lib/bulk/schedule.ts:39-50` (candidate select with `bulkScheduleItems: { none: {} }`); `lib/bulk/schedule.ts:92` (notify per customer); `lib/notify/outbox.ts` (`sendNotification` writes a row per call, no per-`(kind, customerId, deliveryDay)` idempotency key); `BulkDeliverySchedule.notifiedAt` (per-schedule, not per-customer)
**Claim:** `schedule.ts:39-50` selects candidates with `bulkScheduleItems: { none: {} }`, so packages already on a schedule are excluded. But the dedupe is per-package, not per-customer-per-day. If a manager schedules Day A (notifies customers), then later schedules Day B for packages that were NOT on Day A's schedule, customers who also had packages on Day A get a second `bulk_scheduled` email + SMS. The EXPECTED S4 only asserts "one email + SMS per customer" for a single schedule action; the cross-schedule double-notify path is not exercised. The outbox has no per-`(kind, customerId, deliveryDay)` idempotency key — `sendNotification` writes a row per call unconditionally. For day-of/pickup-ready the per-stop/per-package stamp (`dayOfNotifiedAt`, `pickupReadyNotifiedAt`) dedupes; bulk has only `BulkDeliverySchedule.notifiedAt` (per-schedule, not per-customer). Add a per-customer-per-day dedupe stamp on the package or the schedule item, or accept the double-notify and document it.

### M4 — `route_stops` RESTRICT on `packageId` blocks order discard for any routed package, with no UI recovery
**Sources:** quality Major 4
**Location:** migration `20260729072213_p9_delivery_routes` line 152 (`ON DELETE RESTRICT` on `route_stops.packageId`); `order_discard` flow (deletes packages)
**Claim:** Migration line 152 sets `ON DELETE RESTRICT` on `route_stops.packageId`. Once a package sits on any route (PLANNED, STARTED, or COMPLETED), it cannot be deleted, so an order discard that deletes packages (`order_discard`) will throw a FK violation if any package was ever routed. There is no staff flow to remove a package from a COMPLETED route (reassign and reroute both require PLANNED). A fraud/cancellation discard on a delivered order is a manual-SQL-only recovery. The status doc notes the RESTRICT lesson but only for the cross-season cleanup collision, not the discard path. Either cascade the stop deletion on order discard, or add a "remove from route" affordance for terminal routes.

### M5 — `nearbyShippedSuggestions` geocodes every SHIPPED candidate on every scan (no pre-filter, N geocodes + N×stops haversines per request)
**Sources:** quality Minor 7, clean-code Major 1
**Location:** `lib/routes/builder.ts:266-312` (loads ALL non-SENT SHIPPED packages in the season, no proximity pre-filter); `lib/routes/builder.ts:278-280` (`geocodeAddress` per candidate inside the loop); `lib/routes/builder.ts:299` (same-street `streetKey` check needs no geocode)
**Claim:** `nearbyShippedSuggestions` loads ALL non-SENT SHIPPED packages in the season with no proximity pre-filter, then for each candidate calls `geocodeAddress` (cache or not) and runs an O(stops) haversine loop. At the P12 scale baseline (5k packages), a single "scan for candidates" tap geocodes thousands of packages and runs tens of thousands of distance computations in one request. The geocode cache helps repeat scans, but the first scan after a season's worth of SHIPPED packages is a cold N geocodes + N×stops haversines. With a live Mapbox/Google geocoder behind the same seam, a cold scan on a route with 200 SHIPPED packages fires 200 geocode API calls. The same-street check (`streetKey`, line 299) needs no geocode and could short-circuit before the geocode; a postal-code or bounding-box pre-filter on the candidate query would bound the geocode set. The rest of P9 (`buildRoute`, `scheduleBulkDelivery`) bounds its queries — this one doesn't. Violates: anti-AI-tics ("just in case" work at scale), one-pattern-per-concern. Quality rates Minor; clean-code rates Major — highest wins.

### M6 — `loadSwitchable` / reroute throw `NotFoundError` for a closed-season package (misleading 404)
**Sources:** clean-code Major 3
**Location:** `lib/routes/switch.ts:42-44`; `lib/routes/reroute.ts:49`; `mapDomainError` (`NotFoundError` → 404)
**Claim:** Both `lib/routes/switch.ts:42-44` and `lib/routes/reroute.ts:49` do `if (pkg.order.season.status !== "OPEN") { throw new NotFoundError("Package in the open season", packageId); }`. A package in a closed season exists — it's a domain rule violation, not a missing record. `NotFoundError` maps to 404 in `mapDomainError`, so the operator sees "package not found" when the package is right there; the season is just closed. `buildRoute` and `scheduleBulkDelivery` use `DomainRuleError` for the no-open-season case. Two files, two call sites, same wrong error class, with a `targetType` string ("Package in the open season") that isn't a model name. Violates: error handling (messages must say what went wrong AND the expected state), pattern drift.

## Minors (27)

### m1 — Reroute confirm does not re-verify the G-023 proximity / same-street invariant; `REROUTE_SUGGESTION_RADIUS_MILES` ownership is wrong
**Sources:** security Minor 1, clean-code Minor 5
**Location:** `lib/routes/builder.ts:19` (`REROUTE_SUGGESTION_RADIUS_MILES = 0.5` — the G-023 law, owned by `builder.ts`); `lib/routes/builder.ts:258` (`nearbyShippedSuggestions` — the only consumer, GET side); `lib/routes/reroute.ts:27-36` (`confirmRouteReroute` — POST side, no radius reference); `app/api/admin/routes/[routeId]/reroute/route.ts` (POST passes arbitrary `packageId`); `lib/routes/geo.ts` (`haversineMiles` — implements the law, natural home for the constant)
**Claim:** `confirmRouteReroute` validates route is `PLANNED`, package is `SHIPPED`, stage ≠ `SENT`, not on an active route, not stuck `PURCHASING` — but does not re-check that the package's destination is within `REROUTE_SUGGESTION_RADIUS_MILES` (0.5) of a stop or on the same street cluster. That filter lives only in `nearbyShippedSuggestions` (the GET side). A manager holding `fulfillment.manage` can pull any qualifying shipped package onto any planned route regardless of geography, bypassing the G-023 "nearby" invariant; if the suggestion list is stale (route edited between scan and confirm), the accept is silent. Behind manager auth + explicit `confirm: true`, so this is a business-rule enforcement gap, not a privilege escalation. Additionally, the constant is named for the suggestion, not the law, and lives in `builder.ts` next to its only consumer rather than in `lib/routes/geo.ts` next to `haversineMiles` which implements the law. Re-check the radius on the confirm path and move the constant to `geo.ts`. Violates: magic-values ownership, naming, business-rule enforcement.

### m2 — Pickup stamp (advance to `PICKED_UP`) does not gate on `pickupReadyAt`
**Sources:** security Minor 2
**Location:** `lib/packages/stages.ts:105` (`advancePackageStage`); `POST /api/admin/packages/[packageId]/advance` with `to: "PICKED_UP"`; `lib/pickup/readiness.ts` (`syncPickupReadiness` — the readiness sweep)
**Claim:** The "picked-up stamp" is the package stage advance endpoint with `to: "PICKED_UP"`. `advancePackageStage` enforces the transition is legal per the method's stage list — so only a PICKUP-channel package (whose method stages include `PICKED_UP`) can be stamped, which correctly prevents stamping a delivery package as picked-up. However, there is no check that `pickupReadyAt` is set. A staff member with `fulfillment.manage` can stamp a package `PICKED_UP` before `syncPickupReadiness` ever ran, so the ready notification (`pickup_ready`) never fires and the door list never showed it — the readiness/door-list invariant is bypassable. Same permission tier as the readiness sweep, so it is an operational-rule gap, not an authz one.

### m3 — `isCronAuthorized` length-pre-check leaks `CRON_SECRET` length via timing
**Sources:** security Minor 3
**Location:** `lib/cron-auth.ts:14` (`auth.length === expected.length` short-circuit before `timingSafeEqual`)
**Claim:** `lib/cron-auth.ts:14` short-circuits with `auth.length === expected.length` before calling `timingSafeEqual`. The 401 response is returned either way, but the branch lets a remote caller distinguish "wrong length" from "right length, wrong content" by timing the 401, revealing the length of `Bearer ${CRON_SECRET}` and thus the secret's length. Length alone does not recover the secret's content, so the impact is low, but the standard fix (compare hashes of both sides, or feed unequal-length strings into a constant-time loop) removes the oracle entirely.

### m4 — Reroute / link / advance endpoints do not verify the target belongs to the open season
**Sources:** security Minor 4
**Location:** `lib/routes/reroute.ts:36` (`confirmRouteReroute` loads route by `id`, no `seasonId` filter, checks only `pkg.order.season.status === "OPEN"`); `lib/routes/links.ts:53` (`createDriverLink` loads route by `id`, checks only `route.status !== "COMPLETED"`); `lib/packages/stages.ts` (`advancePackageStage` does scope the package to the open season)
**Claim:** `confirmRouteReroute` loads the route by `id` with no `seasonId` filter and checks only `pkg.order.season.status === "OPEN"` — it does not assert `pkg.order.seasonId === route.seasonId`. `createDriverLink` likewise loads the route by `id` and checks only `route.status !== "COMPLETED"`. `advancePackageStage` does scope the package to the open season, but the route-side verbs (reroute, link create) accept a `routeId` from any season. If a stale `PLANNED` route from a prior season ever exists, a manager could pull an open-season shipped package onto it or issue a driver link for it. Routes are normally `COMPLETED` once a season closes, so this is an edge case, but the season-scoping check is missing on the route side.

### m5 — Magic-link token carried in the URL path is logged in browser history and server access logs
**Sources:** security Minor 5
**Location:** `/drive/[token]` (256-bit token in the path); `lib/routes/links.ts` (token stored only as SHA-256 hash); `app/(driver)/drive/[token]/*` (Google Maps deep links use `rel="noreferrer"`)
**Claim:** The 256-bit token lives in the path (`/drive/[token]`), so it is captured in the driver's browser history, any reverse-proxy / Vercel access log, and any analytics the page is routed through. This is inherent to magic-link design and is acknowledged in the plan's risk register ("Magic-link leakage") with mitigations present here: the token is stored only as a SHA-256 hash, the route view minimizes stop PII, the link expires on completion, and the Google Maps deep links use `rel="noreferrer"` so the token is not leaked to Google via the Referer header. Noted for completeness as an accepted risk, not a defect — the residual exposure is the reason the PIN (M1) and the 72h TTL exist at all.

### m6 — `startRoute` and `scheduleBulkDelivery` link only the first order id on the outbox row when a customer spans multiple orders
**Sources:** quality Minor 5, rules Minor 4
**Location:** `lib/routes/lifecycle.ts:144` (`orderId: [...entry.orderIds][0]`); `lib/bulk/schedule.ts:92` (same shape); `OutboxMessage.orderId` (nullable, `ON DELETE SET NULL`)
**Claim:** `lifecycle.ts:144` and `schedule.ts:92` set `orderId: [...entry.orderIds][0]` for the day-of / bulk notification when a customer has packages spanning multiple orders on the route/schedule. The outbox FK is `ON DELETE SET NULL`, so deleting that one order orphans the audit link to the other orders. The metadata carries `orderCount` but not the order ids. A reconciliation query joining outbox to "which orders were on this notification" loses the secondary orders. The grouping itself is correct (one notice per customer), but the order linkage is lossy. Minor — does not violate an EXPECTED item, but the audit trail for the other N−1 orders' notice is indirect. Record all order ids in metadata.

### m7 — `loadFollowUps` "bulk" reason only surfaces the LATEST schedule's customers
**Sources:** quality Minor 6
**Location:** `lib/admin/follow-ups.ts:77` (`schedules[0]` ordered desc)
**Claim:** `follow-ups.ts:77` takes `schedules[0]` (ordered desc). A call-center agent filtering `?reason=bulk` to call customers from an earlier same-day run sees only the most recent batch. Historical bulk follow-ups are invisible. Either list customers across all un-delivered schedules, or add a `?scheduleId=` filter.

### m8 — `reassignStop` deletes and recreates the stop, changing its `id`
**Sources:** quality Minor 8
**Location:** `lib/routes/builder.ts:209-224` (delete source stop, create new on target route)
**Claim:** `reassignStop` deletes the source stop and creates a new one on the target route. The `stop_reassigned_out` event references the old (now-deleted) `stopId`; the `stop_reassigned_in` references the new id. Any external reference to the old stop id dangles. In practice reassign is PLANNED-only (no `deliveredAt`/`dayOfNotifiedAt` to lose), so this is a reference-stability nit, not data loss. An update-in-place (change `routeId` + re-seq) would preserve the id.

### m9 — `sweepPaymentReminders` counts `candidates.length` before the `outstandingCents <= 0` skip, so the CronRun message can overstate candidates
**Sources:** quality Minor 10
**Location:** `lib/payments/reminders.ts:46-49, 70` (query filter passes comp orders; `if (outstandingCents <= 0) continue` skips them; reported `${candidates.length} candidate order(s)`)
**Claim:** A UNPAID/PARTIAL order with `totalCents === 0` (comp) passes the query filter but is skipped at `if (outstandingCents <= 0) continue`. The reported `${candidates.length} candidate order(s)` includes the skipped one. Cosmetic, but the CronRun message is the only audit of sweep scope.

### m10 — `bulk_delivery_schedule_items` CASCADE on `packageId` deletion does not decrement `bulk_delivery_schedules.packageCount/customerCount`
**Sources:** quality Minor 11
**Location:** migration `20260729072213_p9_delivery_routes` line 170 (CASCADE on `bulk_delivery_schedule_items.packageId`)
**Claim:** If a package is deleted (draft discard — but see M4, RESTRICT blocks routed ones), the schedule row's counts drift high. Low-impact since the items are the source of truth and the counts are presentational.

### m11 — `loadDriverRouteView` returns `contents` from `pkg.lines` but the driver app never shows the package `greeting` flag
**Sources:** quality Minor 12
**Location:** `lib/routes/lifecycle.ts:69-71` (builds contents lines, omits greeting); `lib/routes/print.ts:84` (printed manifest shows "Greeting card enclosed")
**Claim:** `loadDriverRouteView` builds contents lines but omits the greeting; the printed manifest does show "Greeting card enclosed". A driver on the phone app doesn't know to hand over the card. Minor UX gap vs the printed fallback.

### m12 — Magic stage literal `"SENT"` hardcoded in reroute paths
**Sources:** rules Minor 1
**Location:** `lib/routes/builder.ts:270` (`stage: { not: "SENT" }`); `lib/routes/reroute.ts:53` (`pkg.stage === "SENT"`); cf. `lib/routes/lifecycle.ts:198` (resolves terminal stage dynamically via `pkg.fulfillmentMethod.terminalStage`)
**Claim:** `builder.ts:270` and `reroute.ts:53` hardcode the SHIPPED method's terminal stage name, while the rest of P9 resolves the terminal stage dynamically via `pkg.fulfillmentMethod.terminalStage`. If the SHIPPED method's terminal stage is ever renamed, the SENT exclusion silently breaks and SENT packages become reroute-eligible. Violates: magic values (named constants/enums), type/schema drift (centralize). Recommend referencing the method's `terminalStage` field instead.

### m13 — Reroute read model split across two files
**Sources:** rules Minor 2
**Location:** `lib/routes/builder.ts:258` (`nearbyShippedSuggestions` — the reroute candidate scan, read side); `lib/routes/reroute.ts` (write-side `confirmRouteReroute`, imports the read function back across the boundary)
**Claim:** `nearbyShippedSuggestions` (the reroute candidate scan) lives in `lib/routes/builder.ts:258`, while its write-side counterpart `confirmRouteReroute` lives in `lib/routes/reroute.ts`, which imports the read function back across the boundary. The reroute concern is split between two modules; the reroute read model would sit more naturally beside the write model in `reroute.ts` (or a shared `reroute-queries.ts`). Violates: split files by concern, not by line count.

### m14 — Banned standalone name `result` in P9 call sites
**Sources:** rules Minor 3
**Location:** `lib/bulk/schedule.ts:63` (`const result = await prisma.$transaction(...)`); `lib/routes/lifecycle.ts:172` (same); `app/api/admin/routes/route.ts:35`; `app/(admin)/admin/packages/[packageId]/method-switch.tsx:55`; `app/(admin)/admin/routes/[routeId]/route-actions.tsx:52`; `app/(driver)/drive/[token]/drive-app.tsx` (each `apiFetch`)
**Claim:** `clean-code.mdc` (Naming Conventions) bans `result` as a standalone name. It appears in `lib/bulk/schedule.ts:63`, `lib/routes/lifecycle.ts:172`, and the API/client wrappers. This is an established project-wide convention (`apiFetch` callers everywhere use `result`), so it conflicts with the "one pattern per concern" rule; flagging per the explicit naming ban. Low harm given consistency.

### m15 — `hasAvailableInventory` reads outside the readiness transaction
**Sources:** rules Minor 5
**Location:** `lib/pickup/readiness.ts:67-68` (`hasAvailableInventory(pkg)` on default `prisma` client before the per-package `$transaction`)
**Claim:** `lib/pickup/readiness.ts:67-68` calls `hasAvailableInventory(pkg)` (default `prisma` client) before opening the per-package `$transaction` that stamps `pickupReadyAt` and sends the notification. A restock arriving between the check and the stamp would still produce a correct ready stamp, but a concurrent allocation that takes inventory negative between check and stamp could mark a package ready whose inventory is no longer available. Low-likelihood TOCTOU for a cron sweep; `ponytail.mdc` "Never cut trust-boundary validation" does not require a transaction here, but tightening would be safer.

### m16 — `loadLinkByToken` does not clear `pinFailures`/`pinLockedUntil` on a successful token load
**Sources:** rules Minor 6
**Location:** `lib/routes/links.ts:104-113` (`loadLinkByToken` returns `active` without resetting PIN failure state); `lib/routes/links.ts:144` (`checkPin` resets on a correct PIN)
**Claim:** `loadLinkByToken` returns `active` without resetting PIN failure state on a valid token lookup. `checkPin` resets on a correct PIN (line 144), so a PIN-protected link that loads successfully but whose PIN cookie is already valid never touches `checkPin` and the counters stay as-is. Not a security issue (the lock still expires), but stale `pinFailures` from a previous forwarded-link attack can persist on an active session. Minor.

### m17 — `reprintBatch` `NotFoundError` swallow duplicated between switch and reroute
**Sources:** clean-code Minor 1
**Location:** `lib/routes/switch.ts:189-192`; `lib/routes/reroute.ts:131-134` (both: `await reprintBatch({...}).catch((error: unknown) => { if (error instanceof NotFoundError) return; throw error; })`)
**Claim:** Two sites, identical pattern. The "reprint is best-effort after a method switch/reroute" contract is duplicated, and it's unclear whether `reprintBatch` can legitimately 404 (no printable artifacts) — if not, the catch is dead defensive code. Extract a `reprintBestEffort(orderId, staffId)` helper. Violates: duplicated logic, anti-AI-tics.

### m18 — `byCustomer` grouping loop duplicated between `startRoute` and `scheduleBulkDelivery`
**Sources:** clean-code Minor 2
**Location:** `lib/routes/lifecycle.ts:120-132` (`startRoute`); `lib/bulk/schedule.ts:55-61` (`scheduleBulkDelivery`)
**Claim:** Both build a `Map<customerId, { customer, orderIds: Set, recipients: string[], stopIds/packageIds: [] }>` from a flat list, then iterate it to send one notification per distinct customer. The shapes differ slightly (lifecycle keys on `order.customer.id` and tracks `stopIds`; bulk keys on `pkg.order.customerId`), but the "group by customer, notify once" law is the same and the loop is copy-pasted. A `groupByCustomer<T>(items, getCustomer, getRecipient, getOrderId)` helper would collapse both. Violates: duplicated logic.

### m19 — `assertSwitchable` / `confirmRouteReroute` duplicate the "active stop" and "stuck PURCHASING" pre-flight checks
**Sources:** clean-code Minor 3
**Location:** `lib/routes/switch.ts:54-59` (`assertSwitchable`); `lib/routes/reroute.ts:56-65` (inline block); `lib/routes/switch.ts:73-86` (`assertLabelVoidable`); `lib/routes/reroute.ts` (inline PURCHASING then PURCHASED check)
**Claim:** `assertSwitchable` and `confirmRouteReroute` both find an active route stop on a PLANNED/STARTED route and find a PURCHASING shipment stuck mid-flight, with near-identical error messages. `assertLabelVoidable` and the reroute inline block both then check PURCHASING then PURCHASED. The "package already on an active route" and "label purchase stuck mid-flight" guards are spelled twice with minor wording variations. Extract a shared `assertPackageReroutable(pkg)` helper. Violates: duplicated logic, pattern drift.

### m20 — `DAY_MS` / `24 * 60 * 60 * 1000` magic value spelled four ways across P9
**Sources:** clean-code Minor 4
**Location:** `lib/payments/reminders.ts:18` (`const DAY_MS = 24 * 60 * 60 * 1000;`); `lib/pickup/readiness.ts:126` (inlines `policy.unclaimedAfterDays * 24 * 60 * 60 * 1000`); `lib/pickup/readiness.ts:156` (inlines `policy.expireAfterDays * 24 * 60 * 60 * 1000`); `lib/routes/links.ts:15-17` (inlines `72 * 60 * 60 * 1000` and `10 * 60 * 1000`)
**Claim:** The codebase has a date helper module (P1 helper ladder). Day-in-millis is a magic value spelled four times. Centralize as `MILLIS_PER_DAY` / `MILLIS_PER_HOUR` / `MILLIS_PER_MINUTE` in the dates lib. Violates: magic values, one-pattern-per-concern.

### m21 — `RerouteSuggestion` interface duplicated between `builder.ts` and `route-actions.tsx`
**Sources:** clean-code Minor 6
**Location:** `lib/routes/builder.ts:245-253` (`export interface RerouteSuggestion`); `app/(admin)/admin/routes/[routeId]/route-actions.tsx:12-20` (re-declares a local `interface RerouteSuggestion`)
**Claim:** The API returns the server type; the client re-declaration can drift silently — adding a field server-side won't break the client (silently dropped), removing one won't compile-fail it. Import the shared type. Violates: type/schema drift, one-pattern-per-concern.

### m22 — `DriverStopCard` / `DriverRouteView` duplicated between `lifecycle.ts` and `drive-app.tsx`
**Sources:** clean-code Minor 7
**Location:** `lib/routes/lifecycle.ts:15-31` (declares `DriverStopCard` and `DriverRouteView`); `app/(driver)/drive/[token]/drive-app.tsx:11-27` (re-declares both verbatim)
**Claim:** Same drift class as m21. Violates: type/schema drift.

### m23 — `loadLinkByToken` + PIN-cookie guard duplicated across the three `/api/drive/[token]/*` routes
**Sources:** clean-code Minor 8
**Location:** `app/api/drive/[token]/route.ts:14-25`; `start/route.ts:14-24`; `deliver/route.ts:22-32` (each: load link by token, map `state` to 404/410, then `if (link.pinHash) { const jar = await cookies(); if (!(await verifyPinCookie(...))) return 403 pin_required }`)
**Claim:** Three sites, same ~10-line guard, with the 404/410 status mapping spelled inline three times and slightly different error messages per route. Extract a `requireActiveLink(token)` (returns `{ link } | NextResponse`) and a `requirePinPassed(link)` helper. Violates: duplicated logic, pattern drift.

### m24 — `loadRouteDetail` ships `link.pinHash` to the admin route detail API (least-read)
**Sources:** clean-code Minor 9
**Location:** `lib/routes/builder.ts:176` (selects `link: { select: { id: true, expiresAt: true, pinHash: true, createdAt: true } }`); `app/api/admin/routes/[routeId]/route.ts:17` (returns `route` verbatim); `app/(admin)/admin/routes/[routeId]/page.tsx:50-53` (only reads `expiresAt` and `pinHash !== null`)
**Claim:** The admin route detail API returns the `route` object verbatim, and the route detail page only reads `expiresAt` and `pinHash !== null` (for "PIN protected" display). The `pinHash` value itself is never displayed but is shipped to every staff browser with `fulfillment.manage`. The driver-link module's own comment ("the token hash never leaves the DB — staff see existence + expiry only") is the same honesty class; the PIN hash is a credential hash and shouldn't ride to the client. Project to `hasPin: pinHash !== null` server-side. Violates: least-read, the module's own honesty class.

### m25 — `AuditAction` lags `PackageEventAction` for P9 events (type drift, mirror of P8 m16)
**Sources:** clean-code Minor 10
**Location:** `lib/packages/stages.ts:42-46` (`PackageEventAction` adds `method_switch`, `reroute`, `delivered`, `pickup_ready`, `pickup_expired`); `lib/audit.ts:50-56` (`AuditAction` adds `route_create`, `route_reassign`, `route_link_create`, `route_reroute`, `method_switch`, `bulk_schedule`)
**Claim:** The P9 `PackageEvent` actions `delivered`, `reroute`, `pickup_ready`, `pickup_expired` are NOT in `AuditAction`. Today `recordAudit` is only called for `method_switch`, `route_*`, `bulk_schedule` — so the compiler is happy — but the two unions are out of lockstep for P9, exactly the drift P8 m16 called out. `pickup_ready` / `pickup_expired` / `delivered` are plausible audit candidates (a pickup-ready sweep touching customer packages; a delivered tap via magic link). Keep the two lists in lockstep or derive `AuditAction` from `PackageEventAction`. Violates: type/schema drift, one-typing-discipline-per-concern.

### m26 — Three route loaders (`loadRouteDetail` / `loadDriverRouteView` / `loadRouteForPrint`), no shared base
**Sources:** clean-code Minor 11
**Location:** `lib/routes/builder.ts:158-182` (`loadRouteDetail`); `lib/routes/lifecycle.ts:33-48` (`loadDriverRouteView`); `lib/routes/print.ts:26-46` (`loadRouteForPrint`)
**Claim:** Each runs `prisma.deliveryRoute.findUnique` with a hand-rolled `stops` include selecting a different subset. The shapes are genuinely different (driver view minimizes PII; print needs greeting+lines; admin needs events+link), so a single include is wrong — but the three are unowned and share no base constant. Adding a `RouteStop` field two of three need means editing three queries. At minimum document why each exists; consider a shared `routeStopsBaseInclude` extended per consumer. Violates: pattern drift.

### m27 — `window_` identifier in `bulk-schedule-form.tsx`
**Sources:** clean-code Minor 12
**Location:** `app/(admin)/admin/bulk/bulk-schedule-form.tsx:17` (`const [window_, setWindow] = useState("")`)
**Claim:** `window` is a global, so the trailing underscore avoids the collision — but `window_` reads as a typo. Rename to `deliveryWindow` / `setDeliveryWindow` (the field is the delivery window, per the label "Window (optional)"). Violates: naming (clarity).

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| B1 | quality Blocker 1 ; clean-code Major 2 (Blocker + Major → Blocker) |
| M1 | security Major 1 ; quality Minor 9 (Major + Minor → Major) |
| M5 | quality Minor 7 ; clean-code Major 1 (Minor + Major → Major) |
| m1 | security Minor 1 ; clean-code Minor 5 |
| m6 | quality Minor 5 ; rules Minor 4 |

All other aggregate IDs are single-source. No new findings introduced.

Related-but-distinct pairs kept separate:
- **m1 vs m4** (security): both touch the reroute confirm path's missing checks — m1 is the missing G-023 proximity re-check (geography), m4 is the missing season-scoping on route-side verbs (cross-season). Different claims and locations.
- **m1 vs M5** (clean-code/quality): both touch `nearbyShippedSuggestions` / `builder.ts` — m1 is the confirm path not re-checking the radius (business-rule enforcement), M5 is the unbounded geocode/haversine work on the scan side (performance/scale). Different sides of the reroute flow.
- **M2 vs m4** (quality/security): both touch season-closing edge cases — M2 is `markStopDelivered` silently skipping the stage advance when the season closes mid-route (delivery side), m4 is reroute/link create not scoping the route to the open season (route side). Different locations and claims.
- **m12 vs m1** (rules/security+clean-code): both touch the `"SENT"` / reroute-eligibility area — m12 is the hardcoded `"SENT"` literal (magic value/drift), m1 is the confirm path not re-checking the radius (business-rule enforcement). Different defects.
- **m25 vs P8 m16** (clean-code): both are the `AuditAction` lags `PackageEventAction` type drift — m25 is the P9 extension (mirror of P8 m16). Same defect class, different phase's events; flagged so the P12 typing-discipline pass knows the drift persisted across P8→P9.
- **m17/m18/m19 vs m2/m13** (clean-code): all touch reroute/switch duplication — m17 is the `reprintBatch` catch, m18 is the `byCustomer` grouping loop, m19 is the `assertSwitchable`/`confirmRouteReroute` pre-flight checks (all duplicated logic between switch.ts and reroute.ts); m2 is the pickup-stamp readiness gate, m13 is the reroute read-model split across builder.ts/reroute.ts. Distinct duplication claims.

## Pass notes (not counted)

- **Driver route-scoping IDOR** (security PASS): `markStopDelivered` (`lib/routes/lifecycle.ts:166`) takes `routeId` from the link (not the body) and validates `stopId` against `route.stops` — a driver cannot touch another route's stops. No finding.
- **PIN cookie cross-link reuse** (security PASS): `verifyPinCookie` (`lib/routes/links.ts:160`) binds the cookie to `linkId` and the link's own expiry; a cookie issued for link A fails the `cookieLinkId !== linkId` check for link B. No finding.
- **Cron CSRF on GET-with-bearer** (security PASS): the Authorization header is the CSRF guard; browsers do not attach it cross-origin without credentials, and a headerless `<img>`-style GET hits the 401 before any mutation. No finding.
- **Method-switch money path (UR-002)** (security PASS): `switchPackageMethod` (`lib/routes/switch.ts:134`) preserves the customer charge via `preservedChargeCents` (frozen recipient `deliveryFeeCents` snapshots), requires `confirmVoid: true` before voiding a purchased label, refuses terminal/active-route packages, and writes an audit row with the preserved fee. The "org eats the shipping-vs-delivery cost difference" is the specified UR-002 behavior, not a money-path bug. (The void-outside-tx ordering is B1, raised separately.)
- **Dev outbox / shippo-fixture routes** (security PASS): `isDevAuthBypass` hard-disables on `VERCEL_ENV === "production" | "preview"`. Correct.
- **`fulfillment.manage` IDOR on `[packageId]`/`[routeId]` paths** (security PASS): single-org model, manager-tier authz, cuid ids, open-season domain scoping on the package side. No finding. (m4 is the route-side season-scoping gap, raised separately.)
- **Magic-link design** (security PASS, with M1 + m5 gaps): the 256-bit token is stored only as a SHA-256 hash, the route view minimizes stop PII (recipient/address/contents — no customer contact PII), the link expires on route completion, and every Delivered tap is audited with the link id. The residual URL-path exposure (m5) is the accepted magic-link risk; the PIN (M1) and 72h TTL exist as the named mitigations.
- **Cron bearer gate** (security PASS, with m3 gap): `isCronAuthorized` fails closed when `CRON_SECRET` is unset and uses a constant-time compare; the four cron routes all gate on it and write a `CronRun` row with OK/FAILED + message — one cron pattern, applied consistently. m3 is the length-pre-check timing oracle, raised separately.
- **Reroute confirm auth** (security PASS): `confirmRouteReroute` gates on `requireApiPermission("fulfillment.manage")` and requires explicit `confirm: true`. m1/m4 are business-rule enforcement gaps behind that auth, not privilege escalations.
- **Coverage** (rules PASS): all five P9 EXPECTED checklist items and all five smoke checks (S1–S5) have corresponding code paths; smoke S1–S5 pass 30/0. No stubs; the Mapbox/Google/Resend/Twilio seams are honest (nearest-neighbor + dev geocoder + outbox capture). The keystone laws hold: hashed magic-link tokens, per-customer day-of grouping, atomic Delivered claim, manager-confirmed reroute, SENT refusal, label void on method switch, pickup-ready-once, bearer-guarded crons.
- **Codegraph rule** (rules PASS): the arm's `.codegraph/` index exists; init obligation met.
- **Vocabulary rule** (rules PASS): no command-scope words in the reviewed artifacts.
- **No secrets committed** (rules PASS): `.env` is gitignored; `.env.example` carries placeholders only.

## Bottom line

No Critical. P9 arm-06 is functionally complete against EXPECTED (all five items implemented, smoke S1–S5 pass 30/0, domain suite green). The single Blocker (B1) is a real money-path integrity regression on the reroute/method-switch path that the smoke and domain suites do not exercise — `voidLabel` commits an irreversible external Shippo call before the local flip transaction, so a crash between the two leaves the org billed for a void with a SHIPPED package that can't ship or reroute. The 6 Majors cluster on the driver-link credential (M1 — PIN throttle covers ~21.6% of the space over the link lifetime), the season-closing stage-skip (M2), bulk re-notify idempotency (M3), the `route_stops` RESTRICT discard hole (M4), the unbounded reroute-scan geocoding (M5), and the misleading 404 for closed-season packages (M6). The 27 Minors are business-rule enforcement gaps (m1, m2, m4), info-leak/hygiene (m3, m5, m24), duplication (m17, m18, m19, m23), type/schema drift (m21, m22, m25, m26), magic values (m12, m20), and operational/UX cleanups (m7, m8, m9, m10, m11, m13, m14, m15, m16, m27). The P8 m16 `AuditAction` drift persists into P9 (m25); the P8 money-path Majors (stuck PURCHASING, unreconciled void refund) are not regressed, but B1 is a new money-path integrity gap on the same Shippo void seam. Out-of-scope items (P10 auto-flip, P11 notifications dispatch, P12 reconciliation) are correctly deferred; B1, M3, M4, and m10 explicitly tee up P11/P12 work.

