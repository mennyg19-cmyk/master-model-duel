# Reviewer specialist — Clean-code

**Arm:** `arm-01`
**Tree / phase:** P9 — Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling
**Output:** `results/reviews/P9-clean-code-arm-01.md`
**Scope:** P9 new/modified files under `arms/arm-01/workspace/` (`domain/delivery.ts`, `domain/delivery-notifications.ts`, `lib/cron-auth.ts`, `app/api/admin/delivery/route.ts`, `app/api/driver/routes/[token]/route.ts`, `app/api/cron/pickup-expiry/route.ts`, `app/api/cron/payment-reminders/route.ts`, `components/delivery-operations.tsx`, `components/driver-route.tsx`, `app/(admin)/admin/delivery/page.tsx`, `app/(admin)/admin/delivery/routes/[routeId]/page.tsx`, `app/(driver)/driver/routes/[token]/page.tsx`, `lib/env.ts`, `prisma/schema.prisma`, `prisma/migrations/20260721061000_p9_delivery/migration.sql`, `prisma/migrations/20260721062000_p9_pickup_expiry_state/migration.sql`, `scripts/p9-smoke.ts`). Findings only, no fixes. Blind to model name.

Focus: duplication, naming, god files, pattern drift. `clean-code` is in arm rules — review applies.

## Summary

P9 reuses the right prior primitives (`requirePermission` / `AccessDeniedError`, `$transaction` + `packageAudit`, the `ShippingProvider` injection seam, the `notificationCapture` upsert for idempotency) and the security primitives are sound (`timingSafeEqual` on token hashes and cron bearer, PIN throttle, scoped stops). The new concerns cluster around a **god-file `domain/delivery.ts`** carrying every P9 concern, a **swallowed error in the driver route API that lies to the client**, **wrong HTTP status semantics on the driver endpoint**, and a run of **magic constants, duplicated PIN regex, and type drift on the untyped `addressSnapshot` JSON**. UI-side: repeated class strings and a raw `JSON.stringify` address dump that drifts from the driver card's formatted address.

## Findings

### High

1. **`domain/delivery.ts` is a god file (632 lines, 7 concerns)** — geocoding + Mapbox cache (`geocodePackage`, `addressText`, `googleMapsUrl`), route CRUD (`createDeliveryRoute`, `reassignDeliveryRoute`), driver magic-link auth + PIN throttle (`accessDriverRoute`), route start + day-of notification (`startDeliveryRoute`), stop delivery + completion (`markStopDelivered`), fulfillment-method switch + label void (`switchFulfillmentMethod`), nearby reroute (`findNearbyShippingPackages`, `confirmRouteReroute`, `distanceMiles`), pickup (`markPickupReady`, `stampPickup`, `expireUnclaimedPickups`), bulk delivery (`scheduleBulkDelivery`), and crons (`sendPaymentReminders`) all live in one module. The arm rule says split when >500 lines **or mixed concerns** — both apply. Candidates: `delivery-geocode.ts`, `delivery-routes.ts`, `driver-magic-link.ts`, `fulfillment-switch.ts`, `pickup.ts`, `bulk-delivery.ts`, `delivery-crons.ts`. Splitting now is cheaper than after P10/P12 add reconciliation and repeat-order mapping on top.

2. **Swallowed error in driver route API** — `app/api/driver/routes/[token]/route.ts:35-39` catches every throw from `accessDriverRoute` after a `deliver` action and returns `{ completed: true }`. A DB failure, a PIN-lock, a expired-link, or a stop-outside-link error is all masked as "route complete, link expired." Clean-code rule: no swallowed errors. The driver UI then sets `route = null` and shows "Route complete. This link is now expired." for a failure that was not a completion — the client is lied to and the operator sees a green screen for a red state.

3. **Driver route API maps every error to HTTP 401** — `app/api/driver/routes/[token]/route.ts:42-47` returns 401 for `safeParse` validation failures (should be 400), for "Too many wrong PIN attempts. Try again later." (should be 429), and for "This driver link has expired." (401 ok). The admin delivery route (`app/api/admin/delivery/route.ts`) discriminates 400 / 403 / 409; the driver route does not. Inconsistent error-handling approach per project (one pattern per concern) and wrong status semantics.

### Medium

4. **Geocode-cache TTL duplicated magic** — `domain/delivery.ts:104` and `:112` both write `new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)` inside the same `upsert` (create + update branches). The file already names `routeLinkLifetimeMs` and `pinLockMs` at the top; the 30-day cache lifetime is unnamed and duplicated two lines apart. Extract `geocodeCacheLifetimeMs`.

