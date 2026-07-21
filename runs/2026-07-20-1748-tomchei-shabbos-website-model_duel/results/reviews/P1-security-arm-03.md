# P1 Security Review — arm-03 (blind)

**Phase:** P1 — Foundation, identity, roles, permissions, staff tooling
**Scope:** `arms/arm-03/workspace/` tree only
**Reference:** `shared/phases/PHASE-P1-EXPECTED.md`, `shared/MERGED-BUILD-PLAN.md` § P1
**Method:** Findings only — no fixes. No new scope beyond the phase/plan.
**Focus:** trust boundaries, auth, secrets, IDOR, injection.

## Summary

arm-03 ships a Clerk-based auth stack with a dev fallback, per-request permission
resolution, versioned staff updates, an impersonation session table with audit
trail, and a customer/staff separation guard. The bones are reasonable, but the
default configuration opens a complete unauthenticated admin bypass, the
first-run bootstrap is both unauthenticated and non-atomic, and impersonation
can be used to escalate privileges. Several routes also leak internal error
text and one audit path persists a staff invitation token in plaintext. The
findings below are real gaps against the P1 expected checklist and standard
web-auth hygiene, not theoretical noise.

## Findings

### S1 — CRITICAL — Default `AUTH_MODE=dev` is a full unauthenticated admin bypass
**File:** `src/lib/env.ts`, `src/middleware.ts`, `src/lib/auth.ts`
`env.ts` defaults `AUTH_MODE` to `"dev"`. When `AUTH_MODE=dev`, the custom
middleware wrapper short-circuits with `NextResponse.next()` for **every**
matched route, so Clerk protection never runs and all admin APIs are public.
`getAuthIdentity()` then resolves the acting user from, in order:
`x-dev-user-id` header → `dev_user_id` cookie → `DEV_ACTING_USER_ID` env →
`DEV_MANAGER_USER_ID`. Any client can set the `x-dev-user-id` request header to
any value that matches a `StaffUser.clerkUserId` in the DB (the seeded dev user
IDs are the obvious guesses and are documented in `.env.example`) and is then
treated as that staff member, including the seeded Manager. Because the
middleware is bypassed entirely, there is no second factor. If this image is
ever deployed without explicitly setting `AUTH_MODE=clerk`, every admin route
(`/api/staff`, `/api/impersonate`, `/api/audit`, `/api/setup`) is fully
controllable by an unauthenticated attacker with a single header. The dev
escape hatch is fine for local development; defaulting to it is not.

### S2 — HIGH — First-run bootstrap is unauthenticated and non-atomic (TOCTOU)
**File:** `src/app/api/setup/route.ts`, `src/middleware.ts`
`/api/setup` is listed in `isPublic` in middleware, so it is reachable without
any Clerk session in production mode. `POST` calls `assertSetupUnlocked()` (a
count + lock read), then `db.staffUser.create(...)` for the manager, then
`setSetting(SETUP_LOCK_KEY, ...)`. These three steps are **not** in a
transaction and there is no unique constraint or insert-with-guard. Two
concurrent POSTs against an empty DB both pass `assertSetupUnlocked`, both
create a Manager row, and both write the lock — resulting in two managers and
a broken invariant. Beyond the race, the endpoint accepts any caller's
`email`/`displayName` and links `identity?.clerkUserId ?? null`; an
unauthenticated attacker who reaches an un-bootstrapped deployment first
becomes the sole Manager and seizes the instance. The smoke test only covers
sequential calls, so the race is not caught. The lock must be established
atomically with the manager insert (e.g. `upsert` on a unique lock key inside
a transaction, or a DB-level guard) and the endpoint must require either an
authenticated first-run principal or a one-time bootstrap token.

### S3 — HIGH — Impersonation enables privilege escalation to Manager
**File:** `src/app/api/impersonate/route.ts`, `src/lib/auth.ts`
`POST /api/impersonate` only checks `staff.impersonate`; it does not compare
the actor's role/permissions to the target's. `getStaffContext` then sets
`effectiveStaff = activeImpersonation.impersonated` and resolves permissions
from the **target's** role + overrides. A Staff member (or Driver) granted
`staff.impersonate` via an override can start an impersonation session against
a Manager and immediately inherit every Manager permission for the duration
of the session — full privilege escalation. The self-impersonation guard and
the active/inactive target check do not prevent this. Impersonation must be
constrained to targets whose effective privileges are not a superset of the
actor's (or be Manager-only), and the audit trail should record the actor's
role at start time.

### S4 — MEDIUM — Stop-impersonation path bypasses the permission gate
**File:** `src/app/(admin)/admin/staff/page.tsx`
The `?stopImpersonation=1` query branch runs `getStaffContext()` and
`db.impersonationSession.updateMany(...)` **before** `requireAdminPage("staff.manage")`
is called. Any authenticated staff member — including an impersonated Driver
whose effective permissions no longer include `staff.manage` — can hit
`/admin/staff?stopImpersonation=1` and end their own session without passing
the page's permission check. Ending one's own session is arguably fine, but
the gate is structurally bypassed for that code path; the permission check
should run first (or the stop action should live behind its own explicitly
gated endpoint, e.g. `DELETE /api/impersonate`, which already exists and
requires `admin.access`).

