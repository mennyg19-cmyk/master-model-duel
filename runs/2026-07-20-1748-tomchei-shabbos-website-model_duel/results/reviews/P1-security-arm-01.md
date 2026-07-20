# P1 Security Review — arm-01

**Reviewer specialist:** Security
**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Tree / phase:** `arms/arm-01/workspace/` — P1 (Foundation, identity, roles, permissions, staff tooling)
**Scope ref:** `shared/phases/PHASE-P1-EXPECTED.md`
**Method:** findings only — no fixes, no scope beyond P1.

Severity legend: `CRIT` = critical trust-boundary break / unauthenticated takeover · `HIGH` = serious authz/authn bypass or secret exposure · `MED` = meaningful authz/audit gap · `LOW` = hardening / info disclosure / audit hygiene.

---

## CRIT-1 — Bootstrap setup trusts a client-supplied identity header

`src/app/api/setup/route.ts:15-22`; `src/app/(admin)/setup/page.tsx:21-23`

`POST /api/setup` reads the caller's Clerk identity exclusively from the request header `x-clerk-user-id`, which the browser page sets from a plain text input (default `local_first_manager`). The handler performs no Clerk session verification — any unauthenticated caller who reaches the endpoint before the operator can supply an arbitrary `clerkUserId`, become the first `MANAGER`, and lock setup. First-caller-wins on an empty DB turns this into a pre-auth account-takeover on any freshly deployed instance before the legitimate operator bootstraps. The `bootstrapState` lock only prevents a *second* manager; it does not authenticate the *first*.

## CRIT-2 — Local-development identity fallback trusts any client header

`src/lib/auth.ts:14-24`

`getAuthenticatedClerkUserId()` returns `headers().get("x-test-clerk-user-id")` whenever Clerk is unconfigured and `NODE_ENV !== "production"`, falling back to `__local_manager__` when absent. Any caller can set `x-test-clerk-user-id: <existing clerkUserId>` and be treated as that `StaffUser` (the `findUnique({ where: { clerkUserId } })` path). The gate is `NODE_ENV`, not a test/CI flag — any staging, preview, or misconfigured deployment running outside `production` is fully impersonable by anyone who can guess or enumerate a `clerkUserId`. Combined with CRIT-1, a non-production deployment has no authentication boundary at all.

## HIGH-1 — `accept-invite` binds invitation to a client-asserted identity

`src/app/api/staff/accept-invite/route.ts:7-39`

`POST /api/staff/accept-invite` takes `clerkUserId` from the `x-clerk-user-id` header with no verification that the caller actually owns that Clerk identity. The handler then `staffUser.update({ where: { email: invitation.email }, data: { clerkUserId } })`, permanently binding the invitation to whichever identity the caller asserted. An attacker who obtains a single invite token (intercepted email, leaked log, shoulder-surf) redeems it under their own Clerk identity — persistent account takeover. Conversely, an attacker with a token can bind it to an arbitrary `clerkUserId`, displacing the intended staffer. The token is single-use but the trust-on-client-header model defeats the token's protection.

## HIGH-2 — Invite tokens returned in plaintext to the inviter and never delivered

`src/app/api/admin/staff/route.ts:54,88-91`

`POST /api/admin/staff` generates a 32-byte `inviteToken`, stores only its SHA-256 hash (good), but returns the raw token in the JSON response (`{ staffUser, inviteToken, expiresAt }`) with a 7-day validity. There is no email delivery path in P1 and no audit entry for token view. Anyone observing the response — API client logs, browser devtools, a proxy, a future `audit:view` consumer of logs — obtains a live, long-lived invite token. The token is effectively a bearer credential for account creation and is treated as a routine API payload.

## MED-1 — Impersonation cookie not bound to actor; persists after permission revoke

`src/app/api/admin/impersonation/route.ts:26-53`; `src/lib/auth.ts:43-54`

The `impersonate_staff_id` cookie is the bare target `StaffUser.id` with no signature/MAC binding it to the actor who opened the session. `getCurrentStaffUser` honors it for any authenticated caller whose cookie is set, and `requirePermission` only re-checks `staff:impersonate` on the actor when a permission-gated handler runs. Between the cookie being set and the next `requirePermission` call (e.g., client navigation, layout render via `getCurrentStaffUser`), the effective identity is the impersonated user regardless of current actor permissions. There is no server-side expiry shorter than the 1h cookie `maxAge`, no rotation, and no revocation list. A stolen cookie = silent impersonation for up to an hour.

## MED-2 — Impersonation session never closed; audit trail incomplete

`src/app/api/admin/impersonation/route.ts:63-70`

