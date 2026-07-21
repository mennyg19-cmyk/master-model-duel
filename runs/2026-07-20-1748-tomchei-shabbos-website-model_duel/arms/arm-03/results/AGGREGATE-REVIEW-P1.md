# Aggregate P1 Review — arm-03

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Phase:** P1 — Foundation, identity, roles, permissions, staff tooling
**Scope:** arms/arm-03/workspace/
**Inputs:** P1-security, P1-quality, P1-rules, P1-clean-code (arm-03)
**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings.
**Severity normalization:** max severity across sources retained. Source IDs cited as (S/Q/R/CC).

## Summary

| Severity | Count |
|---|---|
| Critical | 5 |
| High | 3 |
| Medium | 18 |
| Low | 16 |
| Nit | 3 |
| **Total deduped** | **45** |

Blockers (must fix before P2): A1, A2, A3, A4, A5.
Majors (should fix before P2): A6, A7, A8, A9, A10, A11.

---

## Critical (blockers)

### A1 — Default `AUTH_MODE=dev` is a full unauthenticated admin bypass
**Sources:** S1
**Files:** `src/lib/env.ts`, `src/middleware.ts`, `src/lib/auth.ts`
`env.ts` defaults `AUTH_MODE` to `"dev"`. In dev mode the middleware wrapper short-circuits with `NextResponse.next()` for every matched route, so Clerk never runs and all admin APIs are public. `getAuthIdentity()` resolves the acting user from `x-dev-user-id` header / `dev_user_id` cookie / `DEV_ACTING_USER_ID` / `DEV_MANAGER_USER_ID`; any client setting `x-dev-user-id` to a seeded staff id is treated as that staff member, including the Manager. Deploying without explicitly setting `AUTH_MODE=clerk` exposes every admin route (`/api/staff`, `/api/impersonate`, `/api/audit`, `/api/setup`) to unauthenticated attackers via a single header. Fix: default to `clerk`; require explicit opt-in for dev.

### A2 — First-run bootstrap is unauthenticated and non-atomic (TOCTOU)
**Sources:** S2, Q2, R1
**Files:** `src/app/api/setup/route.ts`, `src/middleware.ts`, `src/lib/auth.ts`
`/api/setup` is in `isPublic`, so it is reachable without a Clerk session in production. `assertSetupUnlocked()` (count + lock read) → `db.staffUser.create(...)` → `setSetting(SETUP_LOCK_KEY, ...)` are not in a transaction and have no unique guard. Two concurrent POSTs on an empty DB both pass the check, both create a Manager, both write the lock — yielding two managers and a broken invariant (violates EXPECTED S4). Beyond the race, the endpoint accepts any caller's `email`/`displayName` and links `identity?.clerkUserId ?? null`; an unauthenticated attacker reaching an un-bootstrapped deployment first becomes the sole Manager. Fix: establish the lock atomically with the manager insert (unique-key upsert inside `$transaction`), and require an authenticated first-run principal or one-time bootstrap token.

### A3 — Impersonation enables privilege escalation to Manager
**Sources:** S3
**Files:** `src/app/api/impersonate/route.ts`, `src/lib/auth.ts`
`POST /api/impersonate` only checks `staff.impersonate`; it does not compare actor vs target privileges. `getStaffContext` then sets `effectiveStaff = activeImpersonation.impersonated` and resolves permissions from the target's role + overrides. A Staff/Driver granted `staff.impersonate` via an override can start a session against a Manager and inherit every Manager permission for the duration — full escalation. The self-impersonation guard and active/inactive target check do not prevent this. Fix: constrain impersonation to targets whose effective privileges are not a superset of the actor's (or make it Manager-only), and record the actor's role at start time.

