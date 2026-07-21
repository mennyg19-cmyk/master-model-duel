# Reviewer specialist — Security

**Arm:** `arm-03` (blind)
**Phase:** P9 — Delivery routes, driver magic links, reroute, pickup, bulk delivery
**Tree:** `arms/arm-03/workspace`
**EXPECTED:** `shared/phases/PHASE-P9-EXPECTED.md`
**Scope:** trust boundaries, auth, secrets, IDOR, injection, magic-link/PIN security, cron bearer auth.
**Findings only — no fixes.**

## Summary

P9 opens a public trust boundary at `/d/[token]` + `/api/driver/[token]`, two bearer-gated cron endpoints, and `admin.access`-gated admin routes for routes/pickup/bulk. The magic-link token itself is strong (32-byte `randomBytes`, stored only as `sha256(raw)`), stop mutations are scoped to the link's own route, and admin routes uniformly call `requirePermission`. The dominant issue is a **trust-boundary wiring bug**: the magic-link routes are not in the middleware public allowlist, so under the default Clerk auth mode the magic-link/PIN logic is unreachable — the feature only works in `AUTH_MODE=dev`, which is also the only mode the smoke test exercises. Beyond that, magic links have no manual revocation and no issuance TTL, route reassignment does not revoke old links, the printed-fallback path bypasses the PIN, and `confirmReroute` skips a cross-season boundary check. Cron bearer auth is fail-closed but uses a non-constant-time compare.

## Counts

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 0 |
| Medium | 7 |
| Low | 10 |
| Informational | 3 |
| **Total** | **21** |

## Findings

### C1 — Magic-link routes are not public; Clerk blocks them in production (CRITICAL)

`src/middleware.ts:5-26` — `isPublic` lists `/api/dev(.*)`, `/api/drafts(.*)`, `/api/checkout(.*)`, etc., but **neither `/d(.*)` nor `/api/driver(.*)`**. In the default auth mode (`AUTH_MODE=clerk`, the `env.ts` default), `clerkHandler` reaches `await auth.protect()` for any non-public route. `/d/[token]` (page) and `/api/driver/[token]` (GET/POST) are therefore rejected for any unauthenticated driver before the magic-link/PIN code runs. The magic link is the credential — there is no Clerk session for a driver — so the entire driver flow is dead in production. It only works under `AUTH_MODE=dev`, where `middleware` short-circuits to `NextResponse.next()`. The P9 smoke (`scripts/smoke-p9.mjs`) runs with `AUTH_MODE=dev` and a `dev_user_id` cookie, so this is masked. EXPECTED S1 ("open magic link on phone viewport; scoped stops only; PIN throttled; mark delivered → link expires") cannot pass in the configured production auth mode.

### M1 — No manual revocation endpoint for magic links (MEDIUM)

`lib/routes/service.ts` — `DriverMagicLink.revokedAt` exists in the schema (`prisma/schema.prisma:1070`) and `isMagicLinkActive` honors it (`:313`), but **nothing in P9 ever writes `revokedAt`**. The only invalidation paths are route completion (sets `completedAt`/`graceExpiresAt` on still-active links) or natural grace expiry. A manager who learns a link was leaked has no way to kill it short of completing the route. `grep revokedAt` across `src/` shows the field is read in `listRoutes`/`isMagicLinkActive` and written only for `StaffUser`/impersonation — never for `DriverMagicLink`.

### M2 — `reassignRoute` does not revoke existing magic links (MEDIUM)

`lib/routes/service.ts:235-276` — reassignment updates `driverStaffId` and optionally `pinHash`, but never touches `DriverMagicLink`. When a route is reassigned to a new driver (or the driver is cleared via `driverStaffId: null`), every previously issued link for that route remains active until the route completes. A former driver — or anyone who copied the first URL — can still start the route and mark stops delivered. EXPECTED S3 ("manager confirm") implies the manager is taking control of the route; leaving the old credential live contradicts that intent.

### M3 — Magic links have no absolute expiry from issuance (MEDIUM)

`lib/routes/service.ts:308-317` — `isMagicLinkActive` returns true whenever `!revokedAt && (!completedAt || graceExpiresAt > now)`. There is no `expiresAt` relative to `createdAt`. A link issued today stays valid until the route completes; if a route is abandoned (driver never finishes, manager never closes it), the link is valid indefinitely. The schema carries no issuance-TTL field. EXPECTED S1 says "expires on completion" but does not preclude an absolute cap; the absence of one turns a leaked URL into a long-lived credential.

### M4 — Printed-fallback delivery bypasses the PIN (MEDIUM)

`lib/routes/service.ts:820-891` (`markStopDeliveredFromPrint`) — any caller with `admin.access` can mark any stop on a printed route delivered with no PIN check. `STAFF` role has `admin.access` by default (`lib/permissions.ts:17`). The only precondition is `route.printPayload` non-null (i.e. the route was printed once). So the route PIN — the second factor EXPECTED S1 calls out ("PIN throttled") — is bypassable by any staff member via the printed-fallback path. The action is audited with `via: "printed_fallback"`, but the PIN never gates it. This makes the PIN a driver-facing control only, not a true delivery-confirmation second factor.

