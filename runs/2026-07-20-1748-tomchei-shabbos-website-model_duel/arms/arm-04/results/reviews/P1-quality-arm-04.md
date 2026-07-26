# P1 Quality Review — arm-04 (blind)

**Phase:** P1 — Foundation, identity, roles, permissions, staff tooling
**Scope:** `arms/arm-04/workspace/` only. Findings only — no fixes.
**Reviewer:** external quality specialist
**Date:** 2026-07-26
**Plan ref:** `shared/MERGED-BUILD-PLAN.md` § P1; EXPECTED `shared/phases/PHASE-P1-EXPECTED.md`

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 6 |

All 10 EXPECTED items are satisfied and the smoke run reports 24/24 PASS. The foundation is coherent: route groups `(storefront)` / `(admin)` / `(driver)` exist; env validation fails fast with a clear message (`src/lib/env.ts:13`); health checks DB + env (`src/app/api/health/route.ts:12`); bootstrap locks in one transaction with a unique-key guard (`src/lib/bootstrap.ts:42`); customers are a separate table with no role column (`prisma/schema.prisma:83`); the permission model — role defaults, GRANT/DENY overrides, deny-wins — is unit-tested (`tests/permissions.test.ts`) and enforced through a single `requirePermission` gate (`src/lib/auth/staff.ts:66`); optimistic concurrency is unit-tested at 10 concurrent writers (`tests/concurrency.test.ts:13`); CI runs lint, typecheck, migration guard, DB-backed tests, and build (`.github/workflows/ci.yml`); design tokens, brand constants, and both `error.tsx` + `global-error.tsx` boundaries are in place.

The two majors are a missing plan deliverable (Clerk middleware) and a UI that swallows the optimistic-concurrency signal the service layer already produces. Minors are smoke-test evidentiary gaps, a UX leak around the 403 boundary, and latent races not exercised by the smoke.

## Blocker

None.

## Major

### M1 — No Clerk middleware despite plan + EXPECTED requiring it
EXPECTED item 3 and the plan § P1 deliverable both call for "Clerk integration + middleware". There is no `middleware.ts` anywhere under `arms/arm-04/workspace/` (confirmed by glob). The arm relies entirely on per-page `requirePermission` server gates. This works for the `local` provider (the smoke runs `AUTH_PROVIDER=local`) and would also resolve identity for `clerk` via `currentUser()` in `src/lib/auth/identity.ts:26`, but the standard Clerk session-refresh / redirect-to-sign-in middleware layer is absent. The code comment at `src/lib/auth/staff.ts:62` explicitly chooses 401/403 over redirect "so the status code is observable by tests" — a deliberate deviation, but it does not match the "Clerk + middleware" P1 gate. Under `clerk` the `/admin` layout calls `requireStaff()` which calls `getExternalIdentity()` → `currentUser()`; without middleware, Clerk session refresh and the `clerkMiddleware` protection layer are not wired, so a deployer who flips `AUTH_PROVIDER=clerk` gets a different runtime shape than the plan promised.

### M2 — Stale-version failures are silently swallowed in role/status actions
`changeRoleAction` (`src/app/(admin)/admin/staff/actions.ts:38`) and `setStatusAction` (`src/app/(admin)/admin/staff/actions.ts:50`) call `changeStaffRole` / `setStaffStatus` and discard the returned `Result`. `updateStaffVersioned` (`src/lib/staff-service.ts:19`) returns `stale_version` when the version doesn't match — the concurrency test proves this works at the service layer. But the actions `revalidatePath('/admin/staff')` and return without surfacing the conflict, so a manager who loses a concurrent edit sees the winner's state reload with no error message. The optimistic-concurrency contract is enforced in the service and verified by `tests/concurrency.test.ts`, but the UI path that real managers use never tells the user their edit was rejected. `setOverrideAction` has the same shape but `setPermissionOverride` upserts on a unique key (no versioning), so it is not affected.