### A4 — Impersonation lifecycle uses three inconsistent permission gates
**Sources:** R2, S4, Q1 (partial)
**Files:** `src/app/api/impersonate/route.ts`, `src/components/admin/shell.tsx`, `src/app/(admin)/admin/staff/page.tsx`
Start requires `staff.impersonate`; `DELETE` (stop) requires `admin.access`; the `AdminShell` "Stop" link routes through `/admin/staff` which requires `staff.manage`. A staff granted `staff.impersonate` without `admin.access`/`staff.manage` can start but cannot stop via the audited endpoint. Additionally the `?stopImpersonation=1` query branch in `staff/page.tsx` runs `getStaffContext()` + `db.impersonationSession.updateMany(...)` before `requireAdminPage("staff.manage")`, so any authenticated staff member (including an impersonated Driver whose effective permissions no longer include `staff.manage`) can end their own session while bypassing the page gate. Fix: unify the stop path behind one explicitly gated endpoint (e.g. `DELETE /api/impersonate`) with a single permission, and run the gate before any mutation.

### A5 — Invitation token is dead code (created and audited, never redeemed)
**Sources:** R3
**Files:** `src/app/api/staff/route.ts`
`POST /api/staff` generates `invitationToken` and writes a `STAFF_INVITED` audit entry, but no endpoint redeems the token. The `confirm` intent requires `staff.manage`, not the token. The token is created, audited, and never consumed — an incomplete feature shipped as if complete. Either implement a token-redemption flow or remove the token generation and the audit meta until the redemption endpoint exists.

## High (majors)

### A6 — Internal error messages leaked from every admin API; duplicated error handling
**Sources:** S6, R4, R5, CC-H1
**Files:** `src/app/api/setup/route.ts`, `src/app/api/staff/route.ts`, `src/app/api/impersonate/route.ts`, `src/app/api/audit/route.ts`, `src/app/api/admin/gated/route.ts`, `src/app/api/customer/link/route.ts`, `src/app/api/health/route.ts`, `src/lib/result.ts`
Each route has a catch-all returning `{ ok:false, error: error.message }` (or `String(error)`) with 500/503, leaking Prisma text, connection-string fragments, and stack details regardless of environment. `lib/result.ts` exposes `maskError()` (hides internals in `NODE_ENV=production`) but none of these routes use it. The same `handleError` is duplicated verbatim in `staff` and `impersonate`, and inlined in five more handlers — violating Rule of 2 and "one error-handling approach per project." The health endpoint additionally echoes `authMode`/`webPort` on success and raw DB error on failure. Fix: extract a single `apiErrorResponse(error)` helper using `maskError`, and adopt it everywhere.

### A7 — Unused dependencies declared
**Sources:** CC-H2
**Files:** `package.json`, `src/components/ui/button.tsx`
`class-variance-authority` (0.7.1) and `lucide-react` (0.475.0) are listed but never imported under `src/`. `Button` uses a plain `Record<Variant, string>` instead of CVA. Violates dependency discipline. Remove both or actually adopt them.

### A8 — Premature / dead helper code shipped ahead of need (Rule of 2)
**Sources:** CC-H3, R10, R17 (partial)
**Files:** `src/lib/money.ts`, `src/lib/dates.ts`, `src/lib/season.ts`, `src/lib/ids.ts`, `src/lib/phone.ts`, `src/lib/normalize.ts`, `src/lib/brand.ts` (designTokens), `src/app/(admin)/admin/setup/page.tsx` (`stopIfLocked`)
Exported symbols with zero call sites in `src/`: `dollarsToCents`/`centsToDollars`/`formatCents`, `toIsoDate`/`parseDate`/`formatDisplayDate`, `SeasonWindow`/`seasonLabel`/`isSeasonOpen`, `createId`, `formatPhone`, `normalizeWhitespace`/`normalizeKey`, `designTokens`, `stopIfLocked`. These are P2+ helpers landed in P1. `money.ts` is also advertised in README Patterns despite being unused. Delete until 2+ real call sites exist, or move to the phase that introduces them.

## Medium

