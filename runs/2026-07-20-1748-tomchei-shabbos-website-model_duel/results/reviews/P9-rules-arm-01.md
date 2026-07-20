# P9 Rules Review — arm-01

Reviewer specialist: Rules. Scope: adherence to this arm's selected catalog rules only (`ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`, `grill-protocol`). Findings only, no fixes. Blind to model identity.

Tree: `arms/arm-01/workspace/` · Phase: P9 (Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling).

## Summary

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 4 |
| Low | 5 |
| Info | 2 |
| **Total** | **13** |

Two `High` findings: a swallowed catch in the driver action route that masks every failure as "route complete," and a 632-line `src/domain/delivery.ts` that mixes five distinct concerns (routes, driver links, geocoding, pickup, bulk/payment crons) past the >500-line / mixed-concerns split trigger. Mediums cluster around env-access drift, an unguarded Mapbox token in a server page, and inconsistent client error handling. Ponytail ladder is satisfied (stdlib `node:crypto`, native `fetch`, no new package).

## Findings

### H1 — Swallowed catch reports any failure as "route complete" (clean-code: no swallowed errors; workflow § Security Basics)
`src/app/api/driver/routes/[token]/route.ts:35-39` wraps `accessDriverRoute` in `try { ... } catch { return NextResponse.json({ completed: true }); }`. The catch discards the error and returns `completed: true` for **every** failure — a transient Prisma error, a DB outage, or a thrown `Error` — not only the "link expired" case it appears to intend. The driver UI then renders "Route complete. This link is now expired." (`src/components/driver-route.tsx:42`) for a non-completed route. Empty catch + misleading state is exactly the swallowed-error anti-pattern; the `deliver` branch also relies on this to detect completion, so a transient error silently "completes" the route from the driver's view.

### H2 — `src/domain/delivery.ts` is a god file with mixed concerns (ponytail: god files; clean-code: split by concern >500 lines)
`src/domain/delivery.ts` is 632 lines and bundles five separable concerns: delivery routes + geocoding (`createDeliveryRoute`, `geocodePackage`, `findNearbyShippingPackages`, `confirmRouteReroute`), driver magic-link/PIN access (`accessDriverRoute`, `startDeliveryRoute`, `markStopDelivered`), fulfillment-method switch (`switchFulfillmentMethod`), pickup (`markPickupReady`, `stampPickup`, `expireUnclaimedPickups`), and bulk + payment-reminder scheduling (`scheduleBulkDelivery`, `sendPaymentReminders`). Both split triggers fire: >500 lines **and** mixed concerns. The pickup and payment-reminder functions have no dependency on the route/driver code and belong in their own modules.

### M1 — `MAPBOX_ACCESS_TOKEN` read directly, bypassing the env helper (clean-code: consistency, single source of truth; workflow § Security Basics)
`src/domain/delivery.ts:83` reads `process.env.MAPBOX_ACCESS_TOKEN` directly, and `src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx:28` reads it again directly in a server component. The arm already owns `readServerEnvironment()` in `src/lib/env.ts:28-47` to centralize server env access (and `MAPBOX_ACCESS_TOKEN` is declared there at line 16). Two env-access patterns now coexist; the token is also read in two places with no shared helper. `CRON_SECRET` is similarly read directly in `src/lib/cron-auth.ts:4` rather than via the helper — same drift, lower impact because the helper is optional there.

### M2 — Mapbox token rendered into an `<img src>` without a configured-token guard in the page (workflow § Security Basics)
`src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx:28-33` interpolates `process.env.MAPBOX_ACCESS_TOKEN` into a public `mapUrl` rendered as `<img src={mapUrl}>` whenever the token is set. The token is a billable, scope-limited secret; embedding it in a URL served to any `admin:view` session (including lower-trust staff with admin access) leaks it to the browser. The domain layer requires the token for geocoding (`delivery.ts:84`) but the page renders it client-side. No least-privilege check (e.g. `orders:manage`) gates the image, while the sibling `GET /api/admin/delivery` route requires `orders:manage`.

### M3 — Two competing error-handling patterns in `delivery-operations.tsx` (clean-code: one pattern per concern; anti-AI-tics)
`src/components/delivery-operations.tsx` defines `run(body, success)` (lines 54-61) wrapping `post` in try/catch, but `createRoute` (lines 63-78) re-wraps `post` in its own try/catch instead of using `run`, and `loadSuggestions` (lines 80-101) does a third inline fetch with its own error path. Three error-handling shapes in one component; `createRoute` needs the response payload so it cannot reuse `run`, but the duplication is not factored (e.g. a `post` that returns parsed payload + throws on error, with callers owning the message).

### M4 — Flat 409 for every non-access error in the admin delivery API (clean-code: error-handling consistency)
`src/app/api/admin/delivery/route.ts:69-73` and `127-135` map every non-`AccessDeniedError` to HTTP 409, including Prisma `P2025` not-found (`findUniqueOrThrow`), Mapbox outages, and DB failures. 409 "Conflict" is wrong for transient/provider failures and for not-found (which is 404/400). The driver route handler mirrors this with a flat 401 (`api/driver/routes/[token]/route.ts:43-47`) for every error including malformed JSON and expired links. One error-handling approach is good; the status mapping is not.

