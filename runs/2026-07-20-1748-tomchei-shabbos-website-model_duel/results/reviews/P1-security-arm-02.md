# P1 Security Review — arm-02 (blind)

**Phase:** P1 — Foundation, identity, roles, permissions, staff tooling
**Scope:** `arms/arm-02/workspace/` tree only
**Reference:** `shared/phases/PHASE-P1-EXPECTED.md`, `shared/MERGED-BUILD-PLAN.md` § P1
**Method:** Findings only — no fixes. No new scope beyond the phase/plan.
**Focus:** trust boundaries, auth, secrets, IDOR, injection.

## Summary

The P1 surface is small and mostly well-gated: every admin API route calls
`requirePermissionApi`, every admin page calls `requirePermissionPage` (or is
covered by the layout redirect), password hashing uses scrypt with a
per-record salt and `timingSafeEqual`, session tokens are 32 random bytes with
only the SHA-256 hash persisted, revoked accounts have their sessions deleted,
and the bootstrap endpoint is race-guarded by a transaction. The findings below
are real gaps against the P1 expected checklist and standard web-auth hygiene,
not theoretical noise.

## Findings

### S1 — HIGH — No brute-force / rate-limit protection on staff login
**File:** `app/api/auth/login/route.ts`
The login endpoint validates credentials with no throttling, no lockout, no
per-IP or per-account rate limit, and no failed-attempt backoff. Email
enumeration is mitigated (uniform "Invalid email or password"), but password
brute force against a known staff email is unbounded. P5's R-122 calls for
public-endpoint rate limits; P1 staff login has none. A dev-mode password
account with an 8-char minimum and no breach dictionary is wide open to
online guessing.

### S2 — HIGH — Sessions not invalidated on role or permission-override change
**File:** `app/api/staff/[id]/route.ts`, `app/api/staff/[id]/overrides/route.ts`
Revoking a staff account deletes its sessions (good), but changing a staff
member's role or permission overrides does **not**. A demoted Manager→Staff
(or a Staff whose `orders.view` was denied via override) keeps the prior
permission set in their existing DB-backed session until the 12-hour TTL
expires. `getStaffContext` re-resolves permissions from the live
`StaffUser`/`PermissionOverride` rows on every request, so the stale
permissions only persist for the **impersonated** path — but for a normal
session the effective permissions are re-read each request, so the real
exposure is the role/override change taking effect immediately. Confirm
this is intended; if overrides are cached anywhere upstream (e.g. a future
edge cache) the staleness becomes a privilege-retention bug. Flagging as
HIGH because privilege reduction must take effect on the next request, and
the codebase does not explicitly guarantee that for the role-change path
beyond relying on per-request DB resolution.

### S3 — MEDIUM — Open redirect via unvalidated `next` parameter on login
**File:** `app/login/page.tsx`
`router.push(searchParams.get("next") ?? "/admin")` forwards the user to an
attacker-supplied `next` value after a successful login. There is no
validation that `next` is a relative path. A phishing link
`/login?next=https://evil.example` can redirect a victim off-site
post-authentication (classic login CSRF + open redirect chain). The redirect
is client-side via `router.push`, but Next.js will navigate to a fully-qualified
URL. Restrict `next` to paths starting with `/` and not `//`.

### S4 — MEDIUM — Session cookie not marked `secure`
**File:** `lib/auth/session.ts`
`createSession` sets the `tomchei_session` cookie with `httpOnly: true` and
`sameSite: "lax"` but no `secure` flag. In production over HTTPS the cookie
will still transmit, but without the `Secure` attribute any HTTP downgrade
or same-network MITM can capture it. The cookie should be `secure` whenever
`NODE_ENV === "production"` (or unconditionally when behind HTTPS).

### S5 — MEDIUM — `SESSION_SECRET` required by env schema but never used
**File:** `lib/env.ts`, `lib/auth/session.ts`
`env.ts` mandates `SESSION_SECRET` ("used to sign session tokens"), but
`session.ts` never references it. Session integrity rests entirely on the
unguessable 32-byte random token plus its SHA-256 hash in the DB — there is
no signing. The misleading env contract is a real risk: an operator may
believe tokens are signed and rotate the secret expecting revocation, or
rely on it for tamper-evidence. Either sign the cookie (HMAC over the token
or a signed-token model) or remove the variable and correct the docstring.

### S6 — MEDIUM — Unauthenticated, unthrottled client-error endpoint allows log injection / flooding
**File:** `app/api/client-error/route.ts`
`POST /api/client-error` has no auth, no rate limit, no origin check, and no
sanitization of newlines. The `message` (up to 500 chars) and `path` (up to
200) are written to `console.error` verbatim. An unauthenticated attacker
can flood server logs (disk-fill / log-rotation DoS) and inject CRLF or fake
log lines (log forging) that obscure real audit/error entries. R-132/R-191
ask for a "bounded, redacted" intake — bounded in size, but not in volume or
content. Add a same-origin check, a per-IP rate limit, and strip/reject
control characters.