### A9 — Invitation token persisted in plaintext in the audit log
**Sources:** S5, Q6
**Files:** `src/app/api/staff/route.ts`, `src/lib/audit.ts`
`STAFF_INVITED` audit meta includes `invitationToken: created.invitationToken`, and the HTTP response returns the full `created` row including the token. Anyone with `audit.read` (default STAFF role) can read live, unused tokens and redeem them — a token-reuse privilege path. The token is a 24-byte `randomBytes` secret. Store only a hash (or omit), and never return it except to the inviting manager out-of-band.

### A10 — Customer linking by email is an account-takeover vector
**Sources:** S7
**Files:** `src/lib/customers.ts`, `src/app/api/customer/link/route.ts`
`linkOrCreateCustomer` links an existing `Customer` row to the caller's `clerkUserId` purely on a matching email, with no check that the caller controls that email beyond Clerk's own verification. A pre-existing Customer record (admin-created/imported) with an email but no `clerkUserId` is claimed by the first Clerk user to present that email — hijacking order history, phone, display name. Link on `clerkUserId` first and only fall back to email after an explicit verified-email confirmation step.

### A11 — `VersionedFixture` test scaffold leaks into the production Prisma schema
**Sources:** Q3
**Files:** `prisma/schema.prisma`, `prisma/migrations/20260721142648_p1_foundation/migration.sql`
A `VersionedFixture` model ships in the production schema purely to back `scripts/concurrency-smoke.ts`. Test scaffolding belongs outside the production schema that later phases extend. Drop it and have the smoke create its own throwaway table/DB, or move it behind a test-only schema.

### A12 — `requirePermission` re-resolves permissions; two permission-gate helpers
**Sources:** Q4, R6, CC-M1
**Files:** `src/lib/auth.ts`, `src/lib/admin-gate.ts`
`requirePermission` calls `hasPermission(ctx.effectiveStaff, ctx.effectiveStaff.permissionOverrides, permission)`, re-resolving role + overrides on every gated API call, ignoring `ctx.permissions` already computed in `getStaffContext`. The page-side gate `requireAdminPage` uses `ctx.permissions.has(permission)`. Two resolution strategies for one check can drift; an override that changes resolution order would silently desync API vs page gates. Unify: have `requireAdminPage` delegate to `requirePermission` (plus setup-redirect) and use `ctx.permissions.has(permission)` consistently.

### A13 — Setup-lock enforcement diverges page vs API; duplicated setup-lock check
**Sources:** R7, CC-M4
**Files:** `src/lib/admin-gate.ts`, `src/lib/auth.ts`, `src/app/api/setup/route.ts`
`requireAdminPage` redirects to `/admin/setup` when setup is incomplete, but `requirePermission` (API) does not check setup state — it just returns 401 via `getStaffContext`. Same gate, two behaviors. Additionally `GET /api/setup` re-implements the manager-count + `SETUP_LOCK_KEY` check inline instead of calling `isSetupComplete()`. Fix: make the API gate consult `isSetupComplete()` and share the single helper.

### A14 — Impersonation stop via query param skips audit + performs a DB write in a page render
**Sources:** Q1, R8, CC-M2
**Files:** `src/app/(admin)/admin/staff/page.tsx`, `src/components/admin/shell.tsx`, `src/app/api/impersonate/route.ts`
The `?stopImpersonation=1` branch calls `db.impersonationSession.updateMany({ ..., data: { active:false, endedAt } })` with no `writeAudit` call, so every impersonation stop via the banner is unaudited (breaks EXPECTED S5, which only asserts `IMPERSONATION_STARTED`). The audited `DELETE /api/impersonate` writes `IMPERSONATION_ENDED` but is not wired to any UI. The stop also performs a write during a GET-rendered page. Fix: route the banner to the audited DELETE endpoint (or share an `endActiveImpersonation(staffId)` helper that writes the audit), and move the mutation out of the page render.

### A15 — `AdminShell` "Stop" form is dead markup
**Sources:** R9
**Files:** `src/components/admin/shell.tsx`
The "Stop" link is wrapped in `<form action="/api/impersonate" method="dialog">`. `method="dialog"` does nothing for an anchor; the form is decorative and non-functional. Wire it to a real POST/DELETE or remove the form.

