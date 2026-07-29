# P9 Security Review — arm-06 (blind)

**Phase:** P9 — Delivery routes, driver magic links, reroute, pickup, bulk delivery scheduling
**Scope:** `lib/routes/*` (links, lifecycle, builder, reroute, switch, events, geo), `lib/pickup/readiness.ts`, `lib/bulk/schedule.ts`, `lib/payments/reminders.ts`, `lib/cron-auth.ts`, `app/api/drive/[token]/*`, `app/api/admin/routes/[routeId]/*`, `app/api/admin/pickup/*`, `app/api/admin/bulk-schedules/*`, `app/api/admin/follow-ups/*`, `app/api/admin/packages/[packageId]/switch|advance/*`, `app/api/cron/pickup-expiry|payment-reminders/*`, `app/(driver)/drive/[token]/*`, env/secrets.
**Reviewer:** Security specialist (blind — no model name).
**Method:** Findings only, no fixes. Trust boundaries, auth, secrets, IDOR, injection, money-path integrity. Focus: driver magic-link tokens/PIN, route scoping IDOR, cron bearer auth, method-switch/reroute money paths, pickup stamp auth.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 5 |

The P9 trust boundary is mostly sound. The driver magic link stores only a SHA-256 of the 256-bit token, scopes every read/mutation to the link's own route (the `stopId` is validated against `link.route.id` inside `markStopDelivered`, so a driver cannot touch another route's stops — no IDOR), minimizes stop data to recipient/address/contents (no customer contact PII), expires on route completion, and audits every Delivered tap with the link id. Admin route/reroute/switch/pickup/bulk endpoints all gate on `requireApiPermission("fulfillment.manage")`. The cron bearer gate fails closed when `CRON_SECRET` is unset and uses a constant-time compare. The method switch preserves the customer charge and writes an audit row with `preservedFeeCents`. The findings below are throttle adequacy and business-rule enforcement gaps, not auth bypasses.

## Major

### M1 — PIN throttle is inadequate for a 4-digit PIN over the 72h link lifetime

`lib/routes/links.ts:15-17` sets `LINK_TTL_MS = 72h`, `PIN_MAX_FAILURES = 5`, `PIN_LOCK_MS = 10min`. `checkPin` (links.ts:123) increments `pinFailures` per wrong guess, locks for 10 minutes on the 5th failure, and **resets the counter to 0 on lock** (`pinFailures: locksNow ? 0 : failures`). There is no exponential backoff, no permanent lockout, and no per-IP throttle — the only control is the per-link 5-attempts-then-10-min-lock cycle.

The PIN is a 4-digit space (10 000 values, `isPinFormat` links.ts:32). The lockout cadence yields 5 attempts per 10 minutes = 30/hour. Over the 72h link TTL the budget is `72 × 6 × 5 = 2 160` guesses — **~21.6% coverage of the PIN space within a single link's lifetime**, at a constant rate with no escalation. The PIN is the *only* barrier once the unguessable URL token leaks (forwarded text, shared-device browser history, server access log) — exactly the leakage scenario the plan's risk register calls out, where "throttle PIN attempts" is the named mitigation. A ~1-in-5 success probability against the stated mitigation over a 3-day window is too high for a credential protecting recipient addresses and delivery audit integrity.

The same 4-digit PIN is also trivially brute-forceable offline if the `pinHash` column leaks (SHA-256 of `drive-pin:${routeId}:${pin}` — the routeId cuid is a salt, but 10 000 candidates is milliseconds regardless of salt); the online throttle is the only meaningful control, and it is the one that is weak.

## Minor

### m1 — Reroute confirm does not re-verify the G-023 proximity / same-street invariant

`app/api/admin/routes/[routeId]/reroute/route.ts` POST passes an arbitrary `packageId` to `confirmRouteReroute` (`lib/routes/reroute.ts:27`). The confirm path validates: route is `PLANNED`, package is `SHIPPED`, stage ≠ `SENT`, not on an active route, not stuck `PURCHASING`. It does **not** re-check that the package's destination is within `REROUTE_SUGGESTION_RADIUS_MILES` (0.5) of a stop or on the same street cluster — that filter lives only in `nearbyShippedSuggestions` (`lib/routes/builder.ts:258`), the GET side. A manager holding `fulfillment.manage` can pull any qualifying shipped package onto any planned route regardless of geography, bypassing the G-023 "nearby" invariant. Behind manager auth + explicit `confirm: true`, so this is a business-rule enforcement gap, not a privilege escalation.

