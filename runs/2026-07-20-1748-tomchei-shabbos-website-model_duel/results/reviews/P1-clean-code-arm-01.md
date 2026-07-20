# P1 Clean-code review — arm-01

- **Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
- **Arm:** `arm-01`
- **Tree / phase:** Test 4 P1 — `arms/arm-01/workspace/`
- **Reviewer specialist:** Clean-code
- **Scope:** duplication, naming, god files, pattern drift
- **Verdict:** `clean-code` rule is in arm rules — review applies.

## Summary

The tree is small (largest source file 182 lines, no god files >500 lines) and generally well-factored. Findings are concentrated in three areas: a duplicated API error-handling pattern that already has a local helper but is not reused, a duplicated Prisma `select` projection, and a set of `lib/` helpers that ship with zero call sites (premature abstractions). Severity is **P2/P3** — nothing blocks, but several items violate the arm's own `clean-code` discipline rules (Rule of 2, no premature abstractions, centralize magic strings).

## Findings

### F1 — `AccessDeniedError → 403` handler duplicated across routes (P2, pattern drift)

`src/app/api/admin/staff/route.ts` defines a local `permissionError` helper:

```9:14:src/app/api/admin/staff/route.ts
function permissionError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  throw error;
}
```

The identical logic is then **inlined** in two other routes instead of reusing it:

```55:60:src/app/api/admin/impersonation/route.ts
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
```

```21:26:src/app/api/admin/overview/route.ts
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
```

Three call sites, one local helper, no shared export. Per Rule of 2, lift `permissionError` (or a `withPermission(handler)` wrapper) into `src/lib/auth.ts` and import it everywhere.

### F2 — Duplicated `StaffUser` select projection (P2, duplication)

The exact same `select` block appears in the API route and the server page:

```21:30:src/app/api/admin/staff/route.ts
    const staffUsers = await db.staffUser.findMany({
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        grantPermissions: true,
        denyPermissions: true,
        version: true,
      },
    });
```

```11:20:src/app/(admin)/admin/staff/page.tsx
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      grantPermissions: true,
      denyPermissions: true,
      version: true,
    },
```

Note the two also disagree on `orderBy` (`displayName` vs `createdAt`) — a quiet pattern drift. Extract a shared `staffUserSelect` constant (e.g. `src/lib/staff-projection.ts`) and pick one canonical ordering.

### F3 — Premature `lib/` helpers with zero call sites (P2, dead code / over-engineering)

The following modules are defined but imported nowhere in the tree (verified by grep across `src/`, `scripts/`, `tests/`):

- `src/lib/dates.ts` — `formatOrganizationDate`
- `src/lib/money.ts` — `formatCents`
- `src/lib/season.ts` — `getSeasonYear`, `formatSeasonName`
- `src/lib/safe-result.ts` — `SafeResult`, `maskUnexpectedError`
- `src/lib/normalize.ts` — `normalizePhone` (only `normalizeEmail` is used)

This violates the arm's own discipline rules: *"Rule of 2: Needs 2+ real call sites right now. Not 'might be useful later.'"* and *"No premature abstractions."* Either delete these for P1 and re-introduce when a real call site arrives, or leave a single co-located helper next to its first real consumer. `safe-result.ts` in particular is a 2-export grab-bag with no consumer.

### F4 — Audit-log writes repeated inline with magic action strings (P2, duplication + magic strings)

Every mutating route hand-rolls an `auditLog.create` inside its transaction with a near-identical shape, and each audit `action` is a bare string literal:

- `staff/route.ts` POST → `"staff.invited"` (line 76)
- `staff/route.ts` PATCH → `"staff.revoked"` / `"staff.permissions_or_role_changed"` (lines 146–148)
- `impersonation/route.ts` POST → `"staff.impersonation_started"` (line 36)
- `accept-invite/route.ts` POST → `"staff.invitation_accepted"` (line 47)
- `setup/route.ts` POST → `"staff.bootstrap_manager"` (line 65)

Five call sites, same `{ actorStaffId, action, targetType: "StaffUser", targetId, ... }` skeleton, with `targetType: "StaffUser"` also hardcoded every time. Two drift risks:
1. A typo in an action string is invisible to the type checker (type/schema drift).
2. The skeleton is copy-pasted, so adding a new audit field means editing five places.

Add a `writeAuditLog(tx, { action, targetId, ... })` helper in `src/lib/audit.ts` and a `const AuditAction = { ... } as const` (or union type) so action strings are centralized and checked.

### F5 — Role `<option>` lists duplicated and inconsistent (P3, pattern drift)

`staff-manager.tsx` renders the `StaffRole` enum as hardcoded `<option>` lists twice, in different orders:

```107:110:src/app/(admin)/admin/staff/staff-manager.tsx
            <option value="STAFF">Staff</option>
            <option value="DRIVER">Driver</option>
            <option value="MANAGER">Manager</option>
```