### A16 — Design tokens duplicated (two sources of truth)
**Sources:** R11, CC-H3 (brand)
**Files:** `src/lib/brand.ts`, `src/app/globals.css`
`designTokens` in `brand.ts` and `:root` in `globals.css` define the same radius/font values. Two sources of truth; clean-code type/schema drift. `designTokens` is also unused (see A8). Pick one source (CSS variables) and drop the other, or generate one from the other.

### A17 — `staff/route.ts` POST misses staff email collision
**Sources:** R12
**Files:** `src/app/api/staff/route.ts`
POST checks `db.customer.findUnique` for email collision but not `db.staffUser.findUnique`. A duplicate staff email throws Prisma P2002, caught as 500 instead of 409. Add the staff-email existence check and return 409 on conflict.

### A18 — `confirm` intent reuses `revokeSchema` and skips version guard / existence handling
**Sources:** Q7, R13, CC-M9
**Files:** `src/app/api/staff/route.ts`
`confirm` parses the body with `revokeSchema` (naming smell), calls `db.staffUser.update` without checking existence, does not increment `version`, and lets a missing target throw P2025 → 500 instead of 404. Role and revoke intents increment version and check existence; confirm is inconsistent. Define an explicit `confirmSchema`, check existence (404), and increment version.

### A19 — `revoke` and `override` edits skip optimistic-concurrency version check
**Sources:** Q8, R14
**Files:** `src/app/api/staff/route.ts`
`role` requires `expectedVersion` and returns 409 on conflict, but `revoke` and `override` upsert/delete mutate without `expectedVersion`. Two managers editing the same staff row concurrently silently clobber. `revoke` already increments `version`. Be consistent — all versioned or none.

### A20 — `StaffManager` does not handle 409 conflicts
**Sources:** R15
**Files:** `src/components/admin/staff-manager.tsx`
`changeRole`/`setOverride`/`revoke` set `message = json.error` on failure; no version refresh or reload prompt. The API returns `conflict: true` that the client ignores. Handle 409 by refreshing the row/version and prompting a retry.

### A21 — Audit query duplicated; page and API disagree on page size and projection
**Sources:** Q14, R16, CC-M5
**Files:** `src/app/api/audit/route.ts`, `src/app/(admin)/admin/audit/page.tsx`
API uses `take:100` and `select: { id, displayName, email }`; page uses `take:50` and `select: { displayName, email }`. Same list, two magic limits and two projections — a manager using the API sees different audit history than the page. Pick one named default and one query, shared via a `listAuditEntries()` helper (add pagination before the log grows past the smaller limit).

### A22 — Duplicated staff-list query
**Sources:** CC-M3
**Files:** `src/app/api/staff/route.ts`, `src/app/(admin)/admin/staff/page.tsx`
Both run `db.staffUser.findMany({ include: { permissionOverrides: true }, orderBy: { createdAt: "asc" } })`. Extract `listStaff()` into `src/lib/` and have the page call it (or call the API).

### A23 — Magic number for login-audit throttle
**Sources:** CC-M6
**Files:** `src/lib/auth.ts`
`Date.now() - staff.lastLoginAt.getTime() > 60_000` uses an unnamed 60-second literal. Promote to a named constant (`LOGIN_AUDIT_INTERVAL_MS`).

### A24 — Unguarded schema parse in dev-session route
**Sources:** CC-M7
**Files:** `src/app/api/dev/session/route.ts`
`schema.parse(await request.json())` has no try/catch; invalid input throws an unhandled 500, inconsistent with the 400 pattern every other route returns for `ZodError`. Wrap or reuse the shared error helper from A6.

