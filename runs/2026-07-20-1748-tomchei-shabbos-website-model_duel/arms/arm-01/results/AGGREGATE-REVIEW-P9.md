# P9 Aggregate Review — arm-01

**Phase:** P9 — delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling
**Scope:** `arms/arm-01/workspace/` P9 touch-points only.
**Inputs:** `P9-security-arm-01.md`, `P9-quality-arm-01.md`, `P9-rules-arm-01.md`, `P9-clean-code-arm-01.md`
**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings.

## Counts

| Severity | Count |
|---|---|
| Blocker (security) | 1 |
| Major (High + Medium) | 21 |
| Minor (Low + Info) | 22 |
| **Total** | **44** |

Source roll-up before dedupe: Security 8, Quality 17, Rules 13 (incl. 2 Info), Clean-code 15 = 53 raw findings. 9 duplicates merged.

## Blocker (security)

### B1 — Driver magic-link bearer token carried in URL path
`src/app/api/driver/routes/[token]/route.ts`, `src/app/(driver)/driver/routes/[token]/page.tsx`, `src/domain/delivery.ts:137`
Sources: Sec H1.

The magic link is the sole credential for an unauthenticated endpoint and sits in the URL path. Token is 32 random bytes base64url with only SHA-256 stored, but the raw token transits and persists in server/platform access logs, browser history on the driver's phone, and any proxy/WAF/analytics pipeline. 7-day lifetime; when no PIN is set (the default), possession alone grants stop data and mark-delivered. Residual exposure is persistent bearer-token leak via logs/history.

## Major — High

### A-H1 — Swallowed catch in driver route API reports any failure as "completed"
`src/app/api/driver/routes/[token]/route.ts:35-39`, `src/components/driver-route.tsx:40-44`
Sources: Q H2, R H1, CC #2.

`try { ... } catch { return { completed: true } }` masks every failure (PIN lock, expired link, DB error) as "Route complete. This link is now expired." Only the true COMPLETED path should map to `completed: true`.

### A-H2 — `domain/delivery.ts` is a god file (632 lines, 7 concerns)
`src/domain/delivery.ts`
Sources: R H2, CC #1.

Bundles geocoding+Mapbox cache, route CRUD, driver magic-link auth+PIN throttle, route start+day-of notification, stop delivery+completion, fulfillment-method switch+label void, nearby reroute, pickup, bulk delivery, and crons. Both split triggers fire (>500 lines, mixed concerns).

### A-H3 — Expired pickups can still be stamped `PICKED_UP`
`src/domain/delivery.ts:533` (`stampPickup`), `src/components/delivery-operations.tsx:202`
Sources: Q H1.

`stampPickup` checks `pickupReadyAt` but never `pickupExpiredAt`; staff can override the expiry cron. Smoke never stamps an expired package.

### A-H4 — `confirmRouteReroute` does not check route status
`src/domain/delivery.ts:447`
Sources: Q H3.

Adds a stop and bumps `printRevision` without verifying the route is `PLANNED`/`IN_PROGRESS`; a reroute can be confirmed against a `COMPLETED` route.

### A-H5 — `markStopDelivered` has no row-level concurrency guard
`src/domain/delivery.ts:195,312`
Sources: Q H4.

Stop update is an unconditional `update` with no `where: { id, status: "PENDING" }`. Two concurrent taps both write `DELIVERED`, both create a `DriverDeliveryAudit` row, and the second `remaining === 0` can re-fire the COMPLETED transition.

## Major — Medium

### A-M1 — Weak optional second factor; per-link-only PIN throttle
`src/domain/delivery.ts:226-238`
Sources: Sec M1.

PIN optional, 4 digits, throttle per-link (5/15min), `failedAttempts` resets on success. No IP/token-global rate limit; 10k space exhaustible over 7-day window; no 2FA on PIN-less links.

