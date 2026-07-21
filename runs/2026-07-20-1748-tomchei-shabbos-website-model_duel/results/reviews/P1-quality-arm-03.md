# P1 Quality review — arm-03

Reviewer specialist: Quality
Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Tree: `arms/arm-03/workspace/`
Phase: P1 — Foundation, identity, roles, permissions, staff tooling
Source rubric: `kit/prompts/reviewer/review-quality.md` (focus: correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED)

## Summary

P1 lands in a clean, readable state. The Next.js + TS + Prisma scaffold, route groups, Zod env validation, `/api/health`, dev/Clerk auth, StaffUser roles with grant/deny overrides, customer/staff separation, first-run setup lock, staff management UI, admin shell, design tokens, CI scripts, and concurrency smoke are all present and internally consistent. The smoke log reproduces EXPECTED S1–S5 plus the manager-passes-gated-route extra, and the concurrency smoke reports 1 winner / 9 conflicts. The findings below are quality gaps — none block P1, but several should be fixed before later phases lean on this foundation.

**Finding count: 14**

---

## Findings

### Q1 — Stopping impersonation via the banner is not audited
**Severity:** medium · **Kind:** broken flow / audit integrity
`src/components/admin/shell.tsx:34-37` renders the banner "Stop" link as `<a href="/admin/staff?stopImpersonation=1">`. That path is handled in `src/app/(admin)/admin/staff/page.tsx:13-22`, which calls `db.impersonationSession.updateMany({ ..., data: { active: false, endedAt: new Date() } })` with **no** `writeAudit` call. The audited `DELETE /api/impersonate` route (`src/app/api/impersonate/route.ts:59-82`) writes `IMPERSONATION_ENDED` but is not wired to any UI element. So in practice every impersonation stop is unaudited, breaking EXPECTED item 6 ("impersonation with banner + audit trail") and weakening S5 (which only asserts `IMPERSONATION_STARTED`). Wire the banner to the audited DELETE endpoint (or have the staff-page stop path call `writeAudit` with `IMPERSONATION_ENDED`). Note also the DELETE endpoint gates on `admin.access` rather than `staff.impersonate` — a separate inconsistency.

### Q2 — Setup bootstrap race can create multiple managers
**Severity:** medium · **Kind:** correctness (concurrency)
`src/app/api/setup/route.ts:27-46` calls `assertSetupUnlocked()` (manager count + lock check), then creates the manager, then sets the lock — no transaction, no atomic guard. Two concurrent bootstrap POSTs with different emails both pass the check (managerCount 0, no lock) and both insert a manager before either sets the lock. `StaffUser.email` is unique, so same-email collisions are protected, but different-email concurrent bootstraps violate the single-manager invariant in EXPECTED item 5 ("bootstraps first manager … then locks"). Wrap check + create + lock in a single `db.$transaction` and/or gate on an atomic upsert of the `SETUP_LOCK_KEY` row before creating the manager.

### Q3 — `VersionedFixture` test scaffold leaks into the production Prisma schema
**Severity:** medium · **Kind:** schema quality / stub
`prisma/schema.prisma:123-128` ships a `VersionedFixture` model, and `prisma/migrations/20260721142648_p1_foundation/migration.sql:90-98` creates the table, purely to back `scripts/concurrency-smoke.ts`. Test scaffolding belongs outside the production schema that later phases extend. Drop it from the schema and have the smoke create its own throwaway table/DB, or move it behind a test-only schema. Shipping a `payload String` fixture table in the real DB is debt every future migration inherits.

### Q4 — `requirePermission` recomputes permissions instead of using `ctx.permissions`
**Severity:** low · **Kind:** correctness / duplicated resolution
`src/lib/auth.ts:129-130` calls `hasPermission(ctx.effectiveStaff, ctx.effectiveStaff.permissionOverrides, permission)`, which re-resolves the role + override set on every gated API call, ignoring the `ctx.permissions` Set already computed in `getStaffContext` (`auth.ts:110-113`). The page-side gate (`src/lib/admin-gate.ts:13`) uses `ctx.permissions.has(permission)` directly. Both paths yield the same result today, but they are two resolution strategies that can drift; an override that changes resolution order would silently desync API vs page gates. Use `ctx.permissions.has(permission)` in `requirePermission` for consistency.

### Q5 — Impersonation banner copy is inverted
**Severity:** low · **Kind:** correctness (UX)
`src/components/admin/shell.tsx:33` renders `Impersonating {effectiveName}. Acting as {actorName}.` where `effectiveName` is the impersonated target and `actorName` is the real signed-in user (`src/app/(admin)/layout.tsx:16-17`). Semantically the actor is acting *as* the target, so "Acting as" should name `effectiveName`. The current copy reads "Impersonating Target. Acting as Me," which is backwards and confusing for the operator. Prefer `You are {actorName} acting as {effectiveName}` or swap the "Acting as" reference to `effectiveName`.

