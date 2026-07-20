# Reviewer — Rules — arm-01 (Test 4, P1)

**Arm:** arm-01
**Tree / phase:** `arms/arm-01/workspace/` — Phase P1 (foundation, identity, roles, permissions, staff tooling)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
**Reviewer:** orchestrator (independent of contestants)
**Scope:** findings only — adherence to arm-01's selected catalog rules.

---

## ponytail

- **MINOR — ladder tags absent.** No `ponytail:` comment anywhere in the tree. `src/lib/ids.ts:3` uses `node:crypto.randomBytes` (stdlib) instead of a `uuid`/`nanoid` dep, and `src/lib/money.ts`/`src/lib/dates.ts` use `Intl` instead of a date/currency library — both are deliberate stdlib-over-dep choices the rule asks to tag. Tag them so the next reader knows the shortcut was chosen, not lazy.
- **VIOLATION — dead code (deletion over addition).** `src/lib/safe-result.ts` exports `SafeResult` and `maskUnexpectedError`, but neither is imported anywhere in `src/`, `prisma/`, `scripts/`, or `tests/`. Rule: "Deletion over addition. No boilerplate 'for later.'" Remove the file or wire it into the API routes' error paths.
- **PASS — no god files.** Largest file is `src/app/(admin)/admin/staff/staff-manager.tsx` at 189 lines; everything is well under the 500-line split trigger. Files are split by concern (auth, permissions, db, env, ids, normalize, brand, dates, money, season).
- **PASS — no unrequested abstractions.** `Button` is the only shared component and has multiple call sites. No barrel files, no <5-line wrapper components, no speculative helpers.

## clean-code

