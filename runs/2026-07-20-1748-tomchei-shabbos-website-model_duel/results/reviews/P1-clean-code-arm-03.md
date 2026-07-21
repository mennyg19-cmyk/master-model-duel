# Clean-code review — P1

**Arm:** arm-03
**Phase:** P1
**Scope:** `arms/arm-03/workspace/` (src, scripts, prisma, package.json)
**Rules:** `arms/arm-03/rules/clean-code.md`

Findings only. No model names.

---

## High

### H1 — Duplicated error-handling pattern across route handlers
`handleError` is defined **identically** in `src/app/api/staff/route.ts` (lines 33-42) and `src/app/api/impersonate/route.ts` (lines 12-21). Five more handlers inline the same AuthError → `error.status`, `ZodError` → 400, fallback → 500 logic instead of sharing a helper:

- `src/app/api/audit/route.ts` (lines 17-23)
- `src/app/api/admin/gated/route.ts` (lines 8-17)
- `src/app/api/customer/link/route.ts` (lines 28-34)
- `src/app/api/setup/route.ts` (lines 55-64)
- `src/app/api/client-error/route.ts` (lines 18-23, using `maskError` instead)

Violates **Rule of 2** (7 call sites) and **"one error-handling approach per project."** Extract a single `apiErrorResponse(error)` helper into `src/lib/`.

### H2 — Unused dependencies declared
`package.json` lists `class-variance-authority` (0.7.1) and `lucide-react` (0.475.0), but neither is imported anywhere under `src/`. `Button` (`src/components/ui/button.tsx`) uses a plain `Record<Variant, string>` instead of CVA. Violates **dependency discipline**: "If removing a dependency is possible without significant effort, prefer removal." Remove both (or actually adopt CVA/icons).

### H3 — Premature / dead helper code (Rule of 2)
The following exported symbols have **zero** call sites in `src/`:

- `src/lib/money.ts` — `dollarsToCents`, `centsToDollars`, `formatCents`
- `src/lib/dates.ts` — `toIsoDate`, `parseDate`, `formatDisplayDate`
- `src/lib/season.ts` — `SeasonWindow`, `seasonLabel`, `isSeasonOpen`
- `src/lib/ids.ts` — `createId` (only `createInvitationToken` is used)
- `src/lib/phone.ts` — `formatPhone` (only `normalizePhone` is used)
- `src/lib/normalize.ts` — `normalizeWhitespace`, `normalizeKey` (only `normalizeEmail` is used)
- `src/app/(admin)/admin/setup/page.tsx` (lines 19-21) — `stopIfLocked` exported, never imported

These are P2+ helpers landed in P1 with no call sites. Delete until 2+ real call sites exist, or move to the phase that introduces them.

---

## Medium

### M1 — Two permission-gate helpers doing the same thing
`requirePermission` (`src/lib/auth.ts` lines 124-135) and `requireAdminPage` (`src/lib/admin-gate.ts` lines 5-17) both throw `AuthError(401)`/`AuthError(403)` for the same check. `requirePermission` re-resolves permissions via `hasPermission(ctx.effectiveStaff, ctx.effectiveStaff.permissionOverrides, …)` even though `getStaffContext` already computed `ctx.permissions`. Two code paths for one concern. Unify: have `requireAdminPage` delegate to `requirePermission` (plus the setup-redirect), and use `ctx.permissions.has(permission)` consistently.

### M2 — DB mutation inside a server-component page
`src/app/(admin)/admin/staff/page.tsx` (lines 12-22) runs `db.impersonationSession.updateMany(...)` based on a `?stopImpersonation=1` query param during render. This duplicates the stop logic in `src/app/api/impersonate/route.ts` DELETE (lines 59-78) and performs a write in a GET-rendered page. Move to a server action / the existing `DELETE /api/impersonate` and share an `endActiveImpersonation(staffId)` helper.

