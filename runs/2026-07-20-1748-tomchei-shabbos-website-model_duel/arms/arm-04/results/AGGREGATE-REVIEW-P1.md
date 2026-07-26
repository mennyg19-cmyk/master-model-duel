# P1 Aggregate Review — arm-04

**Phase:** P1 — Foundation, identity, roles, permissions, staff tooling
**Scope:** `arms/arm-04/workspace/` only.
**Sources:** P1-security, P1-quality, P1-rules, P1-clean-code (external reviewers).
**Mode:** Union + dedupe by location+claim. No new findings. No model attribution.

## Counts (post-dedupe)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 7 |
| Minor | 23 |

Dedupe notes: rules m3 (`maskError` dead code) merged into clean-code M2 (broader dead-export finding). All other findings are distinct location+claim. Security out-of-scope notes (no CSP, `StaffLoginSession` purge, `PermissionOverride.permission` String) carried forward as non-scored.

## Prioritized fix list (one pass, top to bottom)

### Blockers
None.

### Majors

1. **`AUTH_SESSION_SECRET` placeholder passes env validation** — `src/lib/env-spec.ts:57` only enforces `min(32)`; the `.env.example` placeholder validates clean and signs session + impersonation cookies. Reject known-weak placeholders, require entropy. *(from security)*
2. **Local provider trust boundary depends on `NODE_ENV` alone** — `src/lib/auth/local-session.ts:22` throws only when `NODE_ENV === 'production'`; a staging/test deploy with `AUTH_PROVIDER=local` accepts any active staff email with no password. Tighten the gate. *(from security)*
3. **No Clerk middleware despite plan + EXPECTED requiring it** — no `middleware.ts` anywhere under `workspace/`; plan § P1 and EXPECTED item 3 both call for "Clerk integration + middleware". Add `clerkMiddleware` wiring so `AUTH_PROVIDER=clerk` matches the promised runtime shape. *(from quality)*
4. **Stale-version failures silently swallowed in role/status actions** — `changeRoleAction` (`src/app/(admin)/admin/staff/actions.ts:38`) and `setStatusAction` (`:50`) discard the `Result` from `changeStaffRole`/`setStaffStatus`; a manager who loses a concurrent edit sees the winner's state with no error. Surface `stale_version` to the UI. *(from quality)*
5. **Pattern drift: `customers.ts` throws where the project returns `Result`** — `setCustomerPhone` (`src/lib/customers.ts:39`) throws on bad phone; every other server-side mutation returns `Result`. Convert to `Result` for one error-handling pattern. *(from clean-code)*
6. **Dead code / YAGNI across `core/` and `customers.ts` (Rule of 2)** — zero production call sites in P1 for `maskError`, `normalizeName`, `normalizeAddressLine`, `addHours`, `formatDate`, `newId`, `newToken`, `linkCustomerIdentity`, `setCustomerPhone`. `customers.ts` as a whole is speculative scaffolding. Delete until 2+ real call sites exist. *(from clean-code; subsumes rules m3 on `maskError`)*
7. **Duplicated client-error reporting with drift between `error.tsx` and `global-error.tsx`** — both inline the same `fetch('/api/client-error', …)` block; `error.tsx` swallows the catch silently (clean-code violation), `global-error.tsx` documents it. Extract one `reportClientError(error)` helper. *(from clean-code)*

### Minors (priority order)

**Input validation / error surfacing**
8. **Server-action enum casts without runtime validation** — `changeRoleAction`, `setStatusAction`, `setOverrideAction`, `inviteStaffAction` cast `formData` values with `as` (`src/app/(admin)/admin/staff/actions.ts:29,44,56,69`); invalid values yield an unhandled Prisma 500 instead of a user-facing validation failure. `setPermissionOverride` validates `permission` but skips `effect`. *(from security)*
9. **`version` parsed with `Number()` and not validated** — `changeRoleAction`/`setStatusAction` (`src/app/(admin)/admin/staff/actions.ts:43,55`); non-numeric yields `NaN`, relies on Prisma matching zero rows rather than an explicit guard. *(from security)*
10. **Unauthenticated, unrate-limited log endpoint** — `POST /api/client-error` (`src/app/api/client-error/route.ts:17`) is public, no rate limit, writes to `console.error` on every call. Log-DoS, not code-exec. *(from security)*
11. **Health endpoint echoes DB error message** — `/api/health` returns `error.message` (`src/app/api/health/route.ts:22`); Postgres connection errors commonly include the connection string. Return a static message. *(from security)*
12. **`linkCustomerIdentity` race throws unhandled** — `src/lib/customers.ts:15` does find-by-externalId, find-by-email, then create; two concurrent first-links for the same customer both pass the finds and the loser hits the unique constraint with no `try/catch`. Latent 500 for the P4 customer identity-link flow. *(from quality)*
13. **`signInLocally` TOCTOU on staff status** — `src/app/sign-in/actions.ts:22` finds the staff row with `status: 'ACTIVE'`, then later starts the session; a revoke between find and session start gives the user a cookie that 401s on the next request. Tell the user they were revoked at sign-in time. *(from quality)*
14. **`signInLocally` updates a row then reads the stale value** — `src/app/sign-in/actions.ts:29` mutates `externalAuthId` but `staff` still holds the pre-update object, so `startLocalSession` always takes the `??` fallback. Re-fetch or drop the fallback with a one-line comment. *(from clean-code)*