- **PASS — Dependency Discipline (pin versions).** `package.json:21-39` pins every dependency and devDependency to an exact version (`@clerk/nextjs 7.5.20`, `@prisma/client 6.19.3`, `next 16.2.10`, `react 19.2.4`, `tsx 4.23.1`, etc.). No floating ranges. Stronger than the rule requires.
- **VIOLATION — Error Handling (over-broad catch).** `src/app/api/setup/route.ts:78-86` treats any `Prisma.PrismaClientKnownRequestError` as "Setup is locked." A unique-constraint violation on `StaffUser.clerkUserId` or `StaffUser.email` (e.g. a duplicate bootstrap attempt racing the lock) would be misreported as "Setup is locked" and return 409 instead of surfacing the real conflict. Narrow the check to `error.code === "P2002"` or rely on the `BOOTSTRAP_LOCKED` sentinel alone.
- **MINOR — Type/schema drift (client).** `src/app/(admin)/admin/staff/staff-manager.tsx:8-17` hand-declares a `StaffUser` type with the same shape Prisma already generates. It imports `StaffRole`/`StaffStatus` enums from `@prisma/client` (good), but the record shape is duplicated. A `type StaffUser = Pick<...>` from a shared module (or `Prisma.StaffUserGetPayload`) would keep the client in sync with schema changes. Acceptable that the full Prisma client isn't bundled into the client component; the shape still shouldn't be retyped by hand.
- **MINOR — Type drift (permissions).** `src/lib/permissions.ts:19-23` types `grantPermissions`/`denyPermissions` as `string[]` and `rolePermissions` as `Record<StaffRole, readonly Permission[]>`, while `hasPermission` compares `string` against `Permission`. The API route (`src/app/api/admin/staff/route.ts:105-106`) also accepts `string[]` for the override arrays. Narrow these to `Permission[]` so an invalid literal is caught at the boundary instead of silently stored.
- **MINOR — UI consistency (global-error inline colors).** `src/app/global-error.tsx:12-25` uses hardcoded hex colors (`#f7f3f7`, `#8f2f67`, `#241f2d`, `#6f6878`) instead of the `--brand`/`--ink`/`--muted` tokens. This is required — `global-error` renders outside the root layout and cannot load `globals.css` — so it's a legitimate exception, but the README doesn't document it. The clean-code "define explicit exceptions in the project README" clause wants that noted.
- **PASS — Naming.** No banned vague standalone names (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`). Collections are plural (`staffUsers`, `permissions`, `auditEvents`), booleans read as questions (`isLocked`, `isImpersonating`), function names describe the action (`requirePermission`, `normalizeEmail`, `createSecureToken`, `formatCents`, `getSeasonYear`).
- **PASS — Comments.** The code is almost comment-free; the few that exist (`AGENTS.md` nextjs-agent-rules block) carry non-obvious intent. No narration or change-explanation comments.
- **PASS — Consistency (one pattern per concern).** One persistence layer (Prisma via `lib/db.ts`), one auth path (`requirePermission` / `getCurrentStaffUser`), one styling approach (Tailwind tokens in `globals.css`), one test runner (`node:test` via `tsx`). README § Quality gates documents the choices.
- **PASS — Anti-AI-tics.** No try/catch around non-throwing code, no redundant type assertions, no "just in case" branches. `permissionError` rethrows non-AccessDenied errors rather than swallowing them.

## workflow

- **VIOLATION — audit coverage (impersonation end not audited).** `src/app/api/admin/impersonation/route.ts:63-70` (DELETE) clears the `impersonate_staff_id` cookie but writes no `AuditLog` row and never marks the open `ImpersonationSession.endedAt`. The start is audited (`staff.impersonation_started` at line 33-41), so the session is left permanently open in the table and the audit trail has no corresponding `staff.impersonation_ended`. This is the kind of trust-boundary gap the rule's "Never cut" list calls out (security / audit).
- **MINOR — self-protection guard gap.** `src/app/api/admin/staff/route.ts:116-124` blocks a manager from changing their own `role` or revoking themselves, but a manager can still PATCH their own `grantPermissions`/`denyPermissions` — i.e. grant themselves `staff:impersonate` or remove a personal deny. Close the gap: block self-edits of the override arrays too (or block all self-PATCH except no-op fields).
- **MINOR — impersonation stop not reachable from UI.** `StaffManager` (`staff-manager.tsx`) exposes "Impersonate" but no "Stop impersonating" control, even though the DELETE endpoint exists. An admin who impersonates must manually clear the cookie or wait out the 1-hour `maxAge`. The admin layout's impersonation banner (`admin/layout.tsx:30-35`) shows the state but offers no exit action.
- **PASS — Security Basics (`.env.example`).** `.env.example` exists with placeholders for `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLIENT_ERROR_TOKEN`. `.gitignore:34-35` ignores `.env*` and re-admits `!.env.example`. `scripts/generate-env-example.mjs` regenerates it.
- **PASS — secrets hygiene.** `.env` (present in the workspace) is gitignored; no secrets hardcoded in source. `lib/env.ts` fail-fast throws on missing `DATABASE_URL` at server startup via `lib/db.ts:4`.
- **PASS — cookie hardening.** `impersonation/route.ts:47-53` sets `httpOnly`, `sameSite: "lax"`, `secure: process.env.NODE_ENV === "production"`, `path: "/"`, `maxAge: 60 * 60`. Better than the arm-02 baseline.
- **PASS — audit coverage (rest).** `staff.invited`, `staff.revoked` / `staff.permissions_or_role_changed`, `staff.bootstrap_manager`, `staff.invitation_accepted` all written inside their transactions. Optimistic concurrency on `StaffUser.version` enforced via `updateMany` + 409 on `count !== 1` (`staff/route.ts:127-162`).
- **PASS — self-protection (rest).** Can't change own role/revoke (`staff/route.ts:117`), can't impersonate self (`impersonation/route.ts:9`), can't impersonate a non-ACTIVE target (`impersonation/route.ts:19`).
- **PASS — dev server hygiene.** Single web port 3101, db 4101, documented in README and `ARM.md`. No competing instances.
- **PASS — tone.** Plain English throughout comments, README, and error messages ("Managers cannot change their own role or revoke themselves.", "This staff record changed. Reload before saving again."). No jargon, no AI-isms.
- **PASS — PowerShell discipline.** No inline `$` in committed scripts; `scripts/` are `.ts`/`.mjs` run via `tsx`/`node`. The only `.ps1` lives under gitignored `.scratch/`.
- **PASS — untrusted-content boundary.** `client-errors/route.ts` bounds the body to 2 KB and slices `route`/`category` to fixed lengths before logging; no untrusted string reaches a query or shell.

## vocabulary

- **PASS — term accuracy.** README and code use exact terms ("P1", "foundation", "first manager", "bootstrap lockout", "impersonation", "audit trail"). No refactor/tidy/rebuild commands were issued this phase, so the scope table isn't exercised.
- **PASS — pattern match.** README § Quality gates and § P1 routes document the one-pattern-per-concern choices; the code follows each (server components for reads, route handlers for mutations, Prisma for persistence, Tailwind tokens, `node:test`).

## codegraph

- **PARTIAL — index present, process not verifiable.** `.codegraph/` exists in the workspace, so `codegraph init` was run. The rule's hard requirement — use CodeGraph (MCP/CLI) for all structural lookups, no grep-for-symbols — governs the development process and cannot be confirmed from the build artifact alone. No findings against the artifact; flagged as non-evaluable for process adherence.

## grill-protocol

- **NOT OBSERVABLE.** Grill governs pre-build product clarification. No `.scratch/grill-notes.md` or grill artifact is present in the workspace, and P1 is a foundation phase with a frozen plan, so there's no transcript to grade. No findings; non-evaluable from output.

---

## Summary

| Rule | Findings | Severity |
|---|---|---|
| ponytail | 1 violation (dead `safe-result.ts`) + 1 minor (no ladder tags) | mixed |
| clean-code | 1 violation (over-broad Prisma catch in setup) + 3 minor (client type drift, loose permission typing, undocumented global-error inline-color exception) | mixed |
| workflow | 1 violation (impersonation end not audited / session never closed) + 2 minor (self-edit of own override arrays; no stop-impersonation UI) | mixed |
| vocabulary | 0 | clean |
| codegraph | index present; process not verifiable | n/a |
| grill-protocol | not observable | n/a |

Strongest areas: exact version pinning, fail-fast env validation, cookie hardening, optimistic-concurrency on staff updates, audit coverage for the start of every security mutation, plain-English tone, and one-pattern-per-concern discipline. Weakest: the impersonation lifecycle is half-audited (start yes, end no) and the `safe-result.ts` module is dead code — both are cheap fixes that close a security-trail gap and remove unused surface.