### Q6 — `STAFF_INVITED` audit meta stores the raw invitation token
**Severity:** low · **Kind:** correctness (info-leak)
`src/app/api/staff/route.ts:86-91` writes `meta: { invitationToken: created.invitationToken }` into the audit log. The invitation token is a credential (`createInvitationToken` returns 24 random bytes, base64url); logging it in plaintext audit rows means anyone with `audit.read` (default STAFF role) can redeem invitations. The token already lives on the `StaffUser.invitationToken` column. Store only a hash or omit the token from audit meta.

### Q7 — Staff `confirm` intent reuses `revokeSchema` and skips existence/version handling
**Severity:** low · **Kind:** correctness
`src/app/api/staff/route.ts:190-200` parses the confirm body with `revokeSchema` (just `staffUserId`), calls `db.staffUser.update` without checking existence, does not increment `version`, and lets a missing target throw Prisma P2025 → caught by `handleError` → 500 instead of 404. Role and revoke intents increment version and check existence; confirm is inconsistent. Use a dedicated schema, check existence (return 404), and increment version.

### Q8 — `revoke` and `override` edits skip optimistic-concurrency version check
**Severity:** low · **Kind:** correctness (concurrency)
The `role` intent requires `expectedVersion` and returns 409 on conflict (`route.ts:113-122`), but `revoke` (`route.ts:178-181`) and `override` upsert/delete (`route.ts:144-163`) mutate without an `expectedVersion`. Two managers editing the same staff row concurrently will silently clobber. EXPECTED item 10 only requires the concurrency smoke for versioned updates, but the staff editor should be consistent — either all versioned or none — especially since `revoke` already increments `version`.

### Q9 — `settings.write` permission and `setSetting` helper have no surface area
**Severity:** low · **Kind:** stub / dead surface
`src/lib/permissions.ts:8` defines `settings.write`, and `src/lib/settings.ts:10-33` exposes `setSetting` with optimistic-concurrency support, but no P1 route or UI calls them — the settings page (`src/app/(admin)/admin/settings/page.tsx`) only reads. The permission is dead surface area in P1 and the typed settings store is exercised only by the setup route's lock write. Either wire a settings write route or omit the permission until P2.

### Q10 — Concurrency smoke is deterministic, not a real read-modify-write race
**Severity:** low · **Kind:** missing smoke (depth)
`scripts/concurrency-smoke.ts:13-32` fires 10 `Promise.all` updates against the same version, but Prisma's `updateMany` with `where: { id, version }` is a single atomic SQL `UPDATE … WHERE version = ?` — exactly one row matches, the rest get 0 affected. The 1 winner / 9 conflicts result is guaranteed by SQL semantics, not by application-level optimistic concurrency over a read-modify-write cycle. It satisfies EXPECTED item 10 literally, but it does not exercise a true race where two callers both read version N then both attempt to write. Acceptable for P1; note it so later phases don't mistake this for a load test or a real OCC validation.

### Q11 — `smoke.mjs` S5 "role change" is a no-op (driver → DRIVER)
**Severity:** low · **Kind:** missing smoke (coverage)
`scripts/smoke.mjs:71-75` changes the driver's role to `"DRIVER"` (its current role) just to produce a `STAFF_ROLE_CHANGED` audit row. The `version` increments so the audit fires, but the smoke never tests an actual role transition (e.g. STAFF → DRIVER → STAFF). A regression that breaks audit on a real transition, or that breaks the role-change value path, would still pass. Change to a real transition and assert the new role in the response.

### Q12 — `getStaffContext` first-link branch skips the LOGIN audit
**Severity:** low · **Kind:** correctness (audit consistency)
`src/lib/auth.ts:85-89` — when a staff row exists but has no `clerkUserId`, the code links the Clerk id and updates `lastLoginAt` but does **not** write a `LOGIN` audit row, and the `lastLoginAt` update isn't gated by the 60s throttle used by the else-branch (`auth.ts:90-100`). EXPECTED doesn't require a LOGIN audit per se, but the code clearly intends one for every login; the first-link path silently diverges. Either write the LOGIN audit on first link or document that linking is not a login.

### Q13 — `/api/health` calls `resetEnvCache()` on every request
**Severity:** low · **Kind:** correctness / perf
`src/app/api/health/route.ts:9` invalidates the env cache on each health check. Health is polled by liveness probes; re-parsing `process.env` with Zod on every probe is wasteful, and a transient parse error turns the probe red even though the app is healthy. Env is static after boot — drop `resetEnvCache()` from the hot path (call it only in tests or a dedicated admin env-reload route).

### Q14 — Audit log page and API disagree on page size
**Severity:** low · **Kind:** correctness (consistency)
`src/app/(admin)/admin/audit/page.tsx:11` takes 50 entries; `src/app/api/audit/route.ts:10` takes 100. Same data, two limits, no pagination. The API returns more than the page renders, so a manager using the API sees different audit history than the page. Pick one default and document it, or add pagination before the log grows past the smaller limit.
