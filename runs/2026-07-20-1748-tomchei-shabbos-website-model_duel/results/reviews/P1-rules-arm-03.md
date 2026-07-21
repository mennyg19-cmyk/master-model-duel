# P1 Rules Review — arm-03

Phase: P1 (Foundation, identity, roles, permissions, staff tooling)
Arm rules: ponytail, clean-code, workflow, vocabulary, codegraph
Scope: `arms/arm-03/workspace/` source for P1.
Findings only. No model names.

## Critical

1. **Setup bootstrap race (TOCTOU).** `assertSetupUnlocked` in `src/lib/auth.ts:154` checks manager count + lock, then `POST /api/setup` (`src/app/api/setup/route.ts:27`) creates the manager and calls `setSetting` to lock. Two concurrent POSTs on an empty DB both pass the check and both create managers. No transaction, no unique lock row, no `upsert`-as-lock. EXPECTED S4 ("setup locks") can be violated under concurrency. Trust-boundary + data-integrity.

2. **Impersonation stop permission mismatch.** Starting impersonation requires `staff.impersonate` (`src/app/api/impersonate/route.ts:25`), but `DELETE` (stop) requires `admin.access` (`:61`). A staff granted `staff.impersonate` without `admin.access` can start but cannot stop. The `AdminShell` "Stop" link (`src/components/admin/shell.tsx:35`) also routes through `/admin/staff` which needs `staff.manage`. Three different gates for one lifecycle.

3. **Invitation token is dead code.** `POST /api/staff` (`src/app/api/staff/route.ts:76`) generates `invitationToken` and writes a `STAFF_INVITED` audit entry, but no endpoint redeems the token. The `confirm` intent (`:190`) requires `staff.manage`, not the token. Token is created, audited, and never consumed — incomplete feature shipped as if complete.

## Major

4. **Two error-handling patterns.** `src/lib/result.ts` defines `Result` + `maskError` used by `customers.ts`/`settings.ts`/`client-error` route, but `staff`, `impersonate`, `audit`, `setup`, `admin/gated` routes use local `handleError`/try-catch returning raw `error.message`. clean-code § Consistency: one error-handling approach per project. Violated.

5. **Internal error leakage in non-prod paths.** `setup`, `staff`, `impersonate`, `audit` routes return `error.message` (or `String(error)`) to the client with no `NODE_ENV` masking. `maskError` exists but is unused here. `result.ts` § Error Handling + clean-code § Anti-Hallucination both expect masked messages.

6. **`requirePermission` re-resolves permissions instead of using `ctx.permissions`.** `src/lib/auth.ts:130` calls `hasPermission(ctx.effectiveStaff, ctx.effectiveStaff.permissionOverrides, permission)` while `getStaffContext` already computed `ctx.permissions` (`:110`). Two resolution paths for the same check; clean-code § Consistency. Use `ctx.permissions.has(permission)`.

7. **Setup-lock enforcement diverges page vs API.** `requireAdminPage` (`src/lib/admin-gate.ts:6`) redirects to `/admin/setup` when incomplete, but `requirePermission` (API) does not check setup state — it just returns 401 via `getStaffContext`. Same gate, two behaviors.

8. **Impersonation end via query param skips audit.** `src/app/(admin)/admin/staff/page.tsx:13` ends impersonation with `updateMany` but writes no `IMPERSONATION_ENDED` audit entry, unlike the `DELETE /api/impersonate` path (`src/app/api/impersonate/route.ts:72`). EXPECTED S5 expects impersonation in the audit trail; the stop path breaks it.

9. **`AdminShell` "Stop" form is dead markup.** `src/components/admin/shell.tsx:34` wraps an anchor in `<form action="/api/impersonate" method="dialog">`. `method="dialog"` does nothing for an anchor; the form is decorative. Misleading and non-functional.

10. **Speculative helpers shipped ahead of need.** `src/lib/season.ts`, `src/lib/dates.ts`, `src/lib/money.ts`, `normalizeWhitespace`/`normalizeKey` (`src/lib/normalize.ts`), `createId` (`src/lib/ids.ts`), `formatPhone` (`src/lib/phone.ts`), and `designTokens` (`src/lib/brand.ts`) have no P1 call sites. ponytail § YAGNI / "No boilerplate for later." `money.ts` is also advertised in README § Patterns despite being unused.