5. **Unnamed magic numbers across `delivery.ts`** — `3958.8` earth radius in `distanceMiles` (`:411`), `14 * 24 * 60 * 60 * 1000` pickup-expiry window in `markPickupReady` (`:518`), `5` failed-PIN threshold in `accessDriverRoute` (`:234`), `200` candidate cap in `findNearbyShippingPackages` (`:428`), `500` order cap in `sendPaymentReminders` (`:619`). Each is a named constant waiting to happen; the first three affect business semantics.

6. **PIN shape duplicated** — `/^\d{4}$/` is hard-coded in `domain/delivery.ts:131` (runtime guard) and again in the Zod schema `app/api/admin/delivery/route.ts:23`. Two sources of truth for "driver PIN is four digits"; changing one without the other lets a 5-digit PIN past the schema or past the domain. Extract one `PIN_PATTERN` (or a `validateDriverPin` helper) shared by both.

7. **Inconsistent HTTP response helper** — admin delivery routes (`app/api/admin/delivery/route.ts`) use `NextResponse.json(...)`; both cron routes (`app/api/cron/pickup-expiry/route.ts`, `app/api/cron/payment-reminders/route.ts`) use `Response.json(...)`. Same app, two response helpers for the same concern. Pick one per the "one pattern per concern" rule.

8. **Vague / banned names** — `value` in `distanceMiles` (`domain/delivery.ts:406`) is a banned standalone name (it is the haversine `sin²` term); `run` (`components/delivery-operations.tsx:54`), `post` (`:39`), and `act` (`components/driver-route.tsx:25`) describe nothing about what they do. Rename to `haversineSinSquared`, `submitDeliveryAction`, `postDeliveryAction`, `performDriverAction` (or similar).

9. **Type drift on `addressSnapshot`** — `addressText` (`domain/delivery.ts:25-41`) takes `Prisma.JsonValue` and casts to `Record<string, Prisma.JsonValue>` with no runtime shape check, then reads `line1` / `line2` / `city` / `region` / `postalCode` / `countryCode`. The same untyped snapshot is consumed in `geocodePackage`, `googleMapsUrl`, the stop payload, the route detail page, and the nearby filter — five readers, zero shared type. A snapshot missing `line1` would `filter(Boolean)` it away silently and geocode a partial address. Define one `AddressSnapshot` type and validate/derive from the address-book write path.

10. **Fragile street-comparison string parsing** — `findNearbyShippingPackages` (`domain/delivery.ts:430-444`) strips the house number with `line1.split(/\s+/).slice(1).join(" ").toLowerCase()` and compares it to `addressText(stop.package.addressSnapshot).split(",")[0]!.split(/\s+/).slice(1).join(" ").toLowerCase()`. It assumes a single house-number token, recomputes `addressText` for every candidate × stop in a nested loop, and has no test for "no house number" or "multi-word street name" (e.g. "West 42nd Street"). Convoluted and unverified.

11. **Repeated UI class strings** — `rounded-3xl border border-[var(--border)] bg-white p-6` appears 5+ times across `components/delivery-operations.tsx`, `app/(admin)/admin/delivery/page.tsx`, and `app/(admin)/admin/delivery/routes/[routeId]/page.tsx`; `rounded-xl border p-3` and `rounded-lg border px-3 py-2 font-bold` repeat inside the operations component. Rule of 2 is met many times over; tokenize (a `Panel` / `Card` primitive or a class constant) or componentize.

12. **Raw JSON address dump in admin route detail** — `app/(admin)/admin/delivery/routes/[routeId]/page.tsx:68` renders `{JSON.stringify(stop.package.addressSnapshot)}` directly. The driver stop card (`components/driver-route.tsx:74`) uses the formatted `stop.address` field from the domain; the admin page drifts from that pattern and presents raw JSON to a manager. Use the same formatted address (or a shared `AddressLines` component).

### Low

13. **Stale name in smoke fixture** — `scripts/p9-smoke.ts:30` defines `authSecret = "p5-local-smoke-signing-key-2026"`. This is P9; the `p5-` prefix is copy-paste leftover from the P5 smoke. Misleading to a reader tracing the signing key.

14. **Default-first-method index pattern** — `components/delivery-operations.tsx:166`, `:183`, `:201` use `deliveryMethods[0]?.id`, `shippingMethods[0]`, and `pickupLocations[0]!.id` as the implicit target for method switch, reroute confirm, and pickup-ready. The first active method/location is not necessarily the right one, and there is no UI to choose. Fragile default that will mis-route when a season has multiple delivery methods.

15. **Magic bulk-schedule offsets in component** — `components/delivery-operations.tsx:189` uses `new Date(Date.now() + 86_400_000)` and `new Date(Date.now() + 90_000_000)` for the "Schedule tomorrow" button. Unnamed, and 90_000_000 ms is ~1.04 days — not obviously "tomorrow plus a window." Extract named constants or compute from a calendar day boundary.

## Counts

| Severity | Count |
|---|---|
| High | 3 |
| Medium | 9 |
| Low | 3 |
| **Total** | **15** |
