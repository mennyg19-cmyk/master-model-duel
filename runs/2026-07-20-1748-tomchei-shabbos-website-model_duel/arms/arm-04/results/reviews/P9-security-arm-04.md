# P9 Security Review — arm-04 (blind)

**Phase:** P9 — Delivery routes, driver magic links, method switch/reroute, pickup, bulk scheduling, bearer crons
**Scope:** `arms/arm-04/workspace/` — P9 surface only (no P10–P12 features reviewed)
**Reviewer:** Security specialist, blind to model identity
**Reference:** `shared/phases/PHASE-P9-EXPECTED.md`, `kit/prompts/reviewer/review-security.md`
**Method:** Static read of routes, server actions, services, env spec, scratch smoke/STATUS. Findings only — no fixes proposed.

## Surface examined

- Magic link issuance / lookup / PIN: `src/lib/routing/route-links.ts`
- Driver session cookie: `src/lib/routing/driver-session.ts`, `src/lib/auth/signed-cookie.ts`, `src/lib/auth/cookie-names.ts`, `src/lib/auth/local-session.ts` (cookie options)
- Driver phone page + actions: `src/app/(driver)/drive/[token]/page.tsx`, `src/app/(driver)/drive/[token]/actions.ts`
- Driver staff home: `src/app/(driver)/driver/page.tsx`
- Cron bearer gate + endpoints: `src/lib/cron/authorize.ts`, `src/app/api/cron/pickup-expiry/route.ts`, `src/app/api/cron/payment-reminder/route.ts`
- Route admin actions + detail + print: `src/app/(admin)/admin/routes/actions.ts`, `src/app/(admin)/admin/routes/[routeId]/page.tsx`, `src/app/(admin)/admin/routes/[routeId]/print/[artifact]/route.ts`
- Pickup actions + door list: `src/app/(admin)/admin/pickup/actions.ts`, `src/app/(admin)/admin/pickup/door-list/route.ts`
- Services: `src/lib/routing/route-service.ts`, `src/lib/routing/reroute.ts`, `src/lib/pickup/pickup-service.ts`, `src/lib/scheduling/payment-reminder.ts`
- Route view + maps: `src/lib/routing/route-view.ts`, `src/lib/routing/maps.ts`
- Auth gate: `src/lib/auth/staff.ts`
- Env spec: `src/lib/env-spec.ts`
- Scratch evidence: `.scratch/PHASE-P9-STATUS.md`, `.scratch/PHASE-P9-SMOKE.md`

## Findings

### SEC-1 — PIN lockout resets after every 10-minute window, enabling sustained brute force
**Severity:** Medium
**File:** `src/lib/routing/route-links.ts:165–175`

`checkRoutePin` sets `failedPinAttempts: 0` and `lockedUntil = now + 10min` the moment the 5th wrong guess trips the lock. When the 10-minute window expires, the counter is already 0, so an attacker gets 5 fresh guesses every 10 minutes for the entire 3-day link lifetime.

Math: 3 days × 144 ten-minute windows × 5 guesses ≈ 2,160 attempts against a 4-digit (10,000) keyspace ≈ 21% cumulative success per leaked link. The token (32 random bytes) is the real credential and is unguessable, so this only matters when the URL has already leaked — but the PIN is the only thing standing between a leaked URL and full stop-control at that point, and ~1 in 5 leaked-with-PIN links would fall to a patient attacker. The lockout should accumulate across cycles or lengthen exponentially.

The STATUS doc explicitly identifies the lockout as "the real defence" for the 4-digit PIN, which makes the reset-on-lock behavior the load-bearing assumption — and it does not hold over the link's lifetime.

### SEC-2 — Driver magic link grants full stop PII with no second factor by default
**Severity:** Medium
**Files:** `src/app/(driver)/drive/[token]/page.tsx:115–172`, `src/app/(admin)/admin/routes/[routeId]/page.tsx:107–120`

