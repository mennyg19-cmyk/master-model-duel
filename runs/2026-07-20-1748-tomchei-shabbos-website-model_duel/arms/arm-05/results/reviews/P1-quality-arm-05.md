# P1 Quality Review — arm-05 (blind)

Phase: P1 — Foundation, identity, roles, permissions, staff tooling
Scope: correctness vs EXPECTED, structure, dead stubs, missing deliverables. Findings only.

## Blockers

### B1 — Middleware file misnamed; Clerk middleware never runs
Location: `proxy.ts` (root), referenced as middleware
Claim: The Clerk middleware is exported from `proxy.ts`, not `middleware.ts`. Next.js only loads middleware from `middleware.{ts,js}` at the project root (or `src/`). The `matcher: ["/admin/:path*", "/api/admin/:path*"]` config therefore has no effect, and no admin route is protected by middleware.
Evidence: `proxy.ts:5-13` declares `const middleware = isClerkConfigured() ? clerkMiddleware() : () => NextResponse.next(); export default middleware; export const config = { matcher: [...] }`. No `middleware.ts` exists in the workspace (grep for "middleware" returns only `proxy.ts` and README mention). EXPECTED S3 ("Staff without permission → 403 on protected admin route") is not satisfied at the page/middleware layer.

### B2 — No real authentication; actor is a query parameter
Location: `app/api/admin/security/route.ts:4-9`
Claim: The only "auth" check resolves the actor from `?actor=` query string matched against staff email. There is no Clerk session read, no token validation, no `auth()`, no `currentUser()`. Anyone can pass `?actor=manager@smoke.test` to pass the gate, or omit it to get 403. Clerk is conditionally wrapped in `app/layout.tsx` but never used for identity resolution in any endpoint.
Evidence: `app/api/admin/security/route.ts:5` `const actor = new URL(request.url).searchParams.get("actor");` then `listStaff().find((candidate) => candidate.email === actor)`. Grep for `auth()` / `currentUser` / `getAuth` returns no matches in app routes. This reduces the entire auth layer to a stub.

### B3 — Entire data layer is in-memory; Prisma never used
Location: `lib/staff-store.ts:33-39`; `prisma/schema.prisma`
Claim: All staff, audit, and setup state lives in `globalThis.__p1StaffState` (in-memory). `@prisma/client` is never imported, never generated, never instantiated. The Prisma schema is decorative. The P1 merge boundary ("deployable shell with migrated DB, seeded identities") is not met.
Evidence: `lib/staff-store.ts:33` `const state: State = globalThis.__p1StaffState ?? { firstManagerCreated: false, staff: [], audits: [] };`. Grep for `@prisma/client|PrismaClient|prisma generate` returns zero matches. `PHASE-P1-STATUS.md` admits: "No PostgreSQL server or Docker runtime is installed... production PostgreSQL Prisma schema... were not live-tested." Smoke S2 reports `database=development-memory`, not a real DB.

## Major

### M1 — Route groups `(storefront)`, `(admin)`, `(driver)` missing
Location: `app/` tree
Claim: Plan § P1 requires route groups `(storefront)`, `(admin)`, `(driver)`. None exist; the tree is flat: `app/admin/`, `app/setup/`, `app/api/`, `app/page.tsx`.
Evidence: Glob of workspace shows no `(storefront)`, `(admin)`, or `(driver)` directories. EXPECTED item 1 unsatisfied.

### M2 — Health check is hardcoded, does not verify DB
Location: `app/api/health/route.ts:3-13`
Claim: `/api/health` always returns `database.ok: true` and `adapter: "development-memory"` regardless of any DB state. EXPECTED S2 requires "DB ok" — the endpoint reports ok without checking anything.
Evidence: `app/api/health/route.ts:4-12` returns a static JSON literal; no DB ping, no env probe beyond listing required keys.

### M3 — Setup lockout is in-memory, resets on restart
Location: `lib/staff-store.ts:51-66`
Claim: First-manager lockout uses `state.firstManagerCreated` boolean in memory. A fresh process reset re-enables setup, allowing re-bootstrap. Plan requires "empty-database bootstrap lockout" (R-010, R-130) — the lock must persist with the DB.
Evidence: `createFirstManager` checks `state.firstManagerCreated` only; no DB query, no persisted flag.

### M4 — Staff management UI missing permission-override editor
Location: `app/admin/staff/page.tsx`
Claim: Plan deliverable: "permission-override editor". The staff page exposes only invite, impersonate, and revoke. There is no UI to set per-user grant/deny overrides. The PATCH endpoint accepts `overrides` but the UI never sends them.
Evidence: `app/admin/staff/page.tsx:43-52` `act()` only sends `{ action }` for revoke/impersonate. No form, no control for overrides anywhere in the page.

### M5 — Impersonation banner missing
Location: `app/admin/layout.tsx`; `lib/staff-store.ts:122-128`
Claim: Plan deliverable: "impersonation with banner (R-099)". `startImpersonation` sets `state.impersonatingId`, but no component reads it and no banner renders during an impersonation session.
Evidence: Grep for `impersonatingId` returns only the setter in `staff-store.ts:125`; no reader. `app/admin/layout.tsx` renders no banner. The staff page "Impersonate" button only calls the API and shows a status message.

### M6 — Admin sidebar not permission-gated
Location: `app/admin/layout.tsx:5-14`
Claim: Plan deliverable: "permission-gated sidebar". The sidebar shows Overview, Staff & permissions, and Security audit links to all viewers with no permission check.
Evidence: `app/admin/layout.tsx:6-11` renders three static `<Link>` elements; no `requirePermission`, no role check, no conditional rendering.