## Minor

### m1 — Smoke P1-1 and P1-4 record PASS unconditionally
`scripts/smoke.ts:72` records `P1-1` "Role change through the staff table" with a hardcoded `true` after `changeRole()` returns, without re-fetching the staff row to confirm the role actually changed. `scripts/smoke.ts:108` does the same for `P1-4` "Deny beats the role default" after `setOverride()`. Both `changeRole` and `setOverride` throw only on HTTP ≥ 400; `changeRoleAction` revalidates and returns 200 even on a stale-version failure (see M2), so the smoke would report PASS even if the underlying mutation did nothing. The other 22 checks assert against response state; these two do not.

### m2 — Driver hitting `/admin` sees admin chrome around the 403 body
`src/app/(admin)/admin/layout.tsx:13` calls `requireStaff()`, which passes for a signed-in driver (they are a valid `StaffUser`). The page then calls `requirePermission('dashboard.view')` which throws, rendering `forbidden.tsx` inside the layout. The driver therefore sees the admin header — their email, a "DRIVER" badge, a "Visit store" link, and an empty permission-filtered sidebar — around the 403 message. The smoke passes (status 403, P1-5), but the driver is briefly exposed to admin chrome. A `forbidden()` thrown from the layout level (or a driver-specific redirect) would avoid the leak.

### m3 — `signInLocally` TOCTOU on staff status
`src/app/sign-in/actions.ts:22` finds the staff row with `status: 'ACTIVE'`, then later updates `externalAuthId`, stamps the login, and starts the session. If a manager revokes the account between the find and the session start, the user receives a valid signed cookie that fails on the next protected request (401 from `getStaffContext`'s `status: 'ACTIVE'` filter). Not a security bypass — the next request 401s — but a just-revoked user gets a confusing "signed in then immediately locked out" experience instead of being told they were revoked at sign-in time.

### m4 — `linkCustomerIdentity` race throws unhandled
`src/lib/customers.ts:15` does find-by-externalId, find-by-email, then create. Two concurrent first-links for the same new customer both pass the finds; the loser hits the unique constraint on `normalizedEmail` or `externalAuthId` and throws an unhandled `PrismaClientKnownRequestError` (no `try/catch`, no `Result` return). Not exercised by P1 smoke (customers aren't linked in P1), but the function is imported by `tests/bootstrap.test.ts` and is a latent 500 for the customer identity-link flow that P4 will call.

### m5 — CI does not run the baseline seed script
EXPECTED item 9 says "baseline seed runs". The `seed` script exists (`package.json:19`) and works in dev, but `.github/workflows/ci.yml` runs `lint`, `typecheck`, `db:guard`, `test`, and `build` — never `npm run seed`. The `test` script runs `test:db` (migrates a throwaway `tomchei_test` DB) then the node tests, which create their own fixtures via `db.staffUser.create`. If `prisma/seed.ts` broke (e.g. a schema field rename), CI would not catch it. The seed path is only exercised manually or by the smoke run.

### m6 — `setStaffStatus` re-stamps `confirmedAt` on every activation
`src/lib/staff-service.ts:97` sets `confirmedAt: new Date()` whenever activating, even when re-activating an account that was previously active then revoked. `confirmedAt` loses its meaning as "first confirmation timestamp" and becomes "most recent activation". Not wrong, but the field semantics drift from what the schema comment implies.

## Out of scope (noted, not scored)

- `StaffLoginSession` rows are written on every login and never purged — purge crons are P11/P12.
- `PermissionOverride.permission` is `String` in schema; code defends via `isPermission`. Schema hardening is a later-phase concern.
- No CSP / security headers in `next.config.ts` — defence-in-depth, not a P1 quality gate.
- `x-forwarded-for` trusted as client IP in audit/login stamps — flagged in the security review; not a quality-correctness issue.

## Counts

```
blocker: 0
major:   2
minor:   6
```
