# P1 Rules Review — arm-05 (blind)

**Scope:** P1 foundation, identity, roles, permissions, staff tooling.
**Rules graded (arm-05 always-on):** ponytail, clean-code, workflow, vocabulary, codegraph.
**Method:** Read every P1 file under `arms/arm-05/workspace/` and graded adherence to the selected catalog rules only. No fixes. No model names.

---

## Blockers

### B1 — Middleware file is misnamed; Clerk protection is dead code
- **Location:** `arms/arm-05/workspace/proxy.ts`
- **Claim:** Next.js only loads middleware from `middleware.ts` / `middleware.js` at the root (or `src/`). The file here is `proxy.ts`, so the exported `clerkMiddleware` never runs.
- **Evidence:** Repo has `proxy.ts` exporting `clerkMiddleware` with `matcher: ["/admin/:path*", "/api/admin/:path*"]`, but `Glob **/arm-05/workspace/middleware.*` returns zero files. `app/layout.tsx` wraps children in `ClerkProvider` only when `isClerkConfigured()`, so the provider renders, but no request-level gate exists.
- **Rules:** `workflow.mdc` Security Basics (least privilege, never trust the request); `clean-code.mdc` Anti-Hallucination (do not claim protection that is not wired).

### B2 — Middleware matcher omits every mutating endpoint
- **Location:** `arms/arm-05/workspace/proxy.ts` (and the API routes it fails to cover)
- **Claim:** Even if the file were renamed, the matcher only covers `/admin/:path*` and `/api/admin/:path*`. The actual staff-mutation surface — `/api/setup`, `/api/staff`, `/api/staff/[staffId]`, `/api/audit` — is unprotected. Anyone can bootstrap the first manager, invite staff, revoke, impersonate, and read the audit log.
- **Evidence:** `app/api/setup/route.ts` POST has no auth check; `app/api/staff/route.ts` GET/POST have no auth check; `app/api/staff/[staffId]/route.ts` PATCH (revoke / impersonate / role+override update) has no auth check; `app/api/audit/route.ts` GET returns the full audit list (emails included) with no auth check.
- **Rules:** `workflow.mdc` Security Basics (least privilege by default, sanitize input); `ponytail.mdc` "Never cut" (trust-boundary validation, security).

### B3 — Health endpoint claims DB ok without checking the DB
- **Location:** `arms/arm-05/workspace/app/api/health/route.ts`
- **Claim:** `GET /api/health` always returns `database.ok: true` with `adapter: "development-memory"` regardless of whether any database is connected. The P1 smoke S2 ("Health → 200 + DB ok") cannot fail this endpoint.
- **Evidence:** The handler is a static `NextResponse.json({ ok: true, database: { ok: true, adapter: "development-memory", schema: "prisma-postgresql" }, ... })` — no Prisma client, no `SELECT 1`, no env probe. The schema declares `postgresql` and `prisma-client-js`, but no client is instantiated or pinged anywhere in the workspace.
- **Rules:** `clean-code.mdc` Anti-Hallucination ("Do not claim 'fixed/passed/working' without tool output or running-app evidence"); `workflow.mdc` ("An empty 200 is not working").

### B4 — Security audit endpoint trusts a query-string `actor` as identity
- **Location:** `arms/arm-05/workspace/app/api/admin/security/route.ts`
- **Claim:** The permission check resolves the actor by reading `?actor=<email>` from the URL and matching it against staff by email. Any caller can pass `?actor=manager@example.test` to satisfy `requirePermission(..., "audit.read")`.
- **Evidence:** `const actor = new URL(request.url).searchParams.get("actor"); const staffMember = listStaff().find((candidate) => candidate.email === actor);` then `requirePermission(staffMember?.id, "audit.read")`. No session, no Clerk `auth()`, no signed token.
- **Rules:** `workflow.mdc` Security Basics ("Sanitize user input in queries, paths, and shell commands. Least privilege by default."); `clean-code.mdc` Anti-Hallucination (the 403 path presents the appearance of authorization without the substance).

---

## Majors

### M1 — Migration harness only string-matches the schema file
- **Location:** `arms/arm-05/workspace/scripts/migration-harness.ts`
- **Claim:** The script and the README line `npm run migration:harness` imply a disposable-DB migration harness (plan R-141). The implementation only `readFile`s `prisma/schema.prisma` and checks the strings `provider = "postgresql"` and `model StaffUser` are present. No migrations are run, no disposable DB is created, no drift is detected.
- **Evidence:** `const schema = await readFile(...); if (!schema.includes('provider = "postgresql"') || !schema.includes("model StaffUser")) { throw ... } console.log("... schema is ready ...")`. CI runs `npm run migration:harness` as a gate step, so CI green does not mean migrations are valid.
- **Rules:** `clean-code.mdc` Anti-Hallucination ("Do not claim 'fixed/passed/working' without tool output or running-app evidence").

### M2 — Seed script does not seed
- **Location:** `arms/arm-05/workspace/prisma/seed.ts`
- **Claim:** `npm run seed` is listed in the README handoff checklist and the plan (R-142 baseline seed). The script body is a single `console.log("Baseline seed is ready. Run against PostgreSQL after DATABASE_URL is configured.")` — no records are written.
- **Evidence:** Full file content is one `console.log` line. No `prisma` import, no `StaffUser` create, no `AppSetting` create. P1 smoke S4 (bootstrap on empty DB) cannot be exercised by this seed.
- **Rules:** `clean-code.mdc` Anti-Hallucination; `workflow.mdc` ("Verify in the running app — never mark done from code alone").

