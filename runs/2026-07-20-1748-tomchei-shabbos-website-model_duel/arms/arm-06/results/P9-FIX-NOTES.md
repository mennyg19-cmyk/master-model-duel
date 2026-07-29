# P9 Fix-Notes — arm-06

Single fix pass against `AGGREGATE-REVIEW-P9.md`. **Fixed: 1/1 blocker, 6/6 majors, 25/27 minors. Deferred: m5 (the review's own accepted risk), m10 (presentational counter drift).**

## Blocker

- **B1 — label void + channel flip not atomic.** Restructured both `voidLabel` (`lib/shipping/labels.ts`) and the switch/reroute paths (`lib/routes/switch.ts`, `lib/routes/reroute.ts`) around one shape: every guard runs first, then the single irreversible carrier call (`requestLabelVoid`), then ONE local transaction commits the void marking + channel flip + stop write + events + audit. A crash between carrier success and local commit persists the refund id on the row (`persistVoidRefundMarker`), a retry resumes from that marker WITHOUT a second carrier call (`usableStoredRefund`), and `sweepShippingMaintenance` reconciles even without a retry (new `resumedVoidCrashes` leg — only refunds that still stand: QUEUED/PENDING/SUCCESS; an ERROR refund is the rejected-voids leg's deliberate revert and is never re-voided). Pinned by smoke S6b (marked crash → sweep completes, shipment VOIDED) and domain test "B1: the sweep resumes a crashed void from the stored refund id".

## Majors

- **M1 — PIN throttle had no escalation (2 160 guesses per link lifetime).** `DriverRouteLink.pinLockCount` (new column, migration `20260729090000_p9_fix_pass`) counts lifetime locks; `checkPin` escalates the lock window per lock (10 min → 20 → 40, capped 12 h; 6 locks = rotation-only). Clearing the window never clears the count — a correct PIN resets attempts but the escalation survives, so the 72h budget collapses from ~2 160 to ~25 guesses. Pinned by smoke S6c (second lock doubles to ~20 m after a window clear; rotation still heals) and domain tests "M1: the second lock escalates" / "lifetime lock count never resets".
- **M2 — `markStopDelivered` refused to advance the package once the season closed.** The stale `getOpenSeason` guard is gone — a route that outlives its season still stamps every stop, advances each package to its method terminal, and completes the route. Pinned by smoke S6f (season closed → deliver → SENT + route COMPLETED).
- **M3 — bulk re-schedule re-notified already-told customers.** `scheduleBulkDelivery` now dedupes per (customer, deliveryDay): a later drop onto an already-notified day adds the package silently (`reNotifySkipped` in audit metadata); a genuinely new day still notifies once. Pinned by smoke S6a (same day: package +1, outbox +0) / S6a2 (new day: email + SMS once) and both M3 domain tests.
- **M4 — `route_stops.packageId` RESTRICT blocked draft-discard of routed packages.** FK flipped to `ON DELETE CASCADE` (same migration) — the stop dies with its package, which is the only honest outcome. Pinned by smoke S6e (discarding the rerouted package's order cascaded its stop; route C went 2 → 1).
- **M5 — `nearbyShippedSuggestions` unbounded (N geocodes + N×stops haversines).** Two-stage pre-filter: same-street matches short-circuit BEFORE any geocode, and the radius law can only hold within a stop's postal code (0.5 mi never crosses a postal boundary), so only postal-matching candidates pay a geocode. Pinned by domain test "M5: a postal-mismatched candidate is excluded WITHOUT spending a geocode".
- **M6 — closed-season targets 404'd like missing rows.** `loadShippedPackage`, `loadSwitchable`, and the reroute loaders now throw `DomainRuleError` (422 with a "closed season" message) instead of `NotFoundError` (404) — a closed season is a domain rule, not an absence. Pinned by smoke S6f (closed-season switch → 422).

## Minors (25 of 27 fixed)

- **m1** `confirmRouteReroute` re-verifies the G-023 geography law (same-street or ≤ radius of a stop) at accept time — a stale suggestion list can never pull a far package; `REROUTE_SUGGESTION_RADIUS_MILES` moved to `lib/routes/geo.ts` beside `haversineMiles`. Smoke S6d (self-calibrated far address → 422, package untouched).
- **m2** `advancePackageStage` gates `PICKED_UP` on `pickupReadyAt` (placed after the optimistic version claim so concurrency errors keep precedence — domain-pinned).
- **m3** `isCronAuthorized` compares fixed-length SHA-256 hashes of both sides — the 401 timing can never leak the secret's length.
- **m4** route-side season scoping: `confirmRouteReroute` asserts same season + open route season; `createDriverLink` refuses a closed-season route.
- **m6** day-of and bulk outbox metadata now records ALL `orderIds`, not just the first.
- **m7** `loadFollowUps?reason=bulk` aggregates customers across ALL of the season's bulk schedules, not just the latest.
- **m8** `reassignStop` is update-in-place (routeId + re-seq) — the stop id survives, no dangling event references.
- **m9** reminder sweep's `candidates` count reflects only orders eligible after the outstanding-balance check.
- **m11** driver stop cards carry the `greeting` flag; the app shows "Greeting card enclosed" (parity with the printed manifest). Smoke S1f2.
- **m12** reroute eligibility resolves `pkg.fulfillmentMethod.terminalStage` dynamically — no hardcoded `"SENT"`.
- **m13** `nearbyShippedSuggestions` + `RerouteSuggestion` moved into `reroute.ts` beside the write model.
- **m14** banned standalone `result` renamed in the P9 lib/server spellings (`schedule.ts`, `lifecycle.ts`, `admin/routes/route.ts`); the client `apiFetch` call sites keep the app-wide convention per the review's own consistency note.
- **m15** `syncPickupReadiness` runs `hasAvailableInventory` inside the per-package transaction.
- **m16** a valid PIN cookie clears stale `pinFailures`/`pinLockedUntil` on link load (`clearStalePinFailures`) — the lifetime lock count stays.
- **m17** `reprintBestEffort` helper owns the "reprint may legitimately 404 after a flip" contract (documented why the catch is live).
- **m18** `groupByCustomer` helper (`lib/notify/by-customer.ts`) owns the "group by customer, notify once" law for both `startRoute` and `scheduleBulkDelivery`.
- **m19** `assertOffActiveRoute` / `assertNoStuckPurchase` shared pre-flight between switch and reroute.
- **m20** `MILLIS_PER_MINUTE/HOUR/DAY` in `lib/dates.ts`; the four spellings across links/readiness/reminders/follow-ups use them.
- **m21** `route-actions.tsx` imports the shared `RerouteSuggestion` type.
- **m22** `drive-app.tsx` imports the shared `DriverRouteView` type.
- **m23** `requireActiveLink` (`app/api/drive/[token]/guard.ts`) owns the load + 404/410 mapping + PIN-cookie guard for all three drive routes.
- **m24** `loadRouteDetail` projects `link.hasPin` server-side — the PIN hash never rides to staff browsers.
- **m25** `AuditAction` extended in lockstep with the P9 `PackageEventAction` members (`reroute`, `delivered`, `pickup_ready`, `pickup_expired`).
- **m26** the three route loaders carry a doc note on why each shape exists (least-read driver view vs print vs admin).
- **m27** `window_` renamed `deliveryWindow` in the bulk schedule form.

## Deferred (with why)

- **m5 — magic-link token in the URL path.** The review itself classifies this as "an accepted risk, not a defect" — inherent to magic-link design, acknowledged in the plan's risk register, and already mitigated (SHA-256 hash at rest, 72 h TTL, expiry on completion, `rel="noreferrer"` on the Maps links, M1's escalating PIN as the second barrier). Changing the transport (fragment/carrier page) would redesign the feature, not fix it.
- **m10 — schedule `packageCount/customerCount` can drift high on package delete.** The review calls this low-impact and presentational: `bulk_delivery_schedule_items` is the source of truth and the counts display only. An honest fix is either denormalized count maintenance on every delete path or deriving the counts at read time (schema + read-model change) — out of proportion for a cosmetic nit inside a single fix pass.

## Verification

- Gates: `lint` clean · `typecheck` clean · `migration-guard: ok (16 migrations, in sync)` · `test:unit` all pass · `test:domain` all pass (P9 suite now 58 checks, incl. new B1/M1/M3/M5/m1/m2 pins) · `build` clean.
- Smoke: `smoke-p9.ps1` **37/37 PASS, 0 failures** against the production build — original S1–S5 regression legs plus new S1f2 + S6a–S6f legs pinning B1, M1, M2, M3, M4, M6, m1, m11 end-to-end over HTTP (crash-resume via the real cron route, PIN escalation measured off real 429 `retryAt` headers, FK cascade proven by deleting a routed package's order).