### M3 — Duplicated staff-list query
`src/app/api/staff/route.ts` GET (lines 47-50) and `src/app/(admin)/admin/staff/page.tsx` (lines 26-29) both run `db.staffUser.findMany({ include: { permissionOverrides: true }, orderBy: { createdAt: "asc" } })`. Extract `listStaff()` into `src/lib/` and have the page call it (or call the API).

### M4 — Duplicated setup-lock check
`src/app/api/setup/route.ts` GET (lines 16-24) re-implements the manager-count + `SETUP_LOCK_KEY` check inline instead of calling `isSetupComplete()` from `src/lib/auth.ts` (lines 145-152). Same logic, two sources of truth.

### M5 — Inconsistent audit pagination and shape
`src/app/api/audit/route.ts` uses `take: 100` and `select: { id, displayName, email }`; `src/app/(admin)/admin/audit/page.tsx` uses `take: 50` and `select: { displayName, email }`. Same list, two magic limits and two projections. Pick one limit (named constant) and one query, shared via a `listAuditEntries()` helper.

### M6 — Magic number for login-audit throttle
`src/lib/auth.ts` line 90: `Date.now() - staff.lastLoginAt.getTime() > 60_000`. The 60-second throttle window is an unnamed literal. Promote to a named constant (e.g. `LOGIN_AUDIT_INTERVAL_MS`).

### M7 — Unguarded schema parse in dev-session route
`src/app/api/dev/session/route.ts` (line 15) calls `schema.parse(await request.json())` with no `try/catch`. Invalid input throws an unhandled 500, inconsistent with the 400 pattern every other route returns for `ZodError`. Wrap or reuse the shared error helper from H1.

### M8 — Inline styles in global error page
`src/app/global-error.tsx` (line 12) uses `style={{ fontFamily: "system-ui", padding: 24 }}`. The rest of the app uses Tailwind + CSS variables (`var(--color-*)`, `var(--radius-*)`). Inline styles are a banned refactor category and break the "one styling approach per project" rule. Replace with Tailwind classes (note: `global-error.tsx` cannot rely on the root layout's CSS, so import a minimal stylesheet or inline a `<style>` with the tokens instead of a per-element inline style).

### M9 — Schema-name mismatch in staff PATCH "confirm"
`src/app/api/staff/route.ts` line 190 parses the `confirm` intent with `revokeSchema` and binds it to `confirmBody`. Reusing the revoke schema for the confirm intent is confusing (the names disagree and the schemas are not semantically the same concern). Define an explicit `confirmSchema` or rename.

---

## Low

### L1 — Banned standalone name `value`
`src/components/admin/staff-manager.tsx` lines 115 and 143: `Object.values(StaffRole).map((value) => …)`. `value` is on the banned list as a standalone name. Use `role` (the domain term) instead.

### L2 — Redundant re-export of `SETUP_LOCK_KEY`
`src/lib/auth.ts` line 160 re-exports `SETUP_LOCK_KEY` from `@/lib/constants` while also importing it at line 17. The symbol is already exported from `lib/constants`; the re-export adds nothing. Remove line 160.

### L3 — Hand-rolled button in error page
`src/app/error.tsx` (lines 20-26) renders a styled `<button>` with inline Tailwind classes instead of using the existing `Button` component (`src/components/ui/button.tsx`). Minor UI pattern drift — reuse `Button`.

### L4 — Narration comment
`scripts/smoke.mjs` line 87: `// stop impersonation` narrates the next request. Per the comment rules, narration comments should be removed; the code is self-explanatory.

---

## Summary

| Severity | Count |
|---|---|
| High | 3 |
| Medium | 9 |
| Low | 4 |
| **Total** | **16** |

Top themes: error-handling duplication and pattern drift across route handlers (H1, M1, M3, M4, M5, M7); premature/dead helpers and unused deps (H2, H3); a DB write inside a page render (M2).