The driver page renders recipient name, full street address, delivery window, item count, and customer contact phone (`tel:` link) for every stop on the route. The PIN is **optional** (`withPin` checkbox defaults unchecked on the issue form), so a manager can — and per the smoke evidence, did — issue a link with no PIN at all.

The token is unguessable (32 random bytes, SHA-256 stored), but magic-link URLs leak in practice: WhatsApp forwards, screenshots, shared devices, browser history, referrer headers to Google Maps. A leaked URL with no PIN = direct disclosure of every household on the route, their addresses, and their phone numbers, plus the ability to mark stops delivered. The PIN is the only mitigation and it is off by default.

This is partly a product decision (volunteers won't be onboarded), but the security posture is: **the default link has no second factor and exposes PII to anyone who holds the URL.** At minimum, the issue form should default to PIN-on, or the page should redact phone/address until the PIN is answered.

### SEC-3 — `markStopDelivered` (office path) is not season-scoped, unlike its siblings
**Severity:** Low
**Files:** `src/lib/routing/route-service.ts:351–361`, `src/app/(admin)/admin/routes/actions.ts:138–156`

`assignDriver`, `startRoute`, `issueRouteLink`, `revokeRouteLink`, and `rerouteOntoRoute` all filter the route with `where: { id, seasonId }`. `markStopDelivered` filters the stop with `where: { id: stopId, routeId }` and never touches `seasonId` — the office action `markStopDeliveredAction` does not pass one.

A manager with `routes.manage` can POST a crafted `routeId` from a previous season together with that route's `stopId` and stamp it delivered (which also flips the package to `SENT`). Impact is limited because the actor already holds `routes.manage`, but this is a real IDOR gap and an inconsistency with the season-scoping discipline applied everywhere else in the same file. The fix is mechanical (add `seasonId` to the lookup), but per instructions I am not proposing it.

### SEC-4 — Cron job bodies persist raw `error.message` into `CronRunLog.detail`
**Severity:** Low
**Files:** `src/lib/pickup/pickup-service.ts:301–309`, `src/lib/scheduling/payment-reminder.ts:78–86`

Both sweepers catch errors and write `error.message` into the `CronRunLog.detail` JSON column. Database and ORM error messages can carry fragments of the connection string, query text, or bound parameter values. The `CronRunLog` table is readable from the admin layer, so a persisted error could land a secret fragment in front of staff who should not see raw infrastructure strings. Low likelihood — most runtime errors are benign — but the catch-and-store pattern should sanitize or truncate before persisting.

### SEC-5 — Cron endpoints accept GET for a side-effecting job
**Severity:** Informational
**Files:** `src/app/api/cron/pickup-expiry/route.ts:12–14`, `src/app/api/cron/payment-reminder/route.ts:14–16`

Both routes export a `GET` handler that forwards to `POST`. The bearer secret lives in the `Authorization` header (not the query string), so a browser navigation 401s safely, and `dynamic = 'force-dynamic'` keeps Next from caching. The residual risk is an intermediary proxy that caches a 401 by URL and serves it to the next scheduler, masking a real outage. Not exploitable as an auth bypass, but POST-only is the convention for endpoints that mutate state, and GET support here buys nothing.

### SEC-6 — `secretsMatch` early-returns on length mismatch
**Severity:** Informational
**File:** `src/lib/cron/authorize.ts:58–64`

`timingSafeEqual` requires equal-length buffers, so the `length !== length` early return is unavoidable without padding to a fixed size. The practical effect is a timing oracle on the length of the configured `CRON_SECRET`. Secret length is not sensitive at this scale (24+ chars per env-spec), and the prefix check on `Bearer ` is constant, so this is noted for completeness, not as a real attack vector.

## What was checked and found clean

- **Token entropy and storage.** 32 random bytes, base64url, SHA-256 stored, unique index on `tokenHash`. A leaked DB backup yields no working tokens. (`route-links.ts:33,61,69,197–199`)
- **Token revocation and reissue.** Issuing a new link retires the old; revoking retires all live links; both check season scope. The "one live link per route" rule holds. (`route-links.ts:54–59,87–116`)
- **Link expiry on completion.** `completeRoute` shortens `expiresAt` to a 15-minute grace window. A finished route's link stops working promptly. (`route-service.ts:424–444`)
- **Indistinguishable dead/revoked/wrong token.** `findLinkByToken` returns null for revoked, expired, and never-issued tokens identically. No enumeration oracle. (`route-links.ts:125–132`, `page.tsx:35–47`)
- **Driver action re-resolves the token.** `driverDeliveredAction` re-runs `findLinkByToken` on every tap, so a revoked link dies on the next request. The form's `stopId` is constrained to the link's `routeId` by the service's `findFirst({ id: stopId, routeId })`. No cross-route IDOR from the driver path. (`actions.ts:33–52`, `route-service.ts:356–357`)
- **Driver session cookie.** Signed (HMAC-SHA256), httpOnly, sameSite=lax, secure in production, holds only `linkId`, scoped to exactly the answered link. A stolen cookie without the URL token reaches nothing. (`driver-session.ts`, `signed-cookie.ts`, `local-session.ts:15–20`)
- **PIN comparison.** scrypt + 16-byte salt, `timingSafeEqual` on equal-length buffers. (`route-links.ts:201–212`)
- **Cron bearer gate.** Unconfigured secret refuses all requests (safe-default), `timingSafeEqual` comparison, 401 with no body detail. Env-spec enforces a 24-char minimum and rejects an unset secret off loopback. (`authorize.ts:19–28`, `env-spec.ts:293–312`)
- **Reroute confirmation.** `confirmed` is checked both in the action and the service; a live carrier label is voided before the method switch; the customer fee is never re-priced. (`reroute.ts:283–285,300–308`, `actions.ts:163–191`)
- **Method switch guards.** Sent/Picked-up boxes refused; only SHIPPING↔DELIVERY; target must be active; address required for delivery. (`reroute.ts:71–96`)
- **Print artifact path.** `isRouteArtifact(artifact)` whitelists the `sheet`/`cards` segment, no path traversal. (`print/[artifact]/route.ts:17`)
- **Maps deep links.** Address placed via `URLSearchParams`, so `&` / `#` in a street name cannot inject extra query params. (`maps.ts:15–18`)
- **Office auth gates.** Every admin route/action calls `requirePermission` with the right permission (`routes.manage`, `fulfillment.manage`, `routes.drive`). 401 vs 403 are distinct and observable. (`staff.ts:66–71`)
- **Driver staff home is scoped.** `where: { driverStaffUserId: context.acting.id }` — a driver sees only their own routes. (`driver/page.tsx:19–23`)
- **Pickup service season scoping.** `sendPickupReady`, `stampPickedUp`, `listPickupCounter` all use `pickupWhere(seasonId)` which includes `boardScopeWhere`. (`pickup-service.ts:38–40,141–142,215–216`)
- **Notification dedupe.** Day-of, pickup-ready, and payment-reminder messages are dedupe-keyed per package/order/date, so a double cron fire or double button press cannot spam customers. (`route-service.ts:323`, `pickup-service.ts:175`, `payment-reminder.ts:54`)
- **Secrets in env.** `CRON_SECRET`, `AUTH_SESSION_SECRET`, `MAPBOX_ACCESS_TOKEN` all marked secret in env-spec; `.env.example` carries empty placeholders only; weak-secret and loopback guards reject misconfiguration at boot. (`env-spec.ts:14–32,208–312`)

## Severity counts

- **Medium:** 2 (SEC-1, SEC-2)
- **Low:** 2 (SEC-3, SEC-4)
- **Informational:** 2 (SEC-5, SEC-6)
- **Critical / High:** 0
- **Total:** 6 findings

The two medium findings both reduce to the same root cause: the magic link is the only credential for a PII-exposing surface, the PIN is its sole second factor, and the PIN is both optional-by-default and brute-forceable over the link's lifetime. The cron gate, token entropy, cookie signing, and admin authorization are sound.