### M5 — `confirmReroute` skips the route's season boundary (MEDIUM)

`lib/routes/service.ts:725-817` — the package is loaded with `order: { seasonId: input.seasonId }`, but the **route is never looked up**, and `routeId` is fed straight into `routeStop.create({ data: { routeId: input.routeId, ... } })`. There is no check that the route belongs to `input.seasonId`. Contrast `suggestReroutes` (`:666`, via `getRouteDetail(seasonId, routeId)`) and `reassignRoute`/`issueMagicLink`/`printRoute`/`markStopDeliveredFromPrint`, all of which season-scope the route. An admin (or any `admin.access` staff) can attach a stop to a route in a **different season** than the package's. The FK on `routeId` passes (route exists), so the cross-season stop is created. This is a trust-boundary violation between seasons.

### M6 — PIN is 4-digit, unsalted SHA-256, no slow KDF (MEDIUM)

`lib/routes/service.ts:36-38` — `hashPin` is `sha256("pin:" + pin)`, static prefix, no per-row salt, no bcrypt/argon2. The PIN space is 10,000 (`z.string().regex(/^\d{4}$/)` at `api/admin/routes/route.ts:29`). If `pinHash` is ever read (DB compromise, backup leak, verbose error), the entire PIN space is brute-forced instantly. The PIN is the only barrier once a magic-link URL leaks (logs/history), so its offline strength matters. The token is correctly hashed with a strong scheme; the PIN is not held to the same standard.

### M7 — PIN throttle is weak and unmonitored (MEDIUM)

`lib/routes/service.ts:341-390` — lockout is 60s after 3 fails; no exponential backoff, no permanent lockout, no notification. After the first lockout, each subsequent wrong attempt re-locks for 60s, so the steady rate is ~1 attempt/60s ≈ 1,440/day — full 4-digit coverage in ~7 days; the initial 3-attempt burst makes it faster. PIN failures are written to `DriverDeliveryEvent` (`PIN_FAIL`/`PIN_THROTTLED`), **not** to `AuditLog`, so brute-force attempts are invisible to the audit trail that `audit.read` monitors. EXPECTED S1 only requires "PIN throttled," which is met minimally; the gap is the absence of escalation and audit visibility.

### L1 — Cron bearer compare is non-constant-time (LOW)

`lib/cron/auth.ts:11` — `match[1] !== secret` is a plain string compare. The rest of the codebase uses `crypto.timingSafeEqual` for secrets (`lib/orders/guest-token.ts:32`, `lib/storefront/newsletter.ts:48`, `lib/stripe/client.ts:87`). Network-based timing attacks on a bearer header are hard, but the inconsistency is a known anti-pattern and the fix is one import.

### L2 — Magic-link token is in the URL path (LOW)

`lib/routes/service.ts:304` (`url: ${base}/d/${rawToken}`) and `app/api/driver/[token]/route.ts`. The credential rides the path, so it lands in Next.js/Vercel access logs, proxy logs, and the driver's browser history. The maps link mitigates Referer leakage via `rel="noreferrer"` (`app/d/[token]/driver-client.tsx:176`), and Next.js's default `Referrer-Policy: strict-origin-when-cross-origin` only sends the origin cross-origin, so the token does not leak to Google via Referer. Still, URL-borne credentials are inherently log-exposed.

### L3 — No security headers configured (LOW)

`next.config.ts` is empty (no `headers()`). No CSP, no `Referrer-Policy`, no `X-Frame-Options`/`X-Content-Type-Options`, no HSTS. The driver magic page and the admin shell are unhardened. For the magic page in particular, a `Referrer-Policy: no-referrer` on `/d/*` would be defense-in-depth for the token-in-URL concern (L2).

### L4 — `.env.example` ships concrete secrets, not placeholders (LOW)

`.env.example:28,31,57` — `NEWSLETTER_HMAC_SECRET=tomchei-arm03-newsletter-hmac-dev-only`, `DRAFT_ACCESS_SECRET=tomchei-arm03-draft-access-hmac-dev-only`, `CRON_SECRET=tomchei-arm03-cron-dev-only`. These look like real values, not `replace-me` placeholders (contrast `STRIPE_SECRET_KEY=sk_test_mock`, which is obviously a mock). Copying the example to `.env` and deploying without rotation yields a known cron/HMAC secret. The `.env` itself is gitignored (`.gitignore:34`), so this is an example-file hygiene issue, not a live leak.

### L5 — Several secrets bypass the validated `getEnv()` schema (LOW)

