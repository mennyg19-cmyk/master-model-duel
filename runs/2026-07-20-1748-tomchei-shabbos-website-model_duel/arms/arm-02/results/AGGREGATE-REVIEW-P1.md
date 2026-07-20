# Aggregate Review — P1 — arm-02

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-02
**Phase:** P1 — Foundation, identity, roles, permissions, staff tooling
**Tree:** `arms/arm-02/workspace/`
**Inputs:** `results/reviews/P1-security-arm-02.md`, `P1-quality-arm-02.md`, `P1-rules-arm-02.md`, `P1-clean-code-arm-02.md`
**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings.

## Severity counts

| Severity | Count |
|---|---|
| Blocker | 2 |
| Major | 11 |
| Minor | 33 |
| **Total** | **46** |

Severity mapping: security HIGH = blocker; security MEDIUM / quality MEDIUM / rules VIOLATION = major; all LOW + clean-code refactor debt = minor. Where two specialists filed the same location+claim at different severities, the higher severity survives (e.g. S13 LOW + Q5 MEDIUM → major).

## Sources

- S = security (`P1-security-arm-02.md`), findings S1–S15
- Q = quality (`P1-quality-arm-02.md`), findings Q1–Q13
- R = rules (`P1-rules-arm-02.md`), per-rule items
- F = clean-code (`P1-clean-code-arm-02.md`), findings F1–F15

## Dedupe map (merged findings)

- S4 (cookie `secure`) ≡ Q2 ≡ R-workflow "cookie secure flag" → **A4**
- S5 (`SESSION_SECRET` unused) ≡ Q1 → **A5**
- S13 (audit not transactional) ≡ Q5 → **A9** (major; Q5 rated medium)
- Q6 (audit action label collapses role+status) ≡ R-ponytail "audit fidelity" → **A20**
- F13 (defensive `?.` on guaranteed non-null) ≡ R-ponytail "redundant gate re-query" ≡ R-clean-code "Anti-AI-tics defensive `?.`" → **A29**
- F8 (inline styles in `global-error.tsx`) ≡ R-clean-code NOTE "UI consistency inline styles" → **A41**

All other findings carried over verbatim with no merge.

---

## Blockers (2)

### A1 — No brute-force / rate-limit protection on staff login
**Severity:** blocker · **Source:** S1 · **File:** `app/api/auth/login/route.ts`
Login validates credentials with no throttling, lockout, per-IP/per-account rate limit, or failed-attempt backoff. Email enumeration is mitigated (uniform error), but password brute force against a known staff email is unbounded. P5 R-122 calls for public-endpoint rate limits; P1 staff login has none. A dev-mode 8-char-minimum password with no breach dictionary is wide open to online guessing.

### A2 — Sessions not invalidated on role or permission-override change
**Severity:** blocker · **Source:** S2 · **Files:** `app/api/staff/[id]/route.ts`, `app/api/staff/[id]/overrides/route.ts`
Revoking a staff account deletes its sessions (good), but changing role or permission overrides does not. `getStaffContext` re-resolves permissions from live rows on every request, so for a normal session the effective permissions are re-read each request — but the codebase does not explicitly guarantee privilege reduction takes effect on the next request for the role-change path beyond relying on per-request DB resolution. If overrides are ever cached upstream (e.g. a future edge cache), the staleness becomes a privilege-retention bug. Confirm intent and add an explicit invalidation on role/override change.

---

## Major (11)

### A3 — Open redirect via unvalidated `next` parameter on login
**Severity:** major · **Source:** S3 · **File:** `app/login/page.tsx`
`router.push(searchParams.get("next") ?? "/admin")` forwards to an attacker-supplied `next` with no validation that it is a relative path. `/login?next=https://evil.example` can redirect a victim off-site post-authentication (login CSRF + open redirect chain). Restrict `next` to paths starting with `/` and not `//`.

### A4 — Session cookie not marked `secure`
**Severity:** major · **Source:** S4 ≡ Q2 ≡ R-workflow · **File:** `lib/auth/session.ts:22-27`
`createSession` sets `httpOnly: true` and `sameSite: "lax"` but no `secure` flag. In production over HTTPS the cookie still transmits over a downgrade or same-network MITM. Set `secure: process.env.NODE_ENV === "production"` (or unconditionally behind HTTPS). README does not flag that the cookie config must flip for any non-dev deployment.