### A25 — Inline styles in global error page
**Sources:** CC-M8
**Files:** `src/app/global-error.tsx`
`style={{ fontFamily: "system-ui", padding: 24 }}` while the rest of the app uses Tailwind + CSS variables. Inline styles are a banned refactor category and break "one styling approach per project." Replace with Tailwind classes (since `global-error.tsx` cannot rely on the root layout's CSS, import a minimal stylesheet or inline a `<style>` with the tokens).

### A26 — `settings.write` permission and `setSetting` helper have no surface area
**Sources:** Q9
**Files:** `src/lib/permissions.ts`, `src/lib/settings.ts`, `src/app/(admin)/admin/settings/page.tsx`
`settings.write` is defined and `setSetting` (with OCC support) is exposed, but no P1 route or UI calls them — the settings page only reads. The permission is dead surface in P1; the typed store is exercised only by the setup lock write. Wire a settings write route or omit the permission until P2.

## Low

### A27 — `dev_user_id` cookie set without `httpOnly`, `secure`, or `sameSite`
**Sources:** S8, R21
**Files:** `src/app/api/dev/session/route.ts`
`jar.set("dev_user_id", body.userId, { path:"/", httpOnly:false })` exposes the dev identity cookie to client-side JS and sets no `secure`/`sameSite`. Combined with A1, any storefront XSS can read or overwrite the acting dev user. The route is dev-only, but the cookie should still be `httpOnly:true`, `sameSite:"lax"`, `secure` when `APP_URL` is https, and should validate `userId` against allowed dev ids.

### A28 — Unauthenticated `/api/client-error` is an unbounded log-injection sink
**Sources:** S9
**Files:** `src/app/api/client-error/route.ts`
The route is public (`isPublic`) and writes attacker-controlled `message` (<=500) and `route` (<=200) straight to `console.error` with no sanitization, no rate limit, no auth, no per-client cap. An attacker can flood logs or inject misleading `[client-error]` lines. Bound by per-IP rate limit and/or auth token, and tag lines as untrusted.

### A29 — `getStaffContext` auto-binds `clerkUserId` on email match without audit
**Sources:** S10, Q12, R20
**Files:** `src/lib/auth.ts`
When a `StaffUser` row matches by email but has `clerkUserId === null`, the code silently writes the caller's `clerkUserId` onto the row with no `LOGIN` audit entry and no `lastLoginAt` throttle (the else-branch writes `LOGIN` and throttles). If a staff row is ever created without a Clerk binding (e.g. via the unauthenticated setup in A2, or a future import), the first Clerk user with that email is bound as that staff member with no audit. Bind only after an explicit confirmation flow and emit an audit entry on the link.

### A30 — Impersonation banner copy is inverted
**Sources:** Q5
**Files:** `src/components/admin/shell.tsx`
Banner reads `Impersonating {effectiveName}. Acting as {actorName}.` where `effectiveName` is the target and `actorName` is the real signed-in user. Semantically the actor acts *as* the target, so "Acting as" should name `effectiveName`. Current copy is backwards. Prefer `You are {actorName} acting as {effectiveName}`.

### A31 — Concurrency smoke is deterministic, not a real read-modify-write race
**Sources:** Q10
**Files:** `scripts/concurrency-smoke.ts`
10 `Promise.all` updates against the same version rely on Prisma `updateMany` with `where: { id, version }` — a single atomic SQL `UPDATE … WHERE version = ?`. The 1-winner/9-conflicts result is guaranteed by SQL semantics, not by application-level OCC over a read-modify-write cycle. Satisfies EXPECTED item 10 literally but does not exercise a true race. Note it so later phases do not mistake this for a load test or real OCC validation.

### A32 — `smoke.mjs` S5 "role change" is a no-op (driver → DRIVER)
**Sources:** Q11
**Files:** `scripts/smoke.mjs`
S5 changes the driver's role to `"DRIVER"` (its current role) just to produce a `STAFF_ROLE_CHANGED` audit row. A regression breaking audit on a real transition would still pass. Change to a real transition (STAFF → DRIVER → STAFF) and assert the new role in the response.

### A33 — `/api/health` calls `resetEnvCache()` on every request
**Sources:** Q13, R19
**Files:** `src/app/api/health/route.ts`
Health invalidates the env cache on each probe; re-parsing `process.env` with Zod on every liveness check is wasteful, and a transient parse error turns the probe red even though the app is healthy. Env is static after boot. Drop `resetEnvCache()` from the hot path (call it only in tests or a dedicated admin env-reload route).

### A34 — `SETUP_LOCK_KEY` re-exported from `auth.ts`
**Sources:** R18, CC-L2
**Files:** `src/lib/auth.ts`
`auth.ts` imports `SETUP_LOCK_KEY` from `@/lib/constants` and also re-exports it. The symbol is already exported from `lib/constants`; the re-export adds nothing. Remove the re-export.

### A35 — `AdminLayout` renders children raw when `admin.access` missing
**Sources:** R22
**Files:** `src/app/(admin)/layout.tsx`
For unauthorized users the layout wraps children in a bare `<div>` and relies on each page's `requireAdminPage` to throw. A page that forgets the gate leaks content. Enforce the gate in the layout or document the shell contract.

### A36 — `seed.ts` redundant DENY override
**Sources:** R23
**Files:** `scripts/seed.ts`
Seed adds a `staff.manage` DENY for the baseline STAFF user, but STAFF role defaults already omit `staff.manage`. Redundant data implying a non-default state. Remove the override.

### A37 — `permissions.test.ts` is a script, not a framework test
**Sources:** R24
**Files:** `scripts/permissions.test.ts`, `package.json`
Uses `node:assert/strict` with a one-shot function run via `tsx`; no test runner is declared. clean-code expects one test framework per project. Adopt a runner (vitest/node --test) or rename to drop the `.test.ts` convention.

### A38 — `maskError` reads `process.env.NODE_ENV` directly
**Sources:** R25
**Files:** `src/lib/result.ts`
`maskError` bypasses `getEnv()`, inconsistent with the env-access pattern. Acceptable in an error path but undocumented. Either route through `getEnv()` or document the exception.

### A39 — Banned standalone name `value`
**Sources:** CC-L1
**Files:** `src/components/admin/staff-manager.tsx`
`Object.values(StaffRole).map((value) => …)` uses `value` as a standalone name (on the banned list). Use `role` (the domain term).

### A40 — Hand-rolled button in error page
**Sources:** CC-L3
**Files:** `src/app/error.tsx`
Renders a styled `<button>` with inline Tailwind classes instead of reusing the existing `Button` component. Minor UI pattern drift — reuse `Button`.

### A41 — Narration comment in `smoke.mjs`
**Sources:** CC-L4
**Files:** `scripts/smoke.mjs`
`// stop impersonation` narrates the next request. Per the comment rules, narration comments should be removed; the code is self-explanatory.

## Nit

### A42 — `middleware.ts` `event` param threaded but unused
**Sources:** R26
**Files:** `src/middleware.ts`
`event` is threaded only as a pass-through to `clerkHandler`. Drop or document.

### A43 — `StaffManager.refresh()` fetches without auth headers
**Sources:** R27
**Files:** `src/components/admin/staff-manager.tsx`
Relies on cookie; fine in dev, brittle if `AUTH_MODE` changes. Use an explicit authed fetch.

### A44 — `concurrency-smoke.ts` resets `version` to 1 via upsert
**Sources:** R28
**Files:** `scripts/concurrency-smoke.ts`
Fine for smoke but overwrites prior state silently. Document or scope to a throwaway table (see A11).

---

## Notes

- Severity uses the max across sources for each deduped finding; security findings retain their security severity (security blockers survive).
- No new findings were introduced during aggregation.
- A2, A4, A14 overlap on the impersonation/setup lifecycle; they are kept separate because their core claims (TOCTOU race / gate inconsistency / unaudited stop+page-write) differ.
- A5 (dead token) and A9 (token in audit) are kept separate: A5 is about a missing redemption endpoint, A9 is about plaintext persistence in audit.
