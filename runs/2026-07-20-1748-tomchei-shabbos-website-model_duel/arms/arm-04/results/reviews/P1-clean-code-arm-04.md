# P1 Clean-Code Review — arm-04 (blind)

Phase: P1
Scope: `arms/arm-04/workspace/` (`src/`, `scripts/`, `tests/`, `prisma/`)
Rule: `.cursor/rules/clean-code.mdc` (always-on)
Mode: Findings only — no fixes proposed. No model attribution.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 7 |

The codebase is generally disciplined: one Prisma client, one `Result` type, one date library (platform `Intl`), one styling approach (Tailwind + CSS-variable tokens), small shadcn-style UI primitives, optimistic concurrency on `StaffUser.version`, and a single authorization gate (`requirePermission`). File sizes are modest (largest production file 136 lines; largest script 272). No god file by line count. Findings below are real but narrow.

## Major

### M1. Pattern drift: `customers.ts` throws where the project returns `Result`

`README.md` declares `Result` from `src/lib/core/result.ts` as the project's error type, and `staff-service.ts` / `bootstrap.ts` follow it. `customers.ts` breaks the pattern:

```39:45:src/lib/customers.ts
export async function setCustomerPhone(customerId: string, rawPhone: string): Promise<Customer> {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    throw new Error(`"${rawPhone}" is not a 10-digit US phone number, so it was not saved.`);
  }
  return db.customer.update({ where: { id: customerId }, data: { phone } });
}
```

A caller has no way to handle a bad phone without a `try/catch`. This is the only server-side mutation in the workspace that throws for an expected validation failure. One error-handling approach per project — violated.

### M2. Dead code / YAGNI across `core/` and `customers.ts` (Rule of 2)

The clean-code rule requires 2+ real call sites **now**, not "might be useful later." These exports have zero production call sites in P1:

| Export | File | Production call sites |
|---|---|---|
| `maskError` | `src/lib/core/result.ts` | 0 (only `tests/core.test.ts`) |
| `normalizeName` | `src/lib/core/normalize.ts` | 0 |
| `normalizeAddressLine` | `src/lib/core/normalize.ts` | 0 (only `tests/core.test.ts`) |
| `addHours` | `src/lib/core/dates.ts` | 0 |
| `formatDate` | `src/lib/core/dates.ts` | 0 (only `formatDateTime` is used) |
| `newId` | `src/lib/core/ids.ts` | 0 |
| `newToken` | `src/lib/core/ids.ts` | 0 |
| `linkCustomerIdentity` | `src/lib/customers.ts` | 0 (only `tests/bootstrap.test.ts`) |
| `setCustomerPhone` | `src/lib/customers.ts` | 0 |

`customers.ts` as a whole has no production caller in P1. The whole module is speculative scaffolding for later phases. Per the rule, these should not exist yet.

### M3. Duplicated client-error reporting with drift between `error.tsx` and `global-error.tsx`

Both error boundaries inline the same `fetch('/api/client-error', …)` block:

```8:18:src/app/error.tsx
  useEffect(() => {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: error.message.slice(0, 500),
        digest: error.digest,
        path: window.location.pathname,
      }),
    }).catch(() => {});
  }, [error]);
```

```6:18:src/app/global-error.tsx
  useEffect(() => {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: error.message.slice(0, 500),
        digest: error.digest,
        path: window.location.pathname,
      }),
    }).catch(() => {
      // A failed crash report must never replace the crash screen.
    });
  }, [error]);
```

The two copies have already drifted: `error.tsx` swallows the catch silently (a clean-code violation — "no swallowed errors"); `global-error.tsx` documents why. Extract one client helper (e.g. `reportClientError(error)`) and call it from both. `global-error.tsx` legitimately cannot use the shared CSS/theme, but the fetch logic is shareable.

## Minor

### m1. Redundant type annotation after a type guard

```124:127:src/lib/staff-service.ts
  if (!isPermission(input.permission)) {
    return failure('unknown_permission', `"${input.permission}" is not a permission this app defines.`);
  }
  const permission: Permission = input.permission;
```

`isPermission` is a `value is Permission` type guard, so `input.permission` is already narrowed to `Permission` on the next line. The explicit annotation is a redundant assertion the compiler already guarantees (anti-AI-tic). A plain `const permission = input.permission;` (or just inline `input.permission`) suffices.