`DELETE /api/admin/impersonation` only clears the cookie. It does not `update({ where: { id }, data: { endedAt } })` on the open `ImpersonationSession` row and writes no `staff.impersonation_ended` audit entry. The audit log records impersonation *start* (S5 smoke expects this) but never *end*, so an impersonation that ran for the full hour is indistinguishable from one that ran for a second. P1 §6 requires "impersonation with banner + audit trail"; the trail is half-written.

## MED-3 — Manager self-protection guard bypassable; impersonation widens it

`src/app/api/admin/staff/route.ts:116-124`

The self-edit guard only fires when `staffId === staffSession.actor.id` and only blocks `body.role || body.status === REVOKED`. A manager can still self-strip via `denyPermissions: ["admin:view","staff:manage","staff:impersonate","audit:view","settings:manage"]` (or `grantPermissions: []`), locking themselves out without triggering the guard. Worse, while impersonating, `staffSession.actor.id` is the *impersonator's* id, so the guard compares against the impersonator — a manager impersonating another manager can `PATCH { id: <impersonatedManagerId>, status: "REVOKED" }` and revoke that manager, because the target id is not the actor id. The guard does not protect the *effective* identity.

## MED-4 — Permission arrays written verbatim with no validation

`src/app/api/admin/staff/route.ts:100-138`; `src/lib/permissions.ts:25-36`

`PATCH /api/admin/staff` accepts arbitrary `grantPermissions` / `denyPermissions` string arrays and writes them to the DB without validating against the `permissions` const. `hasPermission` only matches known strings, so junk entries are inert at check time, but they pollute the audit `metadata`/staff record, and a manager can inject non-enum strings to confuse downstream UI/rubrics that render the arrays verbatim. There is also no deduplication or length cap, and `denyPermissions` is checked before `grantPermissions` — a single `deny` entry silently overrides a role grant with no UI warning.

## MED-5 — `client-errors` endpoint unauthenticated and unthrottled

`src/app/api/client-errors/route.ts:1-26`; `src/lib/env.ts:5,21`

`CLIENT_ERROR_TOKEN` is declared in the environment schema but never read by the route. Any anonymous client can POST; the body is `console.error`'d to server logs with only `slice(0, 200)` / `slice(0, 80)` truncation and a 2 KB `content-length` cap. No auth, no token check, no rate limit, no log sanitization — enables log flooding and log injection (attacker-controlled `route`/`category` strings written verbatim to stderr). The declared token is dead config.

## LOW-1 — Health endpoint discloses auth mode to unauthenticated callers

`src/app/api/health/route.ts:9-14`

`GET /api/health` returns `auth: "local-development" | "clerk"` to any caller. Combined with CRIT-2, an unauthenticated probe learns whether the instance is in the spoofable local-dev mode, enabling targeted header injection.

## LOW-2 — No rate limiting on identity-adjacent endpoints

`src/app/api/setup/route.ts`, `src/app/api/staff/accept-invite/route.ts`, `src/app/api/admin/impersonation/route.ts`, `src/app/api/admin/staff/route.ts`

No throttling on bootstrap, invite redemption, impersonation start, or staff invite creation. Invite-token brute force is infeasible (32 random bytes), but `accept-invite` token enumeration, bootstrap racing (pre-CRIT-1 fix), and impersonation spam have no backoff. P1 §6/§7 do not require rate limiting, but it is the natural mitigation for several findings here.

## LOW-3 — `x-clerk-user-id` header is a trust channel across multiple endpoints

`src/app/api/setup/route.ts:16`, `src/app/api/staff/accept-invite/route.ts:7`

Two distinct endpoints (`/api/setup`, `/api/staff/accept-invite`) accept a client-supplied `x-clerk-user-id` as the authenticated identity. This is a recurring trust-boundary pattern, not a single bug — any future endpoint that copies the pattern inherits the spoofable-identity problem. There is no shared helper that asserts "the caller's real Clerk session = this id"; the header is read inline.

## LOW-4 — CSRF posture relies solely on cookie `sameSite=lax`

`src/app/api/admin/staff/route.ts`, `src/app/api/admin/impersonation/route.ts`, `src/app/api/staff/accept-invite/route.ts`

State-changing handlers are plain `fetch` JSON routes (not Server Actions), so they do not receive Next.js's Server-Action CSRF protection. They rely entirely on Clerk's session cookie being `sameSite=lax` to block cross-site writes. This is currently effective for cross-origin POST, but it is implicit and fragile — any future change to the auth cookie's `sameSite` (or a same-site XSS) reopens every state-changing endpoint at once. No explicit CSRF token or `Origin`/`Sec-Fetch-Site` check exists.

---

## Severity counts

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 2 |
| Medium | 5 |
| Low | 4 |
| **Total** | **13** |