### m2 — Pickup stamp (advance to `PICKED_UP`) does not gate on `pickupReadyAt`

The "picked-up stamp" is the package stage advance endpoint `POST /api/admin/packages/[packageId]/advance` with `to: "PICKED_UP"`. `advancePackageStage` (`lib/packages/stages.ts:105`) enforces the transition is legal per the method's stage list — so only a PICKUP-channel package (whose method stages include `PICKED_UP`) can be stamped, which correctly prevents stamping a delivery package as picked-up. However, there is **no check that `pickupReadyAt` is set**. A staff member with `fulfillment.manage` can stamp a package `PICKED_UP` before `syncPickupReadiness` ever ran, so the ready notification (`pickup_ready`) never fires and the door list never showed it — the readiness/door-list invariant is bypassable. Same permission tier as the readiness sweep, so it is an operational-rule gap, not an authz one.

### m3 — `isCronAuthorized` length-pre-check leaks `CRON_SECRET` length via timing

`lib/cron-auth.ts:14` short-circuits with `auth.length === expected.length` before calling `timingSafeEqual`. The 401 response is returned either way, but the branch lets a remote caller distinguish "wrong length" from "right length, wrong content" by timing the 401, revealing the length of `Bearer ${CRON_SECRET}` and thus the secret's length. Length alone does not recover the secret's content, so the impact is low, but the standard fix (compare hashes of both sides, or feed unequal-length strings into a constant-time loop) removes the oracle entirely.

### m4 — Reroute / link / advance endpoints do not verify the target belongs to the open season

`confirmRouteReroute` (`lib/routes/reroute.ts:36`) loads the route by `id` with no `seasonId` filter and checks only `pkg.order.season.status === "OPEN"` — it does not assert `pkg.order.seasonId === route.seasonId`. `createDriverLink` (`lib/routes/links.ts:53`) likewise loads the route by `id` and checks only `route.status !== "COMPLETED"`. `advancePackageStage` does scope the package to the open season, but the route-side verbs (reroute, link create) accept a `routeId` from any season. If a stale `PLANNED` route from a prior season ever exists, a manager could pull an open-season shipped package onto it or issue a driver link for it. Routes are normally `COMPLETED` once a season closes, so this is an edge case, but the season-scoping check is missing on the route side.

### m5 — Magic-link token carried in the URL path is logged in browser history and server access logs

The 256-bit token lives in the path (`/drive/[token]`), so it is captured in the driver's browser history, any reverse-proxy / Vercel access log, and any analytics the page is routed through. This is inherent to magic-link design and is acknowledged in the plan's risk register ("Magic-link leakage") with mitigations present here: the token is stored only as a SHA-256 hash, the route view minimizes stop PII, the link expires on completion, and the Google Maps deep links use `rel="noreferrer"` so the token is not leaked to Google via the Referer header. Noted for completeness as an accepted risk, not a defect — the residual exposure is the reason the PIN (M1) and the 72h TTL exist at all.

## Out of scope / explicitly not findings

- **Driver route-scoping IDOR on `deliver`/`start`**: `markStopDelivered` (`lib/routes/lifecycle.ts:166`) takes `routeId` from the link (not the body) and validates `stopId` against `route.stops` — a driver cannot touch another route's stops. No finding.
- **PIN cookie cross-link reuse**: `verifyPinCookie` (`lib/routes/links.ts:160`) binds the cookie to `linkId` and the link's own expiry; a cookie issued for link A fails the `cookieLinkId !== linkId` check for link B. No finding.
- **Cron CSRF on GET-with-bearer**: the Authorization header is the CSRF guard; browsers do not attach it cross-origin without credentials, and a headerless `<img>`-style GET hits the 401 before any mutation. No finding.
- **Method-switch money path (UR-002)**: `switchPackageMethod` (`lib/routes/switch.ts:134`) preserves the customer charge via `preservedChargeCents` (frozen recipient `deliveryFeeCents` snapshots), requires `confirmVoid: true` before voiding a purchased label, refuses terminal/active-route packages, and writes an audit row with the preserved fee. The "org eats the shipping-vs-delivery cost difference" is the specified UR-002 behavior, not a money-path bug.
- **Dev outbox / shippo-fixture routes**: `isDevAuthBypass` hard-disables on `VERCEL_ENV === "production" | "preview"`. Correct.
- **`fulfillment.manage` IDOR on `[packageId]`/`[routeId]` paths**: single-org model, manager-tier authz, cuid ids, open-season domain scoping on the package side. No finding.
