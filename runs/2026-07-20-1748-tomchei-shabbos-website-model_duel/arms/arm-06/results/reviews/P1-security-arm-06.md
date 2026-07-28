# P1 Security Review — arm-06 (blind)

Reviewer: external security reviewer
Scope: `arms/arm-06/workspace/` only — Test 4 P1 (Foundation, identity, roles, permissions, staff tooling)
Reference: `shared/phases/PHASE-P1-EXPECTED.md`
Mode: Findings only — no fixes. Severity: Blocker / Major / Minor. File cites are absolute paths under the arm.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 7 |

The authN/authZ model is fundamentally sound for P1: HMAC-signed session cookie, per-request auth context, role defaults + grant/deny overrides, self-target blocks, optimistic concurrency, advisory-locked bootstrap, single-use invite tokens, and an audit log covering security-relevant actions. The findings below are gaps against the P1 EXPECTED and standard web trust-boundary hygiene — none individually breaks the phase, but the impersonation audit-trail gap (#1) and cross-privilege impersonation (#2) undermine stated P1 requirements.

---

## Major

### M1. Impersonation actions are mis-attributed in the audit trail
**Files:**
- `arms/arm-06/workspace/lib/auth.ts` (AuthContext carries `impersonator` but it is unused by audit writers)
- `arms/arm-06/workspace/app/api/admin/staff/[id]/route.ts` (PATCH — `actorId: gate.ctx.staff.id`, which during impersonation is the *target*, not the actor)
- `arms/arm-06/workspace/app/api/admin/staff/[id]/revoke/route.ts` (same pattern)
- `arms/arm-06/workspace/app/api/admin/staff/route.ts` (POST — same pattern)
- `arms/arm-06/workspace/lib/audit.ts` (AuditEntry has no impersonator field)

During an impersonated session, `ctx.staff` is the impersonated target, so every audit row written by `recordAudit({ actor: { id: gate.ctx.staff.id, ... } })` attributes the action to the target user, not to the impersonator who actually performed it. Only `impersonation_start` / `impersonation_stop` carry the impersonator identity. P1 EXPECTED item 6 requires "impersonation with banner + audit trail"; the audit trail does not link the impersonator to the actions they took while impersonating, defeating the forensic purpose of the trail. The `AuthContext.impersonator` is computed but never persisted on audit rows.

### M2. Cross-privilege impersonation is unbounded
**Files:**
- `arms/arm-06/workspace/app/api/admin/staff/[id]/impersonate/route.ts` (no check that target role ≤ actor role)
- `arms/arm-06/workspace/lib/permissions.ts` (`canTargetStaff` only blocks self-targeting)

Any holder of `staff.impersonate` can impersonate *any* active staff user, including a MANAGER, and thereby inherit all of that manager's permissions for the duration of the session. Because `staff.impersonate` is itself a grantable override, a Manager can grant it to a STAFF or DRIVER, who can then impersonate a Manager and escalate to full admin powers. The only guard is `canTargetStaff(actor, target)` which blocks self-impersonation only — there is no privilege-tier check. Combined with M1, the escalated actions are audited under the impersonated manager's identity.

### M3. Sessions never expire and are not invalidated server-side
**Files:**
- `arms/arm-06/workspace/prisma/schema.prisma` (`AuthSession` model has no `expiresAt`, no revocation flag)
- `arms/arm-06/workspace/lib/auth.ts` (`getAuthContext` validates only cookie signature + `staff.status === "ACTIVE"`; never consults `AuthSession`)
- `arms/arm-06/workspace/lib/session-codec.ts` (payload carries no `iat`/`exp`)

A session cookie, once issued, is valid indefinitely as long as the staff row stays ACTIVE. There is no expiry in the signed payload, no server-side session store consulted on each request, and no logout-revokes-session mechanism (the `/api/dev-auth` DELETE only clears the cookie client-side). A stolen cookie is a permanent credential. The `AuthSession` table records creation (with `ip`/`userAgent`) but is write-only — nothing reads it to validate or revoke. For a staff-admin tool this is a meaningful persistent-compromise risk.

---

## Minor

### m1. Non-constant-time HMAC signature comparison
**File:** `arms/arm-06/workspace/lib/session-codec.ts:48` — `if (signature !== expected) return null;`

String `!==` short-circuits on the first differing byte, exposing a timing side-channel on signature validation. Standard practice for HMAC verification is a constant-time compare. Exploitability over a network is low, but it is a known-bad pattern for cookie/JWT signature checks.

### m2. Invite tokens never expire
**Files:**
- `arms/arm-06/workspace/app/api/invite/[token]/route.ts` (looks up by `inviteToken`, checks only `status === "PENDING"`)
- `arms/arm-06/workspace/prisma/schema.prisma` (`invitedAt` is recorded but never consulted)

`invitedAt` is populated on creation but no handler compares it to the current time. A pending invite remains valid indefinitely until confirmed. The token is a UUIDv4 (122 bits — guessing is infeasible) and is single-use (cleared on confirm), so this is low risk, but a leaked invite link stays live forever.

### m3. Unauthenticated `/api/client-error` writes to the security audit log
**File:** `arms/arm-06/workspace/app/api/client-error/route.ts`

The endpoint is unauthenticated and appends `client_error` rows to the same `AuditLog` table that holds `bootstrap_manager`, `role_change`, `impersonation_start`, etc. The schema is bounded (R-132, max 500 chars) so it cannot blow up the DB, but there is no rate limiting and no auth, so an attacker can pollute the audit trail with noise to obscure real security events. Consider a separate error log or rate limiting.

### m4. `/api/health` leaks dev-auth-bypass state to unauthenticated callers
**File:** `arms/arm-06/workspace/app/api/health/route.ts:12` — `devAuthBypass: env.DEV_AUTH_BYPASS === "true"` in the 200 response body.

The health check is unauthenticated and returns whether `DEV_AUTH_BYPASS` is on. This is a configuration disclosure that tells an attacker whether the unauthenticated dev-login path (`/api/dev-auth`) is reachable. Low impact (the attacker can also just probe `/dev-login`), but unnecessary exposure.

### m5. `AUTH_SECRET` minimum length is weak and dev `.env` ships a known value
**Files:**
- `arms/arm-06/workspace/lib/env-spec.ts:17` — `z.string().min(16)`
- `arms/arm-06/workspace/.env:2` — `AUTH_SECRET="arm06-local-dev-secret-change-in-prod"`

16 characters is below the conventional 32-byte (256-bit) guidance for HMAC-SHA256 keys. The local `.env` (gitignored, dev-only) uses a human-readable, easily-guessable default. If this value were deployed or copied into a real environment, an attacker who knows the harness convention could forge session cookies. The `.gitignore` correctly excludes `.env`, so this is a hygiene note, not a live leak.

### m6. `x-forwarded-for` is trusted verbatim for `AuthSession.ip`
**File:** `arms/arm-06/workspace/app/api/dev-auth/route.ts:35` — `ip: headerStore.get("x-forwarded-for")`

The header is client-controllable and is stored as the session IP without sanitization or proxy-hop validation. It is only used for logging (not for auth decisions), so impact is limited to audit-log integrity. A reviewer examining sessions could be misled by a spoofed IP.

### m7. `sameSite: "lax"` is the only CSRF mitigation for state-changing routes
**File:** `arms/arm-06/workspace/lib/auth.ts:82-88` (`sessionCookieOptions`)

State-changing handlers (`POST /api/setup`, `POST /api/dev-auth`, `POST /api/admin/staff*`, `POST /api/invite/[token]`, `POST /api/admin/impersonation/stop`) rely solely on the cookie's `sameSite: "lax"` to prevent cross-site POST. `lax` blocks cross-site form/JSON POSTs with the cookie, which is good, but it is a single layer with no token, no custom-header check, and no `SameSite=strict`. Acceptable for P1; worth tightening before the app handles money in later phases.

---

## Out of scope (noted, not scored)

- Clerk integration is deferred by design (the session codec is explicitly the Clerk swap point); reviewing the dev-auth bypass as if it were production auth would be out of scope.
- Rate limiting on `/api/setup`, `/api/invite/[token]`, `/api/dev-auth` — no rate limiting anywhere, but P1 EXPECTED does not require it.
- `/api/admin/staff` POST allows creating a MANAGER directly (no restriction on manager creation) — by design for P1 (managers manage staff).
- No CSP or security headers set in `next.config.mjs` — P1 EXPECTED does not require transport hardening.
