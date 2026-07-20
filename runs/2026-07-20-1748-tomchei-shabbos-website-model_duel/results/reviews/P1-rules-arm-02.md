# Reviewer — Rules — arm-02 (Test 4, P1)

**Arm:** arm-02
**Tree / phase:** `arms/arm-02/workspace/` — Phase P1 (foundation, identity, roles, permissions, staff tooling)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Reviewer:** orchestrator (independent of contestants)
**Scope:** findings only — adherence to arm-02's selected catalog rules.

---

## ponytail

- **PASS — ladder tags present.** `lib/cn.ts:1` (`// ponytail: no clsx/tailwind-merge dependency`) and `lib/auth/passwords.ts:3` (`// ponytail: node stdlib scrypt instead of a bcrypt dependency`) tag deliberate stdlib-over-dep choices. `lib/audit.ts` and `lib/customers.ts` reuse the existing Prisma dep instead of new packages.
- **MINOR — redundant work after a gate.** `app/(admin)/admin/page.tsx:6,17` re-runs `getStaffContext()` (a DB roundtrip) after `app/(admin)/admin/layout.tsx:18` already resolved staff and redirected on null. The `staff?.actingAs.name` chaining is defensive for a condition the layout guarantees can't happen. Reuse the layout-resolved staff via context, or drop the re-query.
- **MINOR — audit fidelity.** `app/api/staff/[id]/route.ts:39` logs `staff.role_change` whenever `role` is set, even when `status` is also set in the same PATCH. The action label collapses both mutations; the `detail.from/to` captures both, but the action string loses one.
- **PASS — no god files.** Largest is `components/staff-manager.tsx` at 241 lines; everything is under the 500-line split trigger. Files are split by concern (auth/session, auth/permissions, auth/passwords, audit, customers, brand, cn, env).

## clean-code