### A-M2 — Missing audit trail for pickup-ready and bulk scheduling
`src/domain/delivery.ts:489-531,558-582`; `src/app/api/admin/delivery/route.ts:115-126`
Sources: Sec M2.

`markPickupReady` and `scheduleBulkDelivery` accept no `actorStaffId` and write no `packageAudit`/`auditLog`; the API drops the session for these two actions.

### A-M3 — `assignedDriverId` not validated as an active driver
`src/domain/delivery.ts:118-171,173-193`; `src/app/api/admin/delivery/route.ts:84-98`
Sources: Sec M3.

API accepts any string; no check that the `StaffUser` exists, has `role: DRIVER`, or `status: ACTIVE`.

### A-M4 — `switchFulfillmentMethod` delivery→shipping orphans the `DeliveryStop`
`src/domain/delivery.ts:345`
Sources: Q M1.

Changes `fulfillmentMethodId`/`groupingKey` but never removes the existing `DeliveryStop`; route still lists a now-shipping package. API-only surface (UI filters it out).

### A-M5 — `markPickupReady` checks inventory but does not reserve it
`src/domain/delivery.ts:505`
Sources: Q M2.

Gates on `onHand - reserved >= quantity` but never increments `reserved`; two pickups for a single on-hand unit both pass and both notify.

### A-M6 — `accessDriverRoute` lockout reset-on-success only; no operator unlock
`src/domain/delivery.ts` (lockout path)
Sources: Q M3.

A driver who locks mid-route cannot recover without a DB-side reset; not exposed to operators.

### A-M7 — `MAPBOX_ACCESS_TOKEN` read directly, bypassing the env helper
`src/domain/delivery.ts:83`, `src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx:28`, `src/lib/cron-auth.ts:4`
Sources: R M1.

Arm owns `readServerEnvironment()` in `src/lib/env.ts:28-47` (token declared at line 16); two env-access patterns now coexist.

### A-M8 — Mapbox token in `<img src>` without least-privilege gate
`src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx:28-33`
Sources: R M2. Related: A-L4 (leakage angle).

Token rendered into a public `mapUrl` for any `admin:view` session; sibling `GET /api/admin/delivery` requires `orders:manage`. No authz gate on the image.

### A-M9 — Two competing error-handling patterns in `delivery-operations.tsx`
`src/components/delivery-operations.tsx:54-101`
Sources: R M3.

`run(body, success)` wraps `post` in try/catch, `createRoute` re-wraps `post`, `loadSuggestions` does a third inline fetch. Three error shapes in one component.

### A-M10 — Flat 409/401 for every non-access error in admin & driver API
`src/app/api/admin/delivery/route.ts:69-73,127-135`, `src/app/api/driver/routes/[token]/route.ts:42-47`
Sources: R M4, Q L9, Q L10, CC #3.

Maps Prisma `P2025` not-found, Mapbox outages, DB failures, malformed JSON, and expired links all to 409 (admin) / 401 (driver). Wrong status semantics; one pattern but wrong mapping.

### A-M11 — PIN shape duplicated (domain + Zod)
`src/domain/delivery.ts:131`, `src/app/api/admin/delivery/route.ts:23`
Sources: CC #6.

`/^\d{4}$/` hard-coded in two places; changing one lets a 5-digit PIN past the other.

### A-M12 — Inconsistent HTTP response helper (NextResponse vs Response)
`src/app/api/cron/pickup-expiry/route.ts`, `src/app/api/cron/payment-reminders/route.ts`
Sources: CC #7.

Admin routes use `NextResponse.json`; cron routes use `Response.json`. Pick one per concern.

### A-M13 — Vague / banned names
`src/domain/delivery.ts:406` (`value`), `src/components/delivery-operations.tsx:54,39` (`run`, `post`), `src/components/driver-route.tsx:25` (`act`)
Sources: CC #8.

`value` is the haversine `sin²` term; `run`/`post`/`act` describe nothing.