### A5 — `SESSION_SECRET` required by env schema but never used
**Severity:** major · **Source:** S5 ≡ Q1 · **Files:** `lib/env.ts`, `lib/auth/session.ts`
`env.ts` mandates `SESSION_SECRET` ("used to sign session tokens"), and `instrumentation.ts` imports `lib/env` so startup fails without it — but `session.ts` never references it. Tokens are random 32-byte bearers looked up by SHA-256 hash; there is nothing to sign. The misleading contract risks an operator rotating the secret expecting revocation, or relying on it for tamper-evidence. Either HMAC the token (and verify on read) or remove the variable and correct the docstring.

### A6 — Unauthenticated, unthrottled client-error endpoint allows log injection / flooding
**Severity:** major · **Source:** S6 · **File:** `app/api/client-error/route.ts`
`POST /api/client-error` has no auth, no rate limit, no origin check, no newline sanitization. `message` (≤500) and `path` (≤200) are written to `console.error` verbatim. An unauthenticated attacker can flood logs (disk-fill / log-rotation DoS) and inject CRLF / fake log lines (log forging). R-132/R-191 ask for "bounded, redacted" intake — bounded in size, not in volume or content. Add same-origin check, per-IP rate limit, and strip/reject control characters.

### A7 — Health endpoint leaks raw DB error messages
**Severity:** major · **Source:** S7 · **File:** `app/api/health/route.ts`
On DB failure the public, unauthenticated `/api/health` returns `error.message` verbatim, which for Prisma/Postgres typically includes the connection-string host, port, and sometimes database name. Information disclosure to an unauthenticated caller; aids reconnaissance. Return a generic `database: "unreachable"` without the message; log the detail server-side.

### A8 — Customer identity linking allows email-based account takeover
**Severity:** major · **Source:** S8 · **File:** `lib/customers.ts`
`findOrLinkCustomer` links an incoming `authUserId` to an existing customer row matched purely by email when that row has no `clerkUserId` yet. An attacker who controls an auth identity registered with the victim's email will be linked to the victim's existing customer record (including prior staff-created order history / address book once those phases land). Identity linking must be gated on email verification + identity proof, not email match alone.

### A9 — Audit writes are not transactional with the audited action
**Severity:** major · **Source:** S13 ≡ Q5 · **Files:** `lib/audit.ts`, `app/api/setup/route.ts:48-54`, `app/api/staff/route.ts:49-54`, `app/api/staff/[id]/route.ts:38-47`, `app/api/staff/[id]/overrides/route.ts:41-46`
`writeAudit` is awaited but runs outside the transaction of the action it records. If the audit insert throws, the privileged mutation has already committed and the audit trail is incomplete — a security-relevant reliability gap. EXPECTED item 6 says "all mutations audited." Wrap each mutation + its `writeAudit` in a single `db.$transaction` (the setup route already uses one — extend it to include the audit and session writes), or write audit on a best-effort retry queue.

### A10 — Manager impersonating a DRIVER is not redirected to `/driver`
**Severity:** major · **Source:** Q3 · **File:** `app/(admin)/admin/layout.tsx:19`
The layout redirects drivers out of admin only when `staff.actingAs.role === "DRIVER" && !staff.isImpersonating`. A manager who starts impersonating a driver keeps landing on `/admin` with the driver's empty permission set — blank sidebar, dashboard card, 403 on every gated sub-route. That defeats the stated purpose of impersonation (seeing exactly what the target sees). Key the condition off `actingAs.role` regardless of `isImpersonating`.

### A11 — Dependency discipline: floating version ranges
**Severity:** major · **Source:** R-clean-code VIOLATION · **File:** `package.json:20-38`
`next`, `react`, `react-dom` are pinned exactly but everything else floats on `^`: `@clerk/nextjs ^7.5.20`, `@prisma/client ^6.19.3`, `zod ^4.4.3`, and all devDeps (`@tailwindcss/postcss ^4`, `embedded-postgres ^18.4.0-beta.17`, `tsx ^4.23.1`, etc.). Rule: "Pin versions — no floating ranges."

### A12 — Two env-access patterns in the same codebase
**Severity:** major · **Source:** R-clean-code VIOLATION · **Files:** `middleware.ts:17` vs `app/api/auth/login/route.ts:13`, `app/api/health/route.ts:10`
`middleware.ts` reads raw `process.env.AUTH_MODE` while the API routes use the validated `env` singleton from `lib/env.ts`. Two patterns for the same concern. The zod loader is plain module code and runs fine on the edge runtime, so the drift isn't forced. Route all env access through `lib/env.ts`.