### M3 — Env validation is not enforced
- **Location:** `arms/arm-05/workspace/lib/env.ts`
- **Claim:** `requireProductionEnvironment()` is exported but never called. The P1 smoke ("intentionally missing env var fails startup with a clear message") cannot pass — nothing throws on missing env. Only `isClerkConfigured()` is wired (in `app/layout.tsx` and `proxy.ts`), and it merely toggles the provider, never fails startup.
- **Evidence:** `Grep requireProductionEnvironment` matches only `lib/env.ts` (definition). No `app/layout.tsx`, no `instrumentation.ts`, no route handler calls it. `.env.example` lists `ERROR_REPORTING_TOKEN` but no schema field validates it.
- **Rules:** `clean-code.mdc` Anti-Hallucination; `workflow.mdc` Security Basics (`.env.example` with placeholders for every secret — the placeholder exists but the validation contract is not enforced).

### M4 — Dead helpers (Rule of 2 violation)
- **Location:** `arms/arm-05/workspace/lib/foundation.ts`, `arms/arm-05/workspace/lib/settings.ts`
- **Claim:** Multiple exported helpers have zero call sites in the P1 workspace: `centsToDollars`, `normalizePhone`, `createPublicId`, `maskError` (foundation), `getSetting`, `setSetting` (settings). The plan lists these as P1 helper libs (R-164, R-161), but ponytail Rule of 2 requires 2+ real call sites right now.
- **Evidence:** `Grep centsToDollars|normalizePhone|createPublicId|maskError` matches only `lib/foundation.ts`. `Grep setSetting|getSetting` matches only `lib/settings.ts`. No admin page, no API route, no test imports them.
- **Rules:** `ponytail.mdc` ("No unrequested abstractions (Rule of 2). No boilerplate 'for later.'"); `clean-code.mdc` Abstraction Discipline (Rule of 2) and Dead Code category. Ponytail conflict protocol applies (plan vs ponytail) — default protocol-safe would be to flag, not silently ship speculative code.

---

## Minors

### m1 — PATCH rejects legitimate empty `overrides`
- **Location:** `arms/arm-05/workspace/app/api/staff/[staffId]/route.ts`
- **Claim:** The runtime guard `if (parsed.data.version === undefined || !parsed.data.role || !parsed.data.overrides)` rejects `overrides: {}` because `!{}` is `false`... actually `!{}` is `false`, so empty object passes — but `!parsed.data.overrides` is `false` for `{}`, so the guard does not fire. Re-checking: the real bug is that `!parsed.data.role` and `!parsed.data.overrides` treat `undefined` (missing) and the empty object the same way the schema already marks them optional. The guard fires only when they are `undefined`. The over-strict part is the error message: "A version, role, and overrides are required" — but the Zod schema already marks them optional, so the runtime guard is the sole enforcer. A caller sending `{ action: "update", version: 2 }` (intending "no change to role/overrides, just bump version") gets a 400 instead of a no-op or a 422.
- **Evidence:** `updateSchema` marks `version`, `role`, `overrides` as `.optional()`. The handler then manually requires all three for `action: "update"`, with no documented reason why a partial update is forbidden.
- **Rules:** `clean-code.mdc` Anti-AI-Tics ("No 'just in case' code — every line must have a reason"); `ponytail.mdc` (shortest working diff; no unrequested strictness).

### m2 — Admin sidebar is not permission-gated
- **Location:** `arms/arm-05/workspace/app/admin/layout.tsx`
- **Claim:** The sidebar renders the same three links (Overview, Staff & permissions, Security audit) to every visitor. The plan calls for a permission-gated sidebar (R-104) and the EXPECTED file item #7 says "Staff without permission gets 403 on gated pages." The layout has no permission awareness.
- **Evidence:** `AdminLayout` is a plain server component returning static `<Link>` elements; no `requirePermission`, no Clerk `auth()`, no conditional render. The CSS has a mobile media query but the layout itself has no mobile nav toggle.
- **Rules:** `clean-code.mdc` UI Consistency ("If a new screen looks different from the rest of the app, that's a bug" — here the inconsistency is access-control, not styling, but the rule's spirit applies); `workflow.mdc` Security Basics (least privilege).

### m3 — No impersonation banner despite stored impersonation state
- **Location:** `arms/arm-05/workspace/lib/staff-store.ts` (state `impersonatingId`), `arms/arm-05/workspace/app/admin/staff/page.tsx`
- **Claim:** `startImpersonation` sets `state.impersonatingId` and writes an audit event, but no UI reads `impersonatingId` to show a banner. The plan (R-099) and EXPECTED item #6 require "impersonation with banner + audit trail." Only the audit-trail half exists.
- **Evidence:** `Grep impersonatingId` matches only `lib/staff-store.ts`. No admin layout, no page, no client component reads it. `app/admin/staff/page.tsx` has an "Impersonate" button that fires PATCH and shows a one-line status message, then nothing persistent.
- **Rules:** `clean-code.mdc` UI Consistency (the impersonation state is invisible to the operator — inconsistent with the audit claim); `workflow.mdc` ("Verify in the running app").

---

## Counts

| Severity | Count |
|---|---|
| Blocker | 4 |
| Major | 4 |
| Minor | 3 |
| **Total** | **11** |