### m2. `ROLES` literal duplicates the Prisma `StaffRole` enum

```15:15:src/app/(admin)/admin/staff/page.tsx
const ROLES = ['MANAGER', 'STAFF', 'DRIVER'] as const;
```

This list is hand-typed beside the `StaffRole` enum in `prisma/schema.prisma`. Adding a role to the schema would not flag this list. Type/schema drift risk. Derive from the generated enum (e.g. `Object.values(StaffRole)`) or accept the duplication with a comment — currently it is silent.

### m3. `changeStaffRole` and `setStaffStatus` share a near-identical shape

Both follow: `guardSelfTarget` → `findUnique` → `updateStaffVersioned` → `recordAudit`, differing only in the update payload and audit action/detail. The duplication is mild and each branch is stable; per "if removing duplication adds more lines than it saves and the duplicated code is stable, leave it duplicated," this is a note, not a demand. Worth flagging because two more staff mutations landing in P2 would tip it past the Rule-of-2 threshold for extraction.

### m4. `unauthorized.tsx` and `forbidden.tsx` are structural twins

Both files render the same shell — a tone-coloured status code line, a heading, a body paragraph, and a link — differing only in copy and link target. A shared `StatusNotice` component would remove the duplication. Two call sites is the Rule-of-2 floor; today this is on the edge.

### m5. Empty catch block in `db-server.ts` `startCluster`

```85:91:scripts/db-server.ts
  try {
    await cluster.createDatabase(DB_NAME);
    console.log(`Created database "${DB_NAME}"`);
  } catch {
    // createDatabase throws when the database already exists, which is the
    // normal case on every run after the first.
  }
```

The clean-code rule says "no swallowed errors (empty catch blocks)." The comment documents intent, but the catch discards the error object entirely — a real failure (auth, disk full) is indistinguishable from "database already exists." At minimum, narrow on the expected error code (as `ensureDatabase` already does on line 51) instead of swallowing all throws.

### m6. `scripts/smoke.ts` mixes concerns (272 lines)

The file combines: the smoke flow (`main`), staff-form helpers (`inviteStaff`, `activate`, `changeRole`, `revoke`, `impersonate`, `setOverride`, `signIn`, `staffRow`, `keyOf`), an env-check subprocess wrapper (`runEnvCheck`), and a markdown report writer (`writeReport`). Under the 500-line split threshold, but mixed concerns — a split into `smoke.ts` (flow) + `smoke-helpers.ts` (form finders) + `smoke-report.ts` would improve readability and let the helpers be reused by later phases' smoke runs.

### m7. `signInLocally` updates a row then reads the stale value

```29:47:src/app/sign-in/actions.ts
  if (!staff.externalAuthId) {
    await db.staffUser.update({
      where: { id: staff.id },
      data: { externalAuthId: localExternalId(email) },
    });
  }

  const requestHeaders = await headers();
  await stampLogin(
    staff.id,
    requestHeaders.get('x-forwarded-for'),
    requestHeaders.get('user-agent'),
  );

  await startLocalSession({
    externalId: staff.externalAuthId ?? localExternalId(email),
    email,
    fullName: staff.fullName,
  });
```

The `await db.staffUser.update` mutates the row but `staff` still holds the pre-update object, so `startLocalSession` always takes the `localExternalId(email)` fallback. The result is correct (the update persists for next time, and the session uses the same value), but the intent is only obvious by tracing both branches. Either re-fetch the row after the update, or drop the `??` fallback and pass `localExternalId(email)` unconditionally with a one-line comment explaining the update is for future sign-ins.

## Notes

- No god files by line count (largest production file 136 lines; largest script 272). The `>500 lines or mixed concerns` split rule is not triggered by size; `scripts/smoke.ts` (m6) is the only mixed-concerns candidate.
- No barrel files. `src/components/ui/*` exports are colocated per primitive, not re-exported through an index.
- No wrapper components under 5 lines of JSX. `AuthProvider` is 9 lines and conditional — justified.
- Comments are mostly high-quality: they cite requirement IDs (R-119, R-161, UR-012) and explain non-obvious trade-offs (DENY-beats-GRANT, signed-not-encrypted cookies, 401/403 vs redirect). Few narration comments.
- Dependency discipline is clean: every package in `package.json` is pinned to an exact version, and the `ponytail` ladder is respected (platform `Intl` over a date library, `node:crypto` over an ID library, `node:test` over a test framework).