### S7 — MEDIUM — Health endpoint leaks raw DB error messages
**File:** `app/api/health/route.ts`
On DB failure the public, unauthenticated `/api/health` returns
`error.message` verbatim, which for Prisma/Postgres typically includes the
connection string host, port, and sometimes the database name. This is
information disclosure to an unauthenticated caller and aids reconnaissance
(see S6 of the P1 expected "intentionally missing env var fails startup"
check — the runtime error path leaks similarly). Return a generic
`database: "unreachable"` without the message; log the detail server-side.

### S8 — MEDIUM — Customer identity linking allows email-based account takeover
**File:** `lib/customers.ts`
`findOrLinkCustomer` links an incoming `authUserId` to an existing customer
row matched purely by email when that row has no `clerkUserId` yet. An
attacker who controls an auth identity (e.g. a Clerk account) registered
with the victim's email will be linked to the victim's existing customer
record — including any prior staff-created order history / address book
once those phases land. The P1 surface only seeds this, but the linkage
logic is already in `lib/` and will be reused. Identity linking must be
gated on email verification + identity proof, not email match alone.

### S9 — LOW — `sameSite: "lax"` is the only CSRF defense; no CSRF token
**Files:** all state-changing API routes
State changes (login, logout, setup, impersonate start/stop, staff CRUD,
overrides PUT) rely solely on `SameSite=Lax` to block cross-site POSTs.
Lax blocks cross-site POST bodies, so the practical CSRF risk is low, but
there is no defense-in-depth CSRF token and login CSRF (forcing a victim
into the attacker's account) is not specifically prevented. Acceptable for
P1 if Lax is intentional; flagging for the record.

### S10 — LOW — Dev-mode middleware gate checks cookie presence only
**File:** `middleware.ts`
`devSessionGate` redirects only when the `tomchei_session` cookie is
**absent**; any garbage value passes the edge gate and reaches the page,
where `readSession` does the real DB-backed check. This is by design (edge
can't reach the DB) and the page/route layer re-validates, so it is not a
bypass — but the matcher covers only `/admin/:path*` and `/driver/:path*`.
API routes under `/api/*` are unprotected by middleware and rely entirely
on each handler calling `requirePermissionApi`. Verified: every gated API
route does call it. No finding, recorded for the reviewer trail.

### S11 — LOW — scrypt uses Node defaults below OWASP cost guidance
**File:** `lib/auth/passwords.ts`
`scryptSync(password, salt, 64)` uses the default `N=16384, r=8, p=1`. This
is reasonable but below current OWASP password-hashing guidance
(`N=2^17`). For dev-mode staff auth this is acceptable; flag for hardening
before any non-dev exposure.

### S12 — LOW — Setup `GET` leaks whether staff accounts exist
**File:** `app/api/setup/route.ts`
`GET /api/setup` returns `{ locked: boolean }` to an unauthenticated caller,
disclosing whether the database has any staff accounts. Low impact (a
locked system is the steady state), but it is a small recon signal. The
POST lock is correctly transaction-guarded.

### S13 — LOW — Audit writes are not transactional with the audited action
**File:** `lib/audit.ts`
`writeAudit` is awaited but runs outside the transaction of the action it
records (e.g. role change, override PUT, impersonation). If the audit insert
throws, the privileged mutation has already committed and the audit trail is
incomplete — a security-relevant reliability gap. Wrap audit + mutation in
one transaction, or write audit on a best-effort retry queue.

### S14 — LOW — `.env` with dev credentials committed in the workspace tree
**File:** `.env`
The workspace contains a `.env` with `DATABASE_URL=postgresql://duel:duel@...`
and `SESSION_SECRET=dev-only-secret-not-for-production-1748`. These are dev
values, but ensure `.gitignore` excludes `.env` so the dev secret is not
pushed if this tree is ever versioned outside the run archive.

### S15 — LOW — No security headers / CSP configured
**File:** `next.config.ts`
No `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`, or
`Strict-Transport-Security` headers are set. P1 is a shell, but baseline
headers belong in the foundation phase.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 8 |
| **Total** | **15** |

## Notes / out of scope

- No IDOR observed in P1: every per-id staff mutation
  (`/api/staff/[id]`, `/api/staff/[id]/overrides`) gates on
  `staff.manage` and blocks self-target mutations; no customer/order
  resources exist yet to test object-level authorization.
- No injection observed: all DB access is via Prisma parameterized
  queries; `db.$queryRaw\`SELECT 1\`` is a static literal with no
  interpolation.
- Clerk mode (`AUTH_MODE=clerk`) is wired in `middleware.ts` and `env.ts`
  but not exercised in P1; its real auth handling arrives with Clerk key
  population and was not reviewable from this tree.