- **VIOLATION — Dependency Discipline (pin versions).** `package.json:20-38` pins `next`, `react`, `react-dom` exactly but floats everything else on `^`: `@clerk/nextjs ^7.5.20`, `@prisma/client ^6.19.3`, `zod ^4.4.3`, and all devDeps (`@tailwindcss/postcss ^4`, `embedded-postgres ^18.4.0-beta.17`, `tsx ^4.23.1`, etc.). Rule: "Pin versions -- no floating ranges."
- **VIOLATION — Consistency (one env access pattern).** `middleware.ts:17` reads raw `process.env.AUTH_MODE` while `app/api/auth/login/route.ts:13` and `app/api/health/route.ts:10` use the validated `env` singleton from `lib/env.ts`. Two patterns for the same concern. The zod loader is plain module code and runs fine on the edge runtime, so the drift isn't forced.
- **MINOR — Anti-AI-tics (defensive code for impossible condition).** `app/(admin)/admin/page.tsx:17` uses `staff?.actingAs.name` after the layout's `getStaffContext` + redirect guarantees `staff` is non-null. Either trust the gate or move the query out.
- **MINOR — Type/schema drift.** `components/staff-manager.tsx:11-18` redeclares `StaffMember` with hand-typed `"MANAGER" | "STAFF" | "DRIVER"` and `"ACTIVE" | "REVOKED"` unions instead of sourcing them from a shared constant. Acceptable that it can't import `@prisma/client` types into a client bundle, but the role/status literals should come from one place (e.g. extend `lib/auth/permissions.ts`) so a Prisma enum change doesn't silently drift the client.
- **MINOR — Type drift (internal).** `lib/auth/permissions.ts:21` types `OverrideInput.permission: string` then casts `override.permission as Permission` at line 27. The API route (`app/api/staff/[id]/overrides/route.ts:10`) already narrows with `z.enum(ALL_PERMISSIONS)`, so the loose internal type is unnecessary — narrow `OverrideInput.permission` to `Permission`.
- **NOTE — UI consistency (inline styles).** `app/global-error.tsx:6-9` uses inline `style={{...}}`. This is required by Next.js (global-error renders outside the root layout and can't load `globals.css`), so it's a legitimate exception — but the README doesn't document it, which the "define explicit exceptions in the project README" clause asks for.
- **MINOR — Back navigation.** `app/forbidden.tsx:12` hardcodes `/admin` and `app/unauthorized.tsx:10` hardcodes `/login`. These are error-page entry links rather than browser-back buttons, so borderline; the rule wants back buttons to return to origin and exceptions documented in README. README defines none.
- **PASS — Naming.** No banned vague standalone names (`data`, `result`, `info`, `temp`, `val`, `item`). Collections plural (`overrides`, `staffMembers`), booleans read as questions (`isImpersonating`, `isEditingOverrides`, `isSubmitting`, `canImpersonate`), function names describe the action (`resolvePermissions`, `findOrLinkCustomer`, `writeAudit`, `requirePermissionApi`).
- **PASS — Comments.** All comments are non-obvious and reference inventory IDs (R-132/R-191 in `app/api/client-error/route.ts:8` and `app/error.tsx:15`, R-142 in `prisma/seed.ts:6`, G-024 in `scripts/concurrency-smoke.ts:5`). No narration or change-explanation comments.
- **PASS — UI consistency.** Shared `components/ui/` primitives (Button, Input, Select, Card, Badge) reused across every screen. Tailwind tokens centralized in `app/globals.css`. Storefront header (`app/(storefront)/page.tsx:8`) uses the same `bg-brand` as the admin sidebar.

## workflow

- **VIOLATION — Security Basics (`.env.example`).** `lib/env.ts:25` and `README.md` both reference `.env.example`, but no `.env.example` file exists in the workspace. Rule: "`.env.example` with placeholders for every secret." Missing placeholders for `DATABASE_URL`, `SESSION_SECRET`, `AUTH_MODE`, and the optional `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`.
- **PASS — secrets hygiene.** `.gitignore:34,45` ignores `.env*` and `.env`. `.pgdata/` and `.scratch/` ignored.
- **PASS — fail-fast env.** `instrumentation.ts:3` imports `lib/env` so the zod schema runs at server startup with a clear error listing every missing var.
- **MINOR — Security (cookie `secure` flag).** `lib/auth/session.ts:22-27` sets the session cookie `httpOnly`, `sameSite: "lax"`, but not `secure: true`. Defensible for dev over HTTP; the README marks dev as the tested path and clerk as production, but doesn't flag that the cookie config needs to flip for any non-dev deployment.
- **MINOR — session cleanup.** `lib/auth/session.ts:38` returns null for expired sessions but never deletes the expired row. Expired rows accumulate; `readSession` is the natural place to clean them up, or a scheduled job.
- **PASS — audit coverage.** Every security-relevant mutation writes audit: `staff.create`, `staff.role_change`, `staff.status_change`, `staff.permission_overrides_change`, `staff.impersonation_start`, `staff.impersonation_stop`, `setup.bootstrap_manager`. Revocation kills live sessions (`app/api/staff/[id]/route.ts:35`).
- **PASS — self-protection guards.** Can't change own role/status (`app/api/staff/[id]/route.ts:16`), can't edit own overrides (`app/api/staff/[id]/overrides/route.ts:22`), can't impersonate self or while already impersonating (`app/api/impersonate/route.ts:12,18`).
- **PASS — dev server hygiene.** Single web port 3102, db 4102, documented in README. `scripts/db-start.ts:31-37` handles SIGINT/SIGTERM and stops the cluster cleanly.
- **PASS — tone.** Comments and docs are plain English, no jargon, no AI-isms.
- **PASS — PowerShell discipline.** No inline `$` in committed scripts; `scripts/` and `prisma/` are tsx scripts run via `tsx`, not PowerShell one-liners.

## vocabulary

- **PASS — term accuracy.** README and comments use exact terms ("greenfield rebuild", "Phase P1", "baseline seed", "first manager", "bootstrap lockout"). No refactor/tidy command scope to evaluate in this phase.
- **PASS — pattern match.** README § Patterns documents one pattern per concern (Prisma via `lib/db.ts`, `requirePermissionPage`/`requirePermissionApi`, Zod at every API boundary, Tailwind tokens, `writeAudit`); the code follows each.

## codegraph

- **NOT OBSERVABLE.** The codegraph rule governs the development process (use `codegraph` CLI/MCP for structural lookups; no grep-for-symbols). No `.codegraph/` index is present in the workspace, and process adherence can't be verified from the build artifact alone. No findings; flagged as non-evaluable from output.

---

## Summary

| Rule | Findings | Severity |
|---|---|---|
| ponytail | 2 minor (redundant gate re-query; audit action label collapses role+status) | minor |
| clean-code | 2 violations (floating dep ranges; two env-access patterns) + 4 minor/notes (defensive `?.`, client union drift, loose internal type, undocumented inline-style/back-link exceptions) | mixed |
| workflow | 1 violation (missing `.env.example`) + 2 minor (cookie `secure` flag; expired-session cleanup) | mixed |
| vocabulary | 0 | clean |
| codegraph | not observable from artifact | n/a |

Strongest areas: naming, comment quality, audit coverage, self-protection guards, UI primitive reuse, fail-fast env validation. Weakest: dependency pinning and the missing `.env.example` (both reference the same security/consistency rules and are cheap fixes).
