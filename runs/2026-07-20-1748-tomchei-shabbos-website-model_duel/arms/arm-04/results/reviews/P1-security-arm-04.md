# P1 Security Review — arm-04 (blind)

**Phase:** P1 — Foundation, identity, roles, permissions, staff tooling
**Scope:** `arms/arm-04/workspace/` only. Findings only — no fixes.
**Reviewer:** external security specialist
**Date:** 2026-07-26

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 6 |

Trust boundaries are mostly sound: every admin/driver page and every staff mutation goes through `requirePermission` (`src/lib/auth/staff.ts:66`), which returns a real 403/401. Customers are a separate table with no role column (`prisma/schema.prisma:83`). Setup bootstraps and locks in one transaction (`src/lib/bootstrap.ts:42`). Impersonation re-checks the actor's `staff.impersonate` permission on every request, so revocation auto-terminates an active impersonation (`src/lib/auth/staff.ts:51`). No raw SQL, no `dangerouslySetInnerHTML`, no echo of request input to responses. Prisma parameterises all queries — no injection vector found.

The two majors are both about the cookie-signing secret being predictable in real deployments; the minors are input-validation and info-disclosure gaps that do not bypass authz on their own.

## Blocker

None.

## Major

### M1 — `AUTH_SESSION_SECRET` placeholder passes env validation
`src/lib/env-spec.ts:57` enforces only `min(32)`. The shipped `.env.example` placeholder `change-me-to-a-32-character-random-random-string` (`.env.example:16`) is 37 chars and validates clean, so a deployer who copies `.env.example` to `.env` unchanged gets a publicly-known signing secret with no startup warning. The secret signs both the local session cookie and the impersonation cookie (`src/lib/auth/signed-cookie.ts:36`), and `startImpersonation` is called unconditionally in `beginImpersonation` regardless of provider (`src/app/(admin)/admin/staff/actions.ts:84`), so the secret is in use under Clerk too. A known secret lets an attacker forge an `IMPERSONATION_COOKIE` for any `staffUserId`; combined with a STAFF account that holds a `staff.impersonate` GRANT override, that is privilege escalation to any target the cookie names. Recommend rejecting known-weak placeholders and requiring entropy, not just length.

### M2 — Local provider trust boundary depends on `NODE_ENV` alone
`startLocalSession` throws only when `NODE_ENV === 'production'` (`src/lib/auth/local-session.ts:22`). Any deployment run with `NODE_ENV=development` or `test` (common for staging) and `AUTH_PROVIDER=local` accepts a sign-in for any active staff email with no password (`src/app/sign-in/actions.ts:22`). The env schema permits `AUTH_PROVIDER=local` for any `NODE_ENV` (`src/lib/env-spec.ts:52`). The deviation note flags this as a known limitation, but the gate is a single env value — misconfiguration silently turns the public internet into a staff login surface.

## Minor

### m1 — Unauthenticated, unrate-limited log endpoint
`POST /api/client-error` (`src/app/api/client-error/route.ts:17`) is public, has no rate limit, and writes to `console.error` on every call. A hostile client can flood server logs. Body is bounded to 4 KB and fields are truncated, so it is a log-DoS, not a code-exec or XSS path.

### m2 — Health endpoint echoes DB error message
On DB failure, `/api/health` returns `error.message` in the JSON body (`src/app/api/health/route.ts:22`). Postgres connection errors commonly include the connection string; the dev `DATABASE_URL` carries the `postgres` password. Leak is bounded to a 503 response and only triggers when the DB is already broken, but it should be a static message.

### m3 — Server-action enum casts without runtime validation
`changeRoleAction`, `setStatusAction`, `setOverrideAction`, and `inviteStaffAction` cast `formData` values directly with `as StaffRole` / `as 'GRANT'|'DENY'|'INHERIT'` / `as 'ACTIVE'|'REVOKED'` (`src/app/(admin)/admin/staff/actions.ts:29,44,56,69`). Prisma rejects invalid enum values, so there is no bypass, but the result is an unhandled 500 with a Prisma error rather than a user-facing validation failure. `setPermissionOverride` validates `permission` via `isPermission` but skips the same check for `effect`.

### m4 — `version` parsed with `Number()` and not validated
`changeRoleAction` and `setStatusAction` do `Number(formData.get('version'))` (`src/app/(admin)/admin/staff/actions.ts:43,55`). A non-numeric version yields `NaN`; Prisma matches zero rows and the service returns `stale_version`. No bypass, but the optimistic-concurrency contract relies on Prisma behaviour rather than an explicit guard.

### m5 — `x-forwarded-for` trusted as client IP
`stampLogin` and audit rows store `requestHeaders.get('x-forwarded-for')` verbatim (`src/app/sign-in/actions.ts:39`, `src/lib/audit.ts:34`). The header is attacker-controlled; audit and login-session IP columns are forgeable. Not a bypass, but the audit trail's `ipAddress` is not trustworthy without a trusted-proxy whitelist.

### m6 — `safeDestination` accepts any same-origin path
`src/app/sign-in/actions.ts:58` blocks protocol-relative `//` but allows any path starting with `/`, so `?next=/api/health` etc. is a valid post-login redirect. Same-site open redirect is low impact, but the function does not restrict to `/admin` or `/driver`.

## Out of scope (noted, not scored)

- No CSP or security headers in `next.config.ts` — defence-in-depth, not P1-required.
- `StaffLoginSession` rows are written on every login and never purged — operational, not a P1 security gate.
- `PermissionOverride.permission` is `String` in schema; code defends via `isPermission`. Schema hardening is a later-phase concern.

## Counts

```
blocker: 0
major:   2
minor:   6
```