### A-M14 — Type drift on `addressSnapshot`
`src/domain/delivery.ts:25-41` (and 4 other readers)
Sources: CC #9.

`addressText` takes `Prisma.JsonValue`, casts to `Record<string, Prisma.JsonValue>` with no runtime check; a snapshot missing `line1` is silently filtered away and geocoded partial. Five readers, zero shared type.

### A-M15 — Repeated UI class strings
`src/components/delivery-operations.tsx`, `src/app/(admin)/admin/delivery/page.tsx`, `src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx`
Sources: CC #11.

`rounded-3xl border border-[var(--border)] bg-white p-6` 5+ times; `rounded-xl border p-3` and `rounded-lg border px-3 py-2 font-bold` repeat. Rule of 2 met many times over.

### A-M16 — Raw JSON address dump in admin route detail
`src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx:68`
Sources: CC #12.

Renders `{JSON.stringify(stop.package.addressSnapshot)}` while the driver card uses formatted `stop.address`. Drifts from the established pattern.

## Minor — Low

### A-L1 — Cron routes are GET with side effects
`src/app/api/cron/pickup-expiry/route.ts`, `src/app/api/cron/payment-reminders/route.ts`
Sources: Sec L1.

GET handlers mutate state; wrong verb + cacheable by intermediaries. Bearer auth fails closed, so method hygiene only.

### A-L2 — Raw error messages echoed to clients
`src/app/api/driver/routes/[token]/route.ts:42-47`, `src/app/api/admin/delivery/route.ts:65-73,127-135`
Sources: Sec L2. Related: A-M10 (status codes).

`error.message` returned verbatim; on the unauthenticated driver endpoint this enables state enumeration (expired vs wrong PIN vs locked vs internal).

### A-L3 — `scheduleBulkDelivery` has no stage/method guard
`src/domain/delivery.ts:558-582`
Sources: Sec L3.

No check that the package is active, is a delivery method, or is in a schedulable stage. Business-logic bypass.

### A-L4 — Mapbox `pk.` token in admin `<img src>` (HAR/screenshot leak)
`src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx:28-53`
Sources: Sec L4. Related: A-M8 (authz angle).

Public `pk.` token ships in page HTML; bounded but present in screenshots, HAR captures, proxy logs.

### A-L5 — `findNearbyShippingPackages` capped at `take: 200`
`src/domain/delivery.ts:428`
Sources: Q L1, CC #5.

Silent truncation; no pagination, no operator warning.

### A-L6 — `sendPaymentReminders` capped at `take: 500` and not season-scoped
`src/domain/delivery.ts:619`
Sources: Q L2, CC #5.

Reminds first 500 finalized unpaid/partial orders across all seasons; closed seasons not excluded.

### A-L7 — `confirmRouteReroute` writes no route-level `AuditLog`
`src/domain/delivery.ts:447`
Sources: Q L3.

Bumps `printRevision` and writes a `PackageAudit` via `switchFulfillmentMethod` but no route-level `AuditLog` (contrast create/reassign).

### A-L8 — `markPickupReady` writes no `PackageAudit`
`src/domain/delivery.ts:489-531`
Sources: Q L4.

`stampPickup` and `expireUnclaimedPickups` write `PackageAudit`; the "ready" transition is unattributed.

### A-L9 — `switchFulfillmentMethod` grows `groupingKey` indefinitely
`src/domain/delivery.ts:379`
Sources: Q L5.

Each switch appends `:method:${Date.now()}`; unbounded string growth on a unique key.

### A-L10 — Print route page has no `@media print` styling
`src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx`
Sources: Q L6.

Only hides nav when `print=1`; no `@media print` rules or page-break hints beyond per-card `break-inside-avoid`.

### A-L11 — S2 smoke does not exercise "completable from printed fallback only"
`scripts/p9-smoke.ts:308-317`
Sources: Q L7.

Asserts the print HTML contains the stop list and Maps URL, but never drives a delivery from the printed fallback alone.