### M7 — Admin pages themselves are unprotected
Location: `app/admin/page.tsx`, `app/admin/staff/page.tsx`, `app/admin/audit/page.tsx`
Claim: EXPECTED S3 says "Staff without permission gets 403 on protected admin route". The 403 is only returned by `/api/admin/security`. The admin pages are server components with no auth gate, so they render for anyone. Combined with B1 (middleware does not run), the admin shell is fully open.
Evidence: None of the admin pages import `requirePermission` or check identity (grep confirms `requirePermission` only in `app/api/admin/security/route.ts`).

### M8 — Most admin endpoints have no permission check
Location: `app/api/staff/route.ts`, `app/api/staff/[staffId]/route.ts`, `app/api/audit/route.ts`
Claim: Only `/api/admin/security` calls `requirePermission`. Anyone can POST `/api/staff` (including role `MANAGER`), PATCH `/api/staff/[id]` to change roles/revoke/impersonate, and GET `/api/audit` to read the full audit trail.
Evidence: Grep for `requirePermission` returns one call site (`app/api/admin/security/route.ts:7`). The other routes have no guard.

### M9 — Customer identity linking not implemented
Location: `prisma/schema.prisma:46-51`
Claim: Plan deliverable: "separate Customer identity linking (R-114)". `CustomerIdentity` model exists in schema but no API, no UI, and no code references it.
Evidence: Grep for `CustomerIdentity` returns only `schema.prisma`. No route or lib file imports or uses it.

### M10 — Baseline seed is a stub
Location: `prisma/seed.ts:1`
Claim: Plan deliverable: "baseline seed (R-142)". EXPECTED: "baseline seed runs". The seed file is a single `console.log` and seeds nothing.
Evidence: `prisma/seed.ts:1` `console.log("Baseline seed is ready. Run against PostgreSQL after DATABASE_URL is configured.");`

### M11 — Self-target blocks missing
Location: `app/api/staff/[staffId]/route.ts`
Claim: Plan deliverable: "self-target blocks — R-119" (a manager cannot revoke or downgrade themselves). The PATCH endpoint has no such guard.
Evidence: `app/api/staff/[staffId]/route.ts:21-30` performs revoke/impersonate/update with no actor identity check and no self-target protection.

## Minor

### m1 — No shadcn-style kit
Location: `app/styles.css`; `lib/foundation.ts`
Claim: Plan: "shadcn-style kit + design tokens + brand constants (R-188..R-190)". Only CSS variables and a `brand` object exist; no shadcn components, no component library, no `components/ui`.
Evidence: Glob shows no `components/` directory; `app/styles.css` is hand-rolled CSS.

### m2 — Global error page is route-level
Location: `app/error.tsx`
Claim: Plan: "global error page". `app/error.tsx` is a route error boundary, not a root `global-error.tsx`. Root layout errors are not caught by it.
Evidence: `app/error.tsx` exists; no `app/global-error.tsx` exists.

### m3 — Migration guard is `prisma validate` only
Location: `scripts/migration-guard.ts:4`
Claim: Plan: "migration guard" (R-140). The script runs `prisma validate`, which checks schema syntax, not migration drift or missing migrations.
Evidence: `scripts/migration-guard.ts:4` `spawnSync(executable, ["prisma", "validate"], ...)`.

### m4 — Migration harness is a string check, not disposable DB
Location: `scripts/migration-harness.ts:3-9`
Claim: Plan: "disposable migration harness" (R-141). The harness reads the schema file and checks for two substrings. It does not spin up a disposable DB or run migrations.
Evidence: `scripts/migration-harness.ts:5` `if (!schema.includes('provider = "postgresql"') || !schema.includes("model StaffUser"))`.

### m5 — CI missing build step
Location: `.github/workflows/ci.yml:18-22`
Claim: EXPECTED: "CI passes" implies the app builds. CI runs lint, typecheck, migration:guard, migration:harness, test — no `npm run build`.
Evidence: `.github/workflows/ci.yml` steps omit `build`.

### m6 — Helper libs incomplete
Location: `lib/foundation.ts`
Claim: Plan: "money-in-cents, normalize, phone, ids, season, dates, result-with-error-masking". Missing: season helpers, date helpers. `centsToDollars` is display formatting, not integer money-in-cents math.
Evidence: `lib/foundation.ts` exports `centsToDollars`, `normalizeEmail`, `normalizePhone`, `createPublicId`, `maskError` only.

### m7 — Session login stamps not written
Location: `prisma/schema.prisma:63-69`
Claim: Plan: "session login stamps (R-120)". `SessionLoginStamp` model exists but no code creates stamps on login.
Evidence: Grep for `SessionLoginStamp` returns only `schema.prisma`.

### m8 — Marketing imagery assets missing
Location: workspace tree
Claim: Plan: "marketing imagery assets (R-192)". None present.
Evidence: Glob shows no image/asset directories.

### m9 — Typed settings store is in-memory only
Location: `lib/settings.ts:7-11`
Claim: Plan: "typed key-value settings store (R-161)". The store is a hardcoded in-memory object with no DB backing and no persistence.
Evidence: `lib/settings.ts:7` `const settings: SettingMap = { ... }` — module-level mutable object.

### m10 — Helper functions are dead code
Location: `lib/foundation.ts`, `lib/settings.ts`
Claim: `centsToDollars`, `normalizePhone`, `createPublicId`, `maskError`, `getSetting`, `setSetting` are defined but never called anywhere in the codebase. They are stubs for later phases.
Evidence: Grep for each function name returns only the definition site in `lib/foundation.ts` / `lib/settings.ts`.

## Counts

- Blockers: 3
- Major: 11
- Minor: 10
- Total: 24