```134:137:src/app/(admin)/admin/staff/staff-manager.tsx
                  <option value="MANAGER">Manager</option>
                  <option value="STAFF">Staff</option>
                  <option value="DRIVER">Driver</option>
```

`permissions.ts` already owns the canonical `rolePermissions` Record keyed by `StaffRole`; derive the option list from that single source (or from `StaffRole` enum members via `Object.values`) instead of re-listing by hand.

### F6 — Grant/deny checkbox fieldsets duplicated (P3, duplicated UI)

`staff-manager.tsx` renders two near-identical `<fieldset>` blocks over `permissions`, differing only in `grantPermissions`/`denyPermissions` and the legend text:

```146:164:src/app/(admin)/admin/staff/staff-manager.tsx
            <fieldset className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="mb-3 font-semibold">Personal grants</legend>
              {permissions.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-sm">
                  <input
                    checked={staffUser.grantPermissions.includes(permission)}
                    onChange={(event) =>
                      updateStaff(staffUser, {
                        grantPermissions: event.target.checked
                          ? [...staffUser.grantPermissions, permission]
                          : staffUser.grantPermissions.filter((grant) => grant !== permission),
                      })
                    }
                    type="checkbox"
                  />
                  {permission}
                </label>
              ))}
            </fieldset>
```

Lines 165–183 are the same block for `denyPermissions`. Extract a `PermissionChecklist({ legend, selected, onChange })` component — exactly two real call sites, satisfies Rule of 2.

### F7 — `global-error.tsx` hardcodes hex colors instead of CSS variables (P3, magic values / pattern drift)

```12:25:src/app/global-error.tsx
        <main className="grid min-h-screen place-items-center bg-[#f7f3f7] px-6">
          <div className="max-w-lg rounded-3xl bg-white p-10 text-center shadow-xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8f2f67]">
              Something went wrong
            </p>
            <h1 className="mt-4 text-3xl font-bold text-[#241f2d]">
              This page could not be loaded
            </h1>
            <p className="mt-3 text-[#6f6878]">
```

`#f7f3f7`, `#8f2f67`, `#241f2d`, `#6f6878` are the literal values of `--surface`, `--brand`, `--ink`, `--muted` from `globals.css`. Every other surface in the tree uses `var(--…)`. `global-error.tsx` runs outside the normal layout, so `globals.css` may not be loaded — but the duplicated raw hex values are an undocumented drift trap. Either inline a `<style>` with the same `:root` tokens, or add a comment explaining why the values are hardcoded and keep them in sync with `globals.css`.

### F8 — `hasPermission` subject type loosens the `Permission` union (P3, type drift)

```19:23:src/lib/permissions.ts
type PermissionSubject = {
  role: StaffRole;
  grantPermissions: string[];
  denyPermissions: string[];
};
```

`Permission` is a strict union, but `grantPermissions`/`denyPermissions` are `string[]`. The DB column is `String[]`, so loose typing is defensible at the boundary — but the domain function then does `denyPermissions.includes(permission)` where `permission: Permission` is compared against `string`. Tighten to `Permission[]` (and validate at the Prisma boundary) so a typo'd grant like `"staff:manag"` is caught at compile time instead of silently granting nothing.

### F9 — `getCurrentStaffUser` return shape is implicit and inconsistent (P3, naming/type drift)

```26:55:src/lib/auth.ts
export async function getCurrentStaffUser() {
  const clerkUserId = await getAuthenticatedClerkUserId();
  if (!clerkUserId) {
    return null;
  }
  ...
  if (!impersonatedStaffId) {
    return { actor, effective: actor };
  }
  ...
  return { actor, effective };
}
```

The function returns `null | { actor: StaffUser; effective: StaffUser }` but the type is inferred and the "session" concept (`staffSession` is the local name used in every consumer) is never named. Define an explicit `StaffSession` type and annotate the return, so consumers don't drift on `{ actor, effective }` field names.

## Non-findings (looked at, no issue)

- No file exceeds 500 lines; no god files.
- `lib/db.ts`, `lib/env.ts`, `lib/ids.ts`, `lib/brand.ts` are appropriately small and each has a real consumer.
- `tests/permissions.test.ts` covers the `hasPermission` deny-wins-over-grant contract cleanly.
- `eslint.config.mjs` correctly re-declares `globalIgnores` after the Next config preset (the comment explains why).
- `prisma/schema.prisma` indexes match the access patterns used in the routes.

## Suggested fix order (smallest blast radius first)

1. F3 — delete unused `lib/` helpers (or mark them deferred).
2. F1 — lift `permissionError` into `lib/auth.ts`; replace inline copies.
3. F2 — extract `staffUserSelect`; reconcile `orderBy`.
4. F4 — add `writeAuditLog` + `AuditAction` const.
5. F5 / F6 — derive role options from the enum; extract `PermissionChecklist`.
6. F7 / F8 / F9 — token sync, type tightening, `StaffSession` type.