### A-L12 — Cron routes do not record a `CronRun`
`src/app/api/cron/pickup-expiry/route.ts`, `src/app/api/cron/payment-reminders/route.ts`
Sources: Q L8.

Schema has a `CronRun` model; P9 crons don't use it, so duplicate invocations aren't deduplicated at the job level.

### A-L13 — Geocode-cache create/update object literal duplicated
`src/domain/delivery.ts:96-114`
Sources: R L1, CC #4.

Same four fields repeated in both `upsert` branches; a shared `cachePayload` would remove the duplication.

### A-L14 — `sameStreet` heuristic non-obvious, uncommented, fragile
`src/domain/delivery.ts:430-444`
Sources: R L2, CC #10.

`slice(1)` drops the house number; no comment; no handling of multi-token house numbers or "no house number."

### A-L15 — Inline magic durations / unnamed magic numbers
`src/domain/delivery.ts:104,112,518,411,234,428,619`
Sources: R L3, CC #4, CC #5.

30-day geocode TTL (twice), 14-day pickup expiry, earth radius `3958.8`, PIN threshold `5`, caps `200`/`500` — all inline. Top-of-file constants show the established pattern.

### A-L16 — Hardcoded back link
`src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx:38`
Sources: R L4.

`<a href="/admin/delivery">` instead of a `BackLink` with fallback (P8 pattern); no documented exception.

### A-L17 — `@vercel/blob` declared with a floating range
`package.json:29`
Sources: R L5.

`^2.6.1` is the only floating caret; every other dependency is pinned exact.

### A-L18 — Stale name in smoke fixture
`scripts/p9-smoke.ts:30`
Sources: CC #13.

`authSecret = "p5-local-smoke-signing-key-2026"` — `p5-` prefix is P5 copy-paste leftover.

### A-L19 — Default-first-method index pattern
`src/components/delivery-operations.tsx:166,183,201`
Sources: CC #14.

`deliveryMethods[0]?.id`, `shippingMethods[0]`, `pickupLocations[0]!.id` as implicit targets for switch/reroute/pickup-ready; no UI to choose.

### A-L20 — Magic bulk-schedule offsets in component
`src/components/delivery-operations.tsx:189`
Sources: CC #15.

`86_400_000` and `90_000_000` ms (~1.04 days) inline for "Schedule tomorrow"; unnamed, not obviously "tomorrow + window."

## Minor — Info

### A-I1 — Near-identical cron route handlers
`src/app/api/cron/pickup-expiry/route.ts`, `src/app/api/cron/payment-reminders/route.ts`
Sources: R I1.

Same 10-line handler differing only in the domain function; rule of 2 exactly met. Leaving duplicated is defensible.

### A-I2 — `startDeliveryRoute` overwrites `dayOfNotificationsAt` on every call
`src/domain/delivery.ts:275`
Sources: R I2.

Unconditional `set: new Date()` overwrites the original timestamp even though the notification is idempotent. Audit-timestamp drift only.

## Dedupe notes

Merged duplicates (9):
- Swallowed-catch driver API: Q H2 + R H1 + CC #2 → A-H1.
- God file `delivery.ts`: R H2 + CC #1 → A-H2.
- Flat 409/401 status mapping: R M4 + Q L9 + Q L10 + CC #3 → A-M10.
- Geocode-cache duplication: R L1 + CC #4 → A-L13.
- `sameStreet` heuristic: R L2 + CC #10 → A-L14.
- Inline magic durations: R L3 + CC #4 + CC #5 → A-L15.
- `take: 200` cap: Q L1 + CC #5 → A-L5.
- `take: 500` cap: Q L2 + CC #5 → A-L6.
- Driver 401-for-everything (status): folded into A-M10 (Q L10 was status-only; Sec L2 / A-L2 retained for the distinct error-message-leakage claim).

A-M8 (authz gate) and A-L4 (token leakage) share a location but make distinct claims; both retained and cross-referenced. No new findings introduced.