### L1 — Geocode-cache `create`/`update` object literal duplicated (clean-code: duplicated logic)
`src/domain/delivery.ts:96-114` repeats the same four fields (`provider`, `latitude`, `longitude`, `formattedAddress`, `expiresAt`) in both the `create` and `update` branches of the `geocodeCache.upsert`. A shared `cachePayload` object would remove the duplication; the `30 * 24 * 60 * 60 * 1000` expiry is also written twice here (see L3).

### L2 — `sameStreet` heuristic is non-obvious and uncommented (clean-code: comments for non-obvious intent)
`src/domain/delivery.ts:433-435` compares `address.line1.split(/\s+/).slice(1).join(" ")` against `addressText(...).split(",")[0]!.split(/\s+/).slice(1).join(" ")` to detect the same street. The `slice(1)` drops the house number; the `split(",")[0]` takes the first address line from the joined snapshot. This is opaque and fragile (apartments, multi-token house numbers), and has no comment explaining intent or limits. clean-code requires a comment for non-obvious intent; this is exactly that case.

### L3 — Inline magic durations (clean-code: magic values)
`src/domain/delivery.ts:104` and `:112` — `30 * 24 * 60 * 60 * 1000` (geocode cache TTL) appears twice inline; `:518` — `14 * 24 * 60 * 60 * 1000` (pickup expiry window) is inline. The top-of-file constants (`routeLinkLifetimeMs`, `pinLockMs`, `nearbyMiles`) show the established pattern; these three durations break it. Name and colocate them.

### L4 — Hardcoded back link (clean-code: UI consistency — back navigation)
`src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx:38` — `<a href="/admin/delivery">← Delivery operations</a>` is a hardcoded back route. clean-code: "back buttons go to where the user came from, not a hardcoded route. Define explicit exceptions in the project README." The admin nav uses a `BackLink` with fallback in P8; this page does not. No documented exception.

### L5 — `@vercel/blob` declared with a floating range (clean-code: dependency discipline — pin versions)
`package.json:29` — `"@vercel/blob": "^2.6.1"` is the only dependency with a floating caret range; every other entry is pinned exact. "Pin versions — no floating ranges." Likely predates P9, but it ships in the modified `package.json` for this phase.

### I1 — Near-identical cron route handlers (clean-code: duplicated logic)
`src/app/api/cron/pickup-expiry/route.ts` and `src/app/api/cron/payment-reminders/route.ts` are the same 10-line handler differing only in the domain function called. Rule of 2 is exactly met; a shared `runCronJob(request, fn)` helper would collapse them. Borderline — leaving duplicated is defensible under "if removing duplication adds more lines than it saves."

### I2 — `startDeliveryRoute` overwrites `dayOfNotificationsAt` on every call (clean-code: consistency)
`src/domain/delivery.ts:275` sets `dayOfNotificationsAt: { set: new Date() }` unconditionally, so a repeated start overwrites the original timestamp even though the notification is idempotent (eventKey-stable). The notification capture is correct; only the audit timestamp is non-idempotent. Minor drift between the idempotent notification and the non-idempotent timestamp.

## Not flagged (verified clean)

- Ponytail ladder satisfied: hashing, timing-safe compare, and random token generation use `node:crypto`; geocoding uses native `fetch`; no new package added for P9.
- No narration or change-explanation comments; the one comment in `routes/[routeId]/page.tsx:50-51` explains a non-obvious eslint-disable (allowed).
- `.env.example` carries placeholders for every new P9 secret (`MAPBOX_ACCESS_TOKEN`, `CRON_SECRET`); `.env*` gitignored (workflow § Security Basics).
- `cron-auth.ts` fails closed when `CRON_SECRET` is unset (returns false → 401); uses `timingSafeEqual` with a length check.
- Idempotency is correct: `NotificationCapture(eventKey, channel)` unique constraint backs `captureCustomerNotification` upsert; bulk, route-start, and pickup-ready are each idempotent per channel (smoke S4/S5 confirms 1 email + 1 SMS per schedule and 1 pickup-ready capture on repeat).
- Schema and migrations match (`DeliveryRoute`, `DeliveryStop`, `DriverMagicLink`, `DriverDeliveryAudit`, `NotificationCapture`, pickup columns); no schema drift between `schema.prisma` and the two P9 migrations.
- UI reuses the existing CSS-var theme (`--brand`, `--border`, `--surface`, `--ink`); the driver mobile page intentionally omits the admin header (distinct surface, appropriate).
- Smoke (`scripts/p9-smoke.ts`) verifies in the running app — seeds fixtures, exercises S1-S5 over HTTP on 127.0.0.1:3101, asserts PIN throttle, label void count, idempotent notifications, cron bearer rejection/acceptance — satisfying workflow "verify in the running app."