`lib/env.ts` validates `DATABASE_URL`, `AUTH_MODE`, Clerk keys, and `DEV_*` ids at boot, fail-closed. But `CRON_SECRET`, `NEWSLETTER_HMAC_SECRET`, `DRAFT_ACCESS_SECRET`, `STRIPE_*`, `SHIPPO_*` are read via `process.env` directly (`lib/cron/auth.ts:5`, `lib/routes/service.ts:29`, etc.) with no boot-time presence check. `requireCronBearer` does fail closed at request time (503 if unset), but the HMAC/Stripe/Shippo paths may behave inconsistently when unset. No single fail-closed gate covers all secrets.

### L6 — `/api/dev/session` is public and sets `secure: false` cookie (LOW)

`app/api/dev/session/route.ts` — public (matched by `/api/dev(.*)` in `isPublic`), gated only by `AUTH_MODE === "dev" && NODE_ENV !== "production"`. Sets `dev_user_id` to any allowlisted dev id with `secure: false`. If a dev-mode server is exposed beyond localhost (preview deploy, tunnel, shared network), anyone who can reach it can assume `dev_manager_1`. No origin/host check. Dev-only, but the route is a full identity takeover in exposed-dev scenarios.

### L7 — `confirmReroute` voids the label outside the transaction (LOW)

`lib/routes/service.ts:758-764` — `voidLabelForPackage` runs before the `$transaction` that creates the `RouteStop` and switches the method. If the transaction fails, the shipping label is voided but the package is not rerouted — an inconsistent state touching a financial side-effect (label voiding / Shippo). Not a confidentiality issue, but a money-integrity race.

### L8 — `scheduleBulkDelivery` allows double-scheduling (LOW)

`lib/pickup/bulk.ts:146-149` — `package.updateMany` overwrites `bulkWindowId` without checking the package isn't already in another window. A package can be scheduled into multiple bulk windows; only the last sticks, but notifications for both fire (different `windowId` in the idempotency base). No security boundary, but no integrity check either.

### L9 — Driver assignment does not validate DRIVER role (LOW)

`lib/routes/service.ts:179`/`255` — `driverStaffId` is only FK-checked by the DB. `issueMagicLink`/`reassignRoute`/`createRouteFromPackages` never assert the referenced `StaffUser` has role `DRIVER`. A MANAGER or STAFF could be assigned as the route driver. Minor — the audit captures the assignment — but it weakens the role boundary.

### L10 — Several zod schemas omit `max()` bounds (LOW)

`api/admin/routes/route.ts:27` (`packageIds` array unbounded), `api/admin/bulk-delivery/route.ts:9` (same), `api/admin/routes/[id]/route.ts` (`name`/`windowLabel` via service have no max). `pin` is correctly bounded to 4 digits. Large payloads are a minor DoS surface and an unbounded-row creation vector.

### I1 — `MAGIC_LINK_GRACE_MS` default contradicts schema comment (INFORMATIONAL)

`lib/routes/service.ts:29` defaults to `0`; `prisma/schema.prisma:1019` comments "default 2h." Code is stricter (link expires immediately on completion, no grace), which is safe, but the documented and runtime behavior diverge.

### I2 — Magic-link deliveries have no actor attribution in `AuditLog` (INFORMATIONAL)

`lib/routes/service.ts:535-547` — `writeAudit` for `DRIVER_DELIVERED`/`ROUTE_STARTED`/`ROUTE_COMPLETED` passes no `actorId` (driver is not staff); attribution lives only in `meta.magicLinkId`. By design, but the audit trail for driver actions has no actor column value.

### I3 — `markPickupReadyIfEligible` suppresses re-notification (INFORMATIONAL)

`lib/pickup/service.ts:73` — idempotency base `pickup-ready:${pkg.id}` is stable for the package lifetime. If a package is marked ready, expires, and is re-marked ready, the notification is a duplicate-suppression hit, so the customer is never re-notified. Operational, not security.

## Notes on what is done well

- Magic-link token: 32-byte `randomBytes`, base64url, stored only as `sha256(raw)`; raw token never persisted (`lib/routes/service.ts:291-298`).
- Stop mutations resolve `link → route → stops` and require `s.id === input.stopId` on the link's own route — no cross-route IDOR (`lib/routes/service.ts:509-510`).
- Cron endpoints are POST-only and fail closed when `CRON_SECRET` is unset (`lib/cron/auth.ts:6-8`).
- `apiErrorResponse` masks internal errors to a generic 500 (`lib/api-error.ts:27`); `ApiError`/`AuthError`/`ZodError` are the only leaked details.
- All DB access is Prisma-parameterized; the one `$queryRaw` (`lib/audit.ts:56-107`) uses `Prisma.join` and `${}` interpolation, no string concatenation — no SQL injection.
- `googleMapsDeepLink` `encodeURIComponent`s the address (`lib/routes/geo.ts:38`).
- Dev auth is cookie-only and rejects client-supplied identity headers (`lib/auth.ts:54-58`); `NODE_ENV === "production"` hard-blocks dev identity (`:52`).