### A13 — Missing `.env.example`
**Severity:** major · **Source:** R-workflow VIOLATION · **Files:** `lib/env.ts:25`, `README.md`
Both reference `.env.example` but no such file exists in the workspace. Rule: "`.env.example` with placeholders for every secret." Missing placeholders for `DATABASE_URL`, `SESSION_SECRET`, `AUTH_MODE`, and optional `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`.

---

## Minor (33)

### A14 — `sameSite: "lax"` is the only CSRF defense; no CSRF token
**Source:** S9 · **Files:** all state-changing API routes
State changes rely solely on `SameSite=Lax` to block cross-site POSTs. Practical CSRF risk is low (Lax blocks cross-site POST bodies), but there is no defense-in-depth CSRF token and login CSRF (forcing a victim into the attacker's account) is not specifically prevented. Acceptable for P1 if Lax is intentional; recorded for the trail.

### A15 — Dev-mode middleware gate checks cookie presence only
**Source:** S10 · **File:** `middleware.ts`
`devSessionGate` redirects only when `tomchei_session` is absent; any garbage value passes the edge gate and reaches the page, where `readSession` does the real DB-backed check. By design (edge can't reach DB); page/route layer re-validates, so not a bypass. Matcher covers only `/admin/:path*` and `/driver/:path*`; `/api/*` relies entirely on each handler calling `requirePermissionApi` (verified: every gated route does). No finding; recorded for the reviewer trail.

### A16 — scrypt uses Node defaults below OWASP cost guidance
**Source:** S11 · **File:** `lib/auth/passwords.ts`
`scryptSync(password, salt, 64)` uses default `N=16384, r=8, p=1`. Reasonable but below current OWASP guidance (`N=2^17`). Acceptable for dev-mode staff auth; flag for hardening before any non-dev exposure.

### A17 — Setup `GET` leaks whether staff accounts exist
**Source:** S12 · **File:** `app/api/setup/route.ts`
`GET /api/setup` returns `{ locked: boolean }` to an unauthenticated caller, disclosing whether the database has any staff accounts. Low impact (a locked system is the steady state), but a small recon signal. The POST lock is correctly transaction-guarded.

### A18 — `.env` with dev credentials committed in the workspace tree
**Source:** S14 · **File:** `.env`
Workspace contains `.env` with `DATABASE_URL=postgresql://duel:duel@...` and `SESSION_SECRET=dev-only-secret-not-for-production-1748`. Dev values, but ensure `.gitignore` excludes `.env` so the dev secret is not pushed if this tree is ever versioned outside the run archive.

### A19 — No security headers / CSP configured
**Source:** S15 · **File:** `next.config.ts`
No `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`, or `Strict-Transport-Security` headers set. P1 is a shell, but baseline headers belong in the foundation phase.

### A20 — PATCH mislabels audit action when role and status change together
**Source:** Q6 ≡ R-ponytail "audit fidelity" · **File:** `app/api/staff/[id]/route.ts:38-39`
Action is `parsed.data.role ? "staff.role_change" : "staff.status_change"`. When a manager sends both `role` and `status` in one PATCH, the action is recorded as `staff.role_change` only; the status transition is buried in `detail` and invisible to anyone filtering the audit log by action. Either emit two audit rows, or introduce a combined action label.

### A21 — Override PUT audit records only the new list, not the prior state
**Source:** Q7 · **File:** `app/api/staff/[id]/overrides/route.ts:41-46`
`detail: { email, overrides: parsed.data.overrides }` — the new set only. Previous overrides (read into `target` but not captured) are lost. An auditor cannot reconstruct what changed without a from/to. Capture `before` (`target.permissionOverrides`) and `after` in `detail`.

### A22 — `app/error.tsx` ships raw `error.message` to the server
**Source:** Q4 · **File:** `app/error.tsx:15-23`
Calls `/api/client-error` with `message: error.digest ?? error.message.slice(0, 500)`. The inline comment says "Redacted report: message + path only, no stack or user data," but `error.message` is not redacted — it can carry user input, query strings, or internal identifiers up to 500 chars. The digest path is fine; the `error.message` fallback is the leak. Prefer sending only `error.digest` (and a stable code), or whitelist known-safe message templates.

### A23 — Missing smoke: self-target block is never exercised
**Source:** Q8 · **File:** `scripts/run-smoke.ps1`
EXPECTED item 6 and the status doc claim "self-target blocks enforced server-side." Smoke never attempts a self-revoke or self-role-change against the logged-in manager. Guards exist in `app/api/staff/[id]/route.ts:16-21` and `app/api/staff/[id]/overrides/route.ts:22-24` but are unverified. Add an assertion that PATCH/PUT against `gate.staff.realUser.id` returns 400.

### A24 — Missing smoke: driver redirect out of `/admin` is never asserted
**Source:** Q9 · **File:** `scripts/run-smoke.ps1`
EXPECTED item 7 requires "drivers are redirected out of `/admin`." Smoke never logs in as a DRIVER and asserts the redirect to `/driver`. The redirect in `admin/layout.tsx:19` is unverified (and is the same line A10 breaks for the impersonation case).

### A25 — Missing smoke: impersonation banner render is never asserted
**Source:** Q10 · **File:** `scripts/run-smoke.ps1`
EXPECTED item 6 requires "impersonation with banner." Smoke starts/stops impersonation and checks audit entries, but never asserts the banner in `app/(admin)/admin/layout.tsx:27-35` renders during impersonation. A regression that drops the banner would pass the current smoke. At minimum, fetch `/admin` while impersonating and grep for a banner marker.

### A26 — `Session` table lacks indexes on `staffUserId` and `expiresAt`
**Source:** Q11 · **File:** `prisma/schema.prisma:63-71`
Indexes only `tokenHash` (unique). Revocation does `deleteMany({ where: { staffUserId } })` and any future expired-session cleanup will filter by `expiresAt` — both scan the table. P1 volumes are trivial, but this is the foundation schema; add `@@index([staffUserId])` and `@@index([expiresAt])` now so P12 hardening isn't a migration.

### A27 — `PermissionOverride.permission` is a plain `String`, not an enum
**Source:** Q12 · **File:** `prisma/schema.prisma:42-50`
DB stores `permission` as `String`. API guards writes with a zod enum, but the DB has no constraint, so stale or renamed permission keys persist silently. `resolvePermissions` swallows unknown keys, so a renamed permission quietly degrades to "ignored" with no DB signal. Use a Postgres enum (or check constraint) mirroring `PERMISSIONS`.

### A28 — Role-change `<Select>` in `StaffManager` fires instantly with no confirmation
**Source:** Q13 · **File:** `components/staff-manager.tsx:143-152`
Role `<Select>` `onChange` is bound directly to `callApi("/api/staff/{id}", "PATCH", { role })`. A manager who accidentally opens the dropdown and clicks another option immediately mutates the role (audited, but not easily reversible from the UI — no undo, no confirm). Revoke has the same one-click fire pattern (`staff-manager.tsx:164-173`). For an audited identity mutation, require a confirm step or an explicit "Save" button.

### A29 — Defensive optional chaining on a guaranteed non-null / redundant gate re-query
**Source:** F13 ≡ R-ponytail "redundant gate re-query" ≡ R-clean-code "Anti-AI-tics defensive `?.`" · **File:** `app/(admin)/admin/page.tsx:6,17`
Page re-runs `getStaffContext()` (a DB roundtrip) after `app/(admin)/admin/layout.tsx:18` already resolved staff and redirected on null. The `staff?.actingAs.name` chaining is defensive for a condition the layout guarantees can't happen. Reuse the layout-resolved staff via context, or drop the re-query / `?.`.

### A30 — Type/schema drift: client-side `StaffMember` redeclares role/status unions
**Source:** R-clean-code MINOR · **File:** `components/staff-manager.tsx:11-18`
Redeclares `StaffMember` with hand-typed `"MANAGER" | "STAFF" | "DRIVER"` and `"ACTIVE" | "REVOKED"` unions instead of sourcing them from a shared constant. Acceptable that it can't import `@prisma/client` types into a client bundle, but the role/status literals should come from one place (e.g. extend `lib/auth/permissions.ts`) so a Prisma enum change doesn't silently drift the client.

### A31 — Type drift (internal): `OverrideInput.permission: string` then cast
**Source:** R-clean-code MINOR · **File:** `lib/auth/permissions.ts:21,27`
Types `OverrideInput.permission: string` then casts `override.permission as Permission` at line 27. The API route already narrows with `z.enum(ALL_PERMISSIONS)`, so the loose internal type is unnecessary — narrow `OverrideInput.permission` to `Permission`.

### A32 — Back navigation hardcodes destinations
**Source:** R-clean-code MINOR · **Files:** `app/forbidden.tsx:12`, `app/unauthorized.tsx:10`
`forbidden.tsx` hardcodes `/admin` and `unauthorized.tsx` hardcodes `/login`. These are error-page entry links rather than browser-back buttons, so borderline; the rule wants back buttons to return to origin and exceptions documented in README. README defines none.

### A33 — Expired sessions are not cleaned up
**Source:** R-workflow MINOR · **File:** `lib/auth/session.ts:38`
`readSession` returns null for expired sessions but never deletes the expired row. Expired rows accumulate; `readSession` is the natural place to clean them up, or a scheduled job.

### A34 — Duplicated client-side fetch+error pattern (3 call sites)
**Source:** F1 · **Files:** `components/staff-manager.tsx` (`callApi`), `components/setup-form.tsx` (`submitSetup`), `app/login/page.tsx` (`submitLogin`)
Each reimplements: clear error → `fetch` → `response.json().catch(() => null)` → set error from `body?.error ?? fallback` → branch on `response.ok`. Three real call sites. Extract an `apiFetch` helper (or `useApiForm` hook) and let call sites pass a success handler.

### A35 — Duplicated API route body-parsing boilerplate (5+ call sites)
**Source:** F2 · **Files:** `app/api/staff/route.ts`, `app/api/staff/[id]/route.ts`, `app/api/staff/[id]/overrides/route.ts`, `app/api/auth/login/route.ts`, `app/api/setup/route.ts`, `app/api/impersonate/route.ts`, `app/api/client-error/route.ts`
Every JSON route repeats `const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });`. Extract `parseBody(request, schema)` returning `{ data } | { error }`.

### A36 — Duplicated script bootstrap
**Source:** F3 · **Files:** `prisma/seed.ts`, `scripts/concurrency-smoke.ts`
Both open with `const db = new PrismaClient();` and close with the identical tail `main().catch((error) => { console.error(error); process.exit(1); }).finally(() => db.$disconnect());`. `lib/db.ts` centralizes the client for the app; scripts can't reuse it (standalone process), but the run/disconnect scaffold is duplicated. Extract a `runScript(fn)` helper.

### A37 — Inconsistent button pattern within one file
**Source:** F4 · **File:** `components/session-buttons.tsx`
`StopImpersonationButton` uses the shared `Button` component, but `LogoutButton` renders a raw `<button>` with hand-rolled classes (`text-xs text-muted hover:text-danger hover:underline`). Two styling approaches in the same file for the same concern. Add a `variant="link"` to `Button` or use one consistent approach.

### A38 — Raw `<a>` vs `next/link` drift
**Source:** F5 · **File:** `app/setup/page.tsx`
Uses `<a href="/login">` while `app/(storefront)/page.tsx`, `app/unauthorized.tsx`, `app/forbidden.tsx`, and `app/(admin)/admin/layout.tsx` all use `next/link` `Link`. The setup page is the lone outlier and loses client-side navigation. Use `Link`.

### A39 — Magic cookie string duplicated, single-source-of-truth broken
**Source:** F6 · **Files:** `lib/auth/session.ts`, `middleware.ts:7`
`session.ts` exports `SESSION_COOKIE = "tomchei_session"`, but `middleware.ts` hardcodes the literal. Middleware runs in the edge runtime and cannot import `lib/auth/session` (which pulls `db` + `next/headers`). Move `SESSION_COOKIE` to an edge-safe constants module (e.g. `lib/auth/constants.ts`) and import from both.

### A40 — Inconsistent color tokens (raw Tailwind vs semantic)
**Source:** F7 · **Files:** `components/ui/badge.tsx`, `components/staff-manager.tsx:53`
`badge.tsx` uses `bg-red-100 text-danger` and `bg-green-100 text-success`; `staff-manager.tsx:53` uses `bg-red-100 text-danger` for the error banner. The rest of the app uses semantic tokens (`bg-brand-soft`, `bg-danger`, `bg-surface`). The `red-100`/`green-100` raw colors bypass the theme. Add `--danger-soft` / `--success-soft` tokens (mirroring `--brand-soft`) and use them.

### A41 — Inline styles in `global-error.tsx`
**Source:** F8 ≡ R-clean-code NOTE · **File:** `app/global-error.tsx:6-9`
Uses `style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center" }}` and a second inline style on the button. Every other surface uses Tailwind classes against `globals.css` tokens. `global-error` renders its own `<html>` and cannot use the root layout, but it can still `import "./globals.css"` and use the tokenized classes — do that. README does not document the exception.

### A42 — Swallowed error in `app/error.tsx`
**Source:** F9 · **File:** `app/error.tsx:23`
Client-error report fetch ends with `.catch(() => {})` — an empty catch block. The clean-code rule bans swallowed errors. Either log a `console.warn` so transport failures are visible in dev, or add a comment stating the intentional swallow (report failures must never mask the original error).

### A43 — Vendor-locked naming `clerkUserId` (schema drift)
**Source:** F10 · **Files:** `lib/customers.ts`, `prisma/schema.prisma` (`Customer.clerkUserId`, `StaffUser.clerkUserId`)
`lib/customers.ts` accepts a vendor-neutral `authUserId` param but persists it to a field named `clerkUserId`. The function signature and the storage shape disagree on abstraction level, and the schema bakes a specific vendor into the column name. Rename the column/field to `authUserId` (or `externalAuthId`) so the data model stays vendor-neutral like the helper's API.

### A44 — Duplicated self-edit guard
**Source:** F11 · **Files:** `app/api/staff/[id]/route.ts:16`, `app/api/staff/[id]/overrides/route.ts:22`
Both open with `if (id === gate.staff.realUser.id) return Response.json({ error: "..." }, { status: 400 });` with slightly different messages. Extract `rejectSelfEdit(staff, id)` returning `Response | null`.

### A45 — Over-verbose inline dynamic import in `scripts/db-start.ts`
**Source:** F12 · **File:** `scripts/db-start.ts:14`
`const isFreshCluster = !(await import("fs")).existsSync("./.pgdata/PG_VERSION");`. The inline `await import("fs")` is an unnecessary dynamic import. Use a top-level `import { existsSync } from "node:fs";` and call `existsSync(...)` directly.

### A46 — Duplicated "create staff user" core
**Source:** F14 · **Files:** `app/api/setup/route.ts`, `app/api/staff/route.ts`
Both perform `email.toLowerCase()` → `hashPassword(password)` → `db.staffUser.create({ data: { name, email, role, passwordHash } })`. Setup wraps it in a transactional bootstrap lock, so the contexts differ, but the create-step is duplicated. Extract a `createStaffUser(tx, input)` helper that both call. Weaker — the transactional lock makes the duplication shallow.

---

## Top 5 for builder fix pass

Ordered by severity × breadth × cheapness of fix:

1. **A2 — Sessions not invalidated on role/override change** (blocker). Privilege reduction must take effect on the next request; add explicit session invalidation (or document + enforce the per-request re-resolution contract) on the role-change and override-PUT paths.
2. **A1 — No brute-force / rate-limit on staff login** (blocker). Add per-IP and per-account throttling / lockout to `app/api/auth/login/route.ts`; reuse the primitive for A6 (client-error) and the public health path.
3. **A9 — Audit writes not transactional with the audited action** (major). Wrap each mutation + `writeAudit` in one `db.$transaction`; setup already has a transaction — extend it to include audit + session writes.
4. **A10 — Manager impersonating a DRIVER not redirected to `/driver`** (major). One-line condition fix in `app/(admin)/admin/layout.tsx:19` — key off `actingAs.role` regardless of `isImpersonating`. Pair with A24 (smoke assertion for the driver redirect).
5. **A5 — `SESSION_SECRET` required but never used** (major). Either HMAC-sign the session token with it (and verify on read) or drop the variable from `lib/env.ts` and correct the docstring; coordinate with A4 (cookie `secure` flag) since both touch the session primitive.

---

## Notes (not counted as findings)

- No IDOR observed in P1: every per-id staff mutation gates on `staff.manage` and blocks self-target mutations; no customer/order resources exist yet to test object-level authorization.
- No injection observed: all DB access is via Prisma parameterized queries; `db.$queryRaw\`SELECT 1\`` is a static literal with no interpolation.
- Clerk mode (`AUTH_MODE=clerk`) is wired in `middleware.ts` and `env.ts` but not exercised in P1; its real auth handling arrives with Clerk key population and was not reviewable from this tree.
- `vocabulary` rule: 0 findings (terms accurate, one pattern per concern documented and followed).
- `codegraph` rule: not observable from the build artifact (no `.codegraph/` index present); process adherence not evaluable.
- Cosmetic notes from specialists (not findings): `destroySession` uses `deleteMany` on unique `tokenHash` (could be `delete`); `admin/page.tsx:17` `?.` is dead per layout redirect; `AuditLog.actorStaffId` has no index (same category as A26, lower priority); concurrency smoke proves single-shot conflict reporting but not a retry loop.