**UX / chrome**
15. **Driver hitting `/admin` sees admin chrome around the 403 body** — `src/app/(admin)/admin/layout.tsx:13` calls `requireStaff()` which passes for a signed-in driver; the page then throws `forbidden()`. Driver briefly sees admin header, "DRIVER" badge, "Visit store" link, empty sidebar. Throw `forbidden()` from the layout or redirect drivers. *(from quality)*
16. **`safeDestination` accepts any same-origin path** — `src/app/sign-in/actions.ts:58` blocks `//` but allows any `/…` path; `?next=/api/health` is a valid post-login redirect. Restrict to `/admin` or `/driver`. *(from security)*
17. **`setStaffStatus` re-stamps `confirmedAt` on every activation** — `src/lib/staff-service.ts:97` sets `confirmedAt: new Date()` on re-activation, so the field drifts from "first confirmation" to "most recent activation". *(from quality)*

**Audit trust**
18. **`x-forwarded-for` trusted as client IP** — `stampLogin` and audit rows store the header verbatim (`src/app/sign-in/actions.ts:39`, `src/lib/audit.ts:34`); attacker-controlled, so audit `ipAddress` is forgeable without a trusted-proxy whitelist. *(from security)*

**Smoke / CI evidence**
19. **Smoke P1-1 and P1-4 record PASS unconditionally** — `scripts/smoke.ts:72` and `:108` hardcode `true` after `changeRole()`/`setOverride()` return without re-fetching the staff row; combined with M2 (swallowed stale-version), the smoke would PASS even if the mutation did nothing. Assert against response state. *(from quality)*
20. **CI does not run the baseline seed script** — `.github/workflows/ci.yml` runs lint, typecheck, db:guard, test, build but never `npm run seed` (EXPECTED item 9). A broken `prisma/seed.ts` would not fail CI. *(from quality)*

**Naming (clean-code)**
21. **`result` used as a standalone variable** — `src/lib/staff-service.ts` (`changeStaffRole`, `setStaffStatus`), `src/app/(admin)/admin/staff/actions.ts` (`inviteStaffAction`), `src/app/setup/actions.ts` (`createFirstManager`). Banned vague name; rename to what it holds. *(from rules)*
22. **`item` used as a callback parameter** — `src/app/(admin)/admin/layout.tsx` (`visibleNav.filter((item) => …)`, `.map((item) => …)` x2). Banned vague name; rename to `navItem` / `entry`. *(from rules)*

**Type/schema drift**
23. **`ROLES` literal duplicates the Prisma `StaffRole` enum** — `src/app/(admin)/admin/staff/page.tsx:15` hand-types `['MANAGER','STAFF','DRIVER']` beside the schema enum. Derive via `Object.values(StaffRole)` or document the duplication. *(from clean-code)*
24. **Redundant type annotation after a type guard** — `src/lib/staff-service.ts:124` annotates `const permission: Permission = input.permission;` after `isPermission` already narrowed it. Drop the annotation. *(from clean-code)*

**Back navigation / UI consistency**
25. **Staff detail "Back to staff" link hardcoded** — `src/app/(admin)/admin/staff/[staffUserId]/page.tsx` hardcodes `/admin/staff` with no README-defined exception for back navigation. *(from rules)*
26. **`unauthorized.tsx` and `forbidden.tsx` are structural twins** — same shell, differ only in copy and link target. A shared `StatusNotice` component would remove the duplication (on the Rule-of-2 edge today). *(from clean-code)*

**Error handling / structure**
27. **Empty catch block in `db-server.ts` `startCluster`** — `scripts/db-server.ts:85` swallows all throws with only a comment; a real failure (auth, disk full) is indistinguishable from "database already exists". Narrow on the expected error code as `ensureDatabase` does on line 51. *(from clean-code)*
28. **`changeStaffRole` and `setStaffStatus` share a near-identical shape** — `guardSelfTarget` → `findUnique` → `updateStaffVersioned` → `recordAudit`, differing only in payload and audit action. Stable today; flag because two more staff mutations in P2 would tip past the Rule-of-2 threshold for extraction. *(from clean-code)*
29. **`scripts/smoke.ts` mixes concerns (272 lines)** — combines the smoke flow, staff-form helpers, an env-check subprocess wrapper, and a markdown report writer. Under the 500-line size threshold but mixed concerns; split into `smoke.ts` + `smoke-helpers.ts` + `smoke-report.ts` to enable reuse by later phases. *(from clean-code)*

**Tooling**
30. **`.codegraph/` not initialized in the workspace** — `codegraph` CLI is on PATH; the rule requires `codegraph init` before structural lookups when the index is missing and the CLI is available. *(from rules)*

## Out of scope (noted, not scored)

- No CSP or security headers in `next.config.ts` — defence-in-depth, not a P1 gate.
- `StaffLoginSession` rows written on every login and never purged — purge crons are P11/P12.
- `PermissionOverride.permission` is `String` in schema; code defends via `isPermission`. Schema hardening is a later-phase concern.

