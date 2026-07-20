# P9 Security Review — arm-01 (blind)

**Phase:** P9 — delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling
**Scope:** `arms/arm-01/workspace/` P9 touch-points only. Findings only — no fixes.
**Reviewer blind to model name.**

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 3 |
| Low | 4 |
| **Total** | **8** |

## High

### H1 — Driver magic-link token carried in URL path (bearer-in-path)
`src/app/api/driver/routes/[token]/route.ts`, `src/app/(driver)/driver/routes/[token]/page.tsx`, `src/domain/delivery.ts:137`

The driver magic link is the **sole credential** for an unauthenticated endpoint and is placed in the URL path (`/driver/routes/{token}`, `/api/driver/routes/{token}`). The token is 32 random bytes base64url (unguessable, good), and only its SHA-256 hash is stored (`delivery.ts:138,200`). However the raw token transits and persists in:

- Server / platform access logs (Vercel/Next request logging captures the path).
- Browser history on the driver's phone and any shared device.
- Any reverse proxy, WAF, or analytics pipeline in front of the app.

The link lifetime is 7 days (`routeLinkLifetimeMs`, `delivery.ts:7`). When no PIN is set (the default — PIN is optional, `delivery.ts:131-133`), possession of the token alone grants full stop data (recipient name, address, greeting) and the ability to mark stops delivered / start the route. Next.js' default `Referrer-Policy: strict-origin-when-cross-origin` limits cross-origin Referer leakage to the Google Maps deep link to origin-only, so the principal residual exposure is **logs and history**, which is still a persistent bearer-token leak.

## Medium

### M1 — Weak optional second factor; per-link-only throttle
`src/domain/delivery.ts:226-238`

PIN is optional and only 4 digits (`^\d{4}$`, `delivery.ts:131`). Throttling is **per link**: 5 failures → 15-minute lock (`pinLockMs`, `delivery.ts:8`), and `failedAttempts` resets to 0 on any success (`delivery.ts:240-243`). There is no IP- or token-global rate limit on `/api/driver/routes/[token]`. For links without a PIN, there is no second factor at all (see H1). For links with a PIN, the reset-on-success allows an attacker who holds the token to interleave guesses with valid opens, and the 10k space is exhaustible over the 7-day window at 5/15min.

### M2 — Missing audit trail for pickup-ready and bulk scheduling
`src/domain/delivery.ts:489-531` (`markPickupReady`), `558-582` (`scheduleBulkDelivery`); `src/app/api/admin/delivery/route.ts:115-126`

Neither `markPickupReady` nor `scheduleBulkDelivery` accepts `actorStaffId` or writes a `packageAudit` / `auditLog` row. The API handler has the session (`session.actor.id`) for `pickup-stamp`, `switch-method`, `confirm-reroute`, `create-route`, and `reassign-route`, but drops it for `pickup-ready` and `schedule-bulk`. There is no accountability for who marked a pickup ready (which triggers a customer notification) or who scheduled a bulk delivery window (which triggers email + SMS). This breaks the P9 audit expectation for those two actions.

### M3 — `assignedDriverId` not validated as an active driver
`src/domain/delivery.ts:118-171` (`createDeliveryRoute`), `173-193` (`reassignDeliveryRoute`); `src/app/api/admin/delivery/route.ts:84-98`

`assignedDriverId` is persisted without verifying the referenced `StaffUser` exists, has `role: "DRIVER"`, or `status: "ACTIVE"`. The admin page filters the dropdown to active drivers (`admin/delivery/page.tsx:30-33`), but the API accepts any string, so a manager (or a forged request from a manager-scoped actor) can bind a route to an arbitrary / inactive / non-driver staff id, weakening the driver trust boundary and the day-of notification routing.

## Low

### L1 — Cron routes are GET with side effects
`src/app/api/cron/pickup-expiry/route.ts`, `src/app/api/cron/payment-reminders/route.ts`

Both cron handlers are `GET` yet mutate state (expire pickups, enqueue reminders). GET responses are cacheable by intermediaries and GET is the wrong verb for state-changing work. Bearer auth in `isAuthorizedCronRequest` is correct and fails closed when `CRON_SECRET` is unset (`cron-auth.ts:6`), so this is method hygiene, not an open hole.

### L2 — Raw error messages echoed to clients
`src/app/api/driver/routes/[token]/route.ts:42-47`, `src/app/api/admin/delivery/route.ts:65-73,127-135`

Both handlers return `error.message` verbatim for non-AccessDenied errors (driver endpoint: status 401 for everything, including DB/Prisma failures). On the unauthenticated driver endpoint this lets a caller distinguish "link expired" vs "wrong PIN" vs "locked" vs internal error (`delivery.ts:221,224,237`), enabling light state enumeration and leaking internal error text.

### L3 — `scheduleBulkDelivery` has no stage/method guard
`src/domain/delivery.ts:558-582`

The function does not verify the package is active, is a delivery (non-shipping, non-pickup) method, or is in a schedulable stage. An admin can schedule a bulk window (and trigger email + SMS) against a shipped, picked-up, or inactive package — a business-logic bypass rather than a privilege issue.

### L4 — Mapbox access token embedded in admin `<img src>`
`src/app/(admin)/admin/delivery/routes/[routeId]/page.tsx:28-53`

The route-detail page builds a Mapbox Static Images URL with `access_token=${encodeURIComponent(token)}` in the query and renders it as `<img src>`, so the token ships in the page HTML behind `admin:view`. The token is a public (`pk.`) token, so exposure is bounded, but it is still present in any screenshot, HAR capture, or proxy log of the admin page.