## Minor

11. **Design tokens duplicated.** `src/lib/brand.ts` `designTokens` and `src/app/globals.css` `:root` define the same radius/font values. Two sources of truth; clean-code § type/schema drift. `designTokens` is also unused (see 10).

12. **`staff/route.ts` POST misses staff email collision.** Checks `db.customer.findUnique` (`:63`) but not `db.staffUser.findUnique`; a duplicate staff email throws Prisma P2002, caught as 500 instead of 409.

13. **`confirm` intent reuses `revokeSchema` and skips version guard.** `src/app/api/staff/route.ts:190` parses the confirm body with `revokeSchema` (naming smell) and applies no `expectedVersion`, unlike `role`. No self-confirm check either.

14. **`revoke` has no optimistic concurrency.** `revokeSchema` (`:29`) omits `expectedVersion`; revoke can clobber a concurrent role change. Inconsistent with `role` intent.

15. **`StaffManager` doesn't handle 409.** `changeRole`/`setOverride`/`revoke` set `message = json.error` on failure; no version refresh or reload prompt. The API returns `conflict: true` (`:118`) that the client ignores.

16. **Audit query duplicated.** `src/app/api/audit/route.ts:8` (take 100) and `src/app/(admin)/admin/audit/page.tsx:9` (take 50) re-run the same `findMany` with different limits. Two sources for one concern.

17. **`stopIfLocked` is dead code.** `src/app/(admin)/admin/setup/page.tsx:19` exports a function with no caller.

18. **`SETUP_LOCK_KEY` re-exported from `auth.ts`.** `src/lib/auth.ts:160` re-exports the constant already exported from `src/lib/constants.ts`. Redundant barrel-like surface.

19. **`health/route.ts` calls `resetEnvCache()` every request.** `src/app/api/health/route.ts:9` defeats the env cache on each health probe. Perf nit, but it's a hot-path smell.

20. **`getStaffContext` auto-binds `clerkUserId` without audit.** `src/lib/auth.ts:85` links a staff record to a Clerk identity by email match and writes no audit entry; the `else` branch writes `LOGIN`. Silent identity binding.

21. **`dev/session` cookie is `httpOnly: false` and unsigned.** `src/app/api/dev/session/route.ts:17` sets a readable, unsigned cookie and accepts any `userId` without validating against the allowed dev ids. Dev-only, but a smell even in `AUTH_MODE=dev`.

22. **`AdminLayout` renders children raw when `admin.access` missing.** `src/app/(admin)/layout.tsx:8` wraps children in a bare `<div>` for unauthorized users; relies on each page's `requireAdminPage` to throw. Inconsistent shell contract; a page that forgets the gate leaks content.

23. **`seed.ts` redundant DENY override.** `scripts/seed.ts:52` adds a `staff.manage` DENY for the baseline STAFF user, but STAFF role defaults already omit `staff.manage` (`src/lib/permissions.ts:17`). Redundant data that implies a non-default state.

24. **`permissions.test.ts` is a script, not a framework test.** Uses `node:assert/strict` with a one-shot function; `package.json` runs it via `tsx`. No test runner. clean-code § "one test framework per project" — there is none declared.

25. **`maskError` reads `process.env.NODE_ENV` directly.** `src/lib/result.ts:17` bypasses `getEnv()`. Inconsistent with the env-access pattern; acceptable in an error path but undocumented.

## Nit

26. **`middleware.ts` `event` param threaded but unused** except as a pass-through to `clerkHandler` (`src/middleware.ts:22`).
27. **`StaffManager` `refresh()` fetches without auth headers** — relies on cookie; fine in dev, brittle if AUTH_MODE changes.
28. **`concurrency-smoke.ts` resets `version` to 1 via `upsert` update** (`scripts/concurrency-smoke.ts:7`) — fine for smoke but overwrites prior state silently.

## Summary

- Critical: 3
- Major: 7
- Minor: 15
- Nit: 3
- Total: 28