### S5 — MEDIUM — Invitation token persisted in plaintext in the audit log
**File:** `src/app/api/staff/route.ts` (POST), `src/lib/audit.ts`
On staff creation the route writes a `STAFF_INVITED` audit entry whose `meta`
includes `invitationToken: created.invitationToken`, and the HTTP response
also returns the full `created` row (including the token). The audit log is
readable by any role with `audit.read` (Staff by default). Any Staff user can
therefore read live, unused invitation tokens from the audit feed and redeem
them to create/confirm a staff account of their choosing — a token-reuse
privilege path. The token is a 24-byte `randomBytes` secret and should be
treated as a credential: never persisted in audit, and never returned except
to the inviting manager out-of-band.

### S6 — MEDIUM — Internal error messages leaked from every admin API on 500
**File:** `src/app/api/setup/route.ts`, `src/app/api/staff/route.ts`,
`src/app/api/audit/route.ts`, `src/app/api/admin/gated/route.ts`,
`src/app/api/customer/link/route.ts`, `src/app/api/health/route.ts`
Each of these routes has a catch-all that returns
`{ ok: false, error: error.message }` (or the raw `String(error)`) with a 500
(or 503 for health). `lib/result.ts` already exposes a `maskError()` helper
that hides internals in `NODE_ENV=production`, but none of these routes use
it — they leak Prisma error text, connection-string fragments, and stack
details to the caller regardless of environment. The health endpoint
additionally echoes `authMode` and `webPort` on success and the raw DB error
on failure, which is unnecessary information disclosure for a liveness probe.

### S7 — MEDIUM — Customer linking by email is an account-takeover vector
**File:** `src/lib/customers.ts`, `src/app/api/customer/link/route.ts`
`linkOrCreateCustomer` links an existing `Customer` row to the caller's
`clerkUserId` purely on a matching `email`, with no check that the caller
actually controls/owns that email beyond Clerk's own verification. If a
Customer record exists with an email but no `clerkUserId` (e.g. created by an
admin or imported), the first Clerk-authenticated user who presents that email
claims the record. The staff-collision guard prevents stealing a *staff*
account, but a customer account (order history, phone, display name) can be
hijacked by anyone who can register a Clerk account with the victim's email
on an instance where email verification is lax or the record pre-exists. Link
on `clerkUserId` first and only fall back to email after an explicit,
verified-email confirmation step.

### S8 — LOW — `dev_user_id` cookie set without `httpOnly`, `secure`, or `sameSite`
**File:** `src/app/api/dev/session/route.ts`
`jar.set("dev_user_id", body.userId, { path: "/", httpOnly: false })` exposes
the dev identity cookie to client-side JavaScript and sets no `secure` or
`sameSite` attribute. Combined with S1, any XSS in the storefront can read
or overwrite the acting dev user. The route is dev-only (guarded by
`AUTH_MODE !== "dev"` → 404), but the cookie attributes should still be
locked down (`httpOnly: true`, `sameSite: "lax"`, `secure` when `APP_URL` is
https) so the dev escape hatch cannot be turned into a persistent
client-side identity forge.

### S9 — LOW — Unauthenticated `/api/client-error` is an unbounded log-injection sink
**File:** `src/app/api/client-error/route.ts`
The route is public (`isPublic` in middleware) and writes attacker-controlled
`message` (up to 500 chars) and `route` (up to 200 chars) straight to
`console.error` with no sanitization, no rate limit, no auth, and no
per-client cap. An attacker can flood the server log with arbitrary content
(masking real errors, inflating log volume/cost) or inject misleading
`[client-error]` lines that look like legitimate server output. Bound by a
per-IP rate limit and/or an auth token, and tag the line as
untrusted/attacker-controlled.

### S10 — LOW — Auto-linking of `clerkUserId` on email match during staff login
**File:** `src/lib/auth.ts` (`getStaffContext`)
When a `StaffUser` row matches by email but has `clerkUserId === null`, the
code silently writes the caller's `clerkUserId` onto the row. Within a single
Clerk instance emails are unique and verified, so the practical risk is low,
but the link is unconditional and unaudited. If a staff row is ever created
without a Clerk binding (e.g. via setup with no authenticated caller — see
S2 — or via a future import path), the first Clerk user with that email is
bound as that staff member with no `STAFF_CONFIRMED` or linkage audit entry.
Bind only after an explicit confirmation flow and emit an audit entry on the
link.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 2 |
| Medium | 4 |
| Low | 3 |
| **Total** | **10** |
