# P2 Clean-code review — arm-01

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01`
**Tree / phase:** `arms/arm-01/workspace/` — P2 (domain core + identity/authorization shell)
**Reviewer focus:** duplication, naming, god files, pattern drift, dead code, type/schema drift
**Rule source:** `arms/arm-01/rules/clean-code.md`
**Scope note:** Only files under `arms/arm-01/workspace/` were inspected. Findings cite `src` paths relative to that workspace.

---

## Findings

### 1. Dead code in `lib/` — multiple modules have zero call sites
**Category:** Dead code · Rule of 2
**Severity:** Medium

The following exports are not imported anywhere in `src/`, `tests/`, `scripts/`, or `prisma/`:

- `src/lib/safe-result.ts` — entire file (`SafeResult`, `maskUnexpectedError`) is unused.
- `src/lib/dates.ts` — `formatOrganizationDate` unused (see also finding 10).
- `src/lib/money.ts` — `formatCents` unused.
- `src/lib/season.ts` — `getSeasonYear` and `formatSeasonName` unused.
- `src/lib/normalize.ts` — `normalizePhone` unused (only `normalizeEmail` is called, from `staff/route.ts` and `setup/route.ts`).

The clean-code rule is explicit: "Dead code — delete, don't comment out" and "Rule of 2: needs 2+ real call sites right now. Not 'might be useful later.'" If these are staged for a later phase, they should not land until they have a call site; otherwise delete.

### 2. Two competing implementations per domain concern
**Category:** Duplicated logic · One pattern per concern
**Severity:** Medium-High

`src/domain/` ships two implementations for each of two concerns, and only one of each is reachable from production code:

- Order number allocation: `OrderNumberAllocator` (in-memory counter, `src/domain/order-engine.ts:95`) vs. `finalizeOrder`/`claimOrderNumber` (DB transaction with `Season.nextOrderNumber`, `src/domain/order-engine.ts:23-78`).
- Inventory reservation: `InventoryReservationLedger` (in-memory, `src/domain/inventory.ts:35`) vs. `reserveInventory` (DB atomic `UPDATE ... WHERE onHand - reserved >= qty`, `src/domain/inventory.ts:3`).

`OrderNumberAllocator` and `InventoryReservationLedger` are imported **only** by `tests/domain-core.test.ts` (verified by grep). They are test-only concurrency demonstrators living in the production source tree. Either move them under `tests/` as fixtures, or delete them and have the tests exercise the DB-backed implementations.

### 3. Duplicated state-machine pattern across `order-engine` and `package-stage`
**Category:** Duplicated logic
**Severity:** Medium

`ALLOWED_ORDER_TRANSITIONS` + `assertOrderTransition` (`src/domain/order-engine.ts:3-13`) and `ALLOWED_PACKAGE_TRANSITIONS` + the inline transition check in `advancePackageStage` (`src/domain/package-stage.ts:3-30`) are the same shape: a `Record<Stage, readonly Stage[]>` plus an `!allowed[from].includes(to)` guard plus a "cannot transition from X to Y" error. Two call sites now — extract a `defineStateMachine(allowed, label)` factory and reuse for both.

### 4. Duplicated promise-queue pattern
**Category:** Duplicated logic
**Severity:** Low-Medium

`OrderNumberAllocator` (`src/domain/order-engine.ts:95-104`) and `InventoryReservationLedger` (`src/domain/inventory.ts:35-54`) both implement the same serialized-queue primitive:

```ts
private queue = Promise.resolve();
// ...
this.queue = result.then(() => undefined, () => undefined);
```

Extract a `serialize()` / `PromiseQueue` helper to `lib/`. (Tied to finding 2 — if the in-memory classes move to tests, this collapses.)

### 5. `AccessDeniedError → 403` handler duplicated across routes
**Category:** Duplicated logic · Pattern drift
**Severity:** Medium

`src/app/api/admin/staff/route.ts:9-14` already factors the pattern into a local `permissionError()` helper, but the same block is inlined three more times:

- `src/app/api/admin/impersonation/route.ts:59-64` (POST)
- `src/app/api/admin/impersonation/route.ts:102-107` (DELETE)
- `src/app/api/admin/overview/route.ts:21-26`

Move `permissionError()` (or a `withPermissionHandler` wrapper) into `src/lib/auth.ts` and reuse everywhere.

### 6. Duplicated `impersonatorId` ternary
**Category:** Duplicated logic
**Severity:** Low

The expression `staffSession.actor.id === staffSession.effective.id ? null : staffSession.actor.id` appears twice in `src/app/api/admin/staff/route.ts` (lines 79-83 and 92-95). Extract `impersonatorIdFor(session)` (returns `string | null`) — it is also the natural place to enforce that only an active impersonation yields a non-null id.

### 7. Duplicated UI: grants and denies fieldsets in `staff-manager`
**Category:** Duplicated UI
**Severity:** Medium

`src/app/(admin)/admin/staff/staff-manager.tsx:159-177` and `:178-196` are two near-identical `<fieldset>` blocks that differ only in which array (`grantPermissions` vs `denyPermissions`) is read and which filter variable (`grant` vs `deny`) is used in the toggle. Extract a `PermissionChecklist({ label, selected, onToggle })` component and render it twice.

### 8. `StopImpersonationButton` inlines a `<button>` instead of using `Button`
**Category:** Duplicated UI · Pattern drift
**Severity:** Low-Medium

`src/components/stop-impersonation-button.tsx:20-29` hand-rolls a `<button>` with `rounded-lg border border-[var(--ink)] px-3 py-1` while the rest of the app routes through `src/components/button.tsx` (`Button` with `tone="secondary"`). The shared `Button` already supports the disabled/loading state this component needs. Reuse it so button styling stays in one place.

### 9. `global-error.tsx` duplicates design tokens as hardcoded hex
**Category:** Inconsistent patterns · Type/schema drift (token drift)
**Severity:** Medium

`src/app/global-error.tsx` hardcodes `#f7f3f7`, `#8f2f67`, `#241f2d`, `#6f6878` — the same values `src/app/globals.css` exposes as `--surface`, `--brand`, `--ink`, `--muted`. The file does not import `globals.css`, so the CSS variables are unavailable in its scope, which is why the hex was inlined. The two sources of truth will drift silently. Fix: `import "../globals.css"` (or re-import `./globals.css`) and switch to `var(--*)`; also reuse `Button` instead of the inlined `<button>` at lines 24-29.

### 10. Inconsistent date formatting — `formatOrganizationDate` unused while pages call `toLocaleString()`
**Category:** Pattern drift · Dead code
**Severity:** Low-Medium

`src/app/(admin)/admin/page.tsx:45` renders `event.occurredAt.toLocaleString()` directly, bypassing `src/lib/dates.ts:formatOrganizationDate(date, timeZone)`. One project-wide date formatter is the rule; right now there is one helper nobody uses and one inline call site that ignores the organization timezone stored in `AppSetting.organization.timezone` (see `prisma/seed.ts:18-22`). Route the page through `formatOrganizationDate` and pass the org timezone, or delete the helper.

### 11. Mixed enum vs string-literal comparisons for `StaffRole` / `StaffStatus`
**Category:** Inconsistent patterns
**Severity:** Medium

Enum values are used in some places and bare string literals in others for the same fields:

- Enum: `src/app/api/admin/staff/route.ts` (`StaffRole`, `StaffStatus.REVOKED`), `src/app/api/setup/route.ts` (`StaffRole.MANAGER`, `StaffStatus.ACTIVE`), `src/app/api/admin/impersonation/route.ts` (`impersonatorId` writes but compares `target.status !== "ACTIVE"`).
- String literals: `src/app/api/admin/impersonation/route.ts:23` (`target.status !== "ACTIVE"`), `src/app/(admin)/admin/page.tsx:7-8` (`status: "ACTIVE"` / `"INVITED"`), `src/app/(admin)/admin/staff/staff-manager.tsx:152` (`status !== "REVOKED"`), `src/lib/auth.ts:34` (`role: "MANAGER"`, `status: "ACTIVE"`), `prisma/seed.ts` (`role: "STAFF"`, `status: "ACTIVE"`, `targetKind: "PRODUCT"`).

Pick one pattern (prefer the Prisma enums everywhere) and apply it consistently.

### 12. Magic numbers in time/size constants
**Category:** Magic values
**Severity:** Low

Unnamed literals:

- `src/app/api/admin/staff/route.ts:55` — `7 * 24 * 60 * 60 * 1000` (7-day invite TTL).
- `src/app/api/admin/impersonation/route.ts:56` — `60 * 60` (1-hour impersonation cookie maxAge).
- `src/app/api/client-errors/route.ts:4,21,22` — `2_048`, `200`, `80` (body / field truncation limits).
- `src/lib/ids.ts:7` — `12` (request-id byte length).
- `src/domain/order-engine.ts:20` — `8` (draft-reference zero-pad width).
- `src/app/(admin)/admin/page.tsx:12` and `src/app/api/admin/overview/route.ts:12` — `6` / `12` audit `take` limits.

Hoist these into named constants (e.g. `INVITE_TTL_MS`, `IMPERSONATION_COOKIE_MAX_AGE_S`, `CLIENT_ERROR_MAX_BYTES`).

### 13. String-sentinel error in `setup/route.ts`
**Category:** Pattern drift · Error handling
**Severity:** Low-Medium

`src/app/api/setup/route.ts:43` throws `new Error("BOOTSTRAP_LOCKED")` and `:79` matches it with `error.message === "BOOTSTRAP_LOCKED"`. The rest of the codebase uses a typed error class (`AccessDeniedError` in `src/lib/auth.ts:7`). Introduce a `BootstrapLockedError` (and a `withRouteErrors` helper built on finding 5) so control flow is by type, not magic string.

### 14. Type drift on permission arrays
**Category:** Type/schema drift
**Severity:** Medium

`Permission` is a string-literal union (`src/lib/permissions.ts:11`), but `PermissionSubject.grantPermissions` / `denyPermissions` are typed `string[]` (`src/lib/permissions.ts:21-22`). `hasPermission` then calls `.includes(permission)` against `string[]`, so any string the DB stores is accepted without validation. The Prisma schema stores these as `String[]` (`prisma/schema.prisma:93-94`), so the boundary is the right place to validate. Type the subject's arrays as `readonly Permission[]` and validate at the DB read boundary.

### 15. `readServerEnvironment()` invoked for side effects in `db.ts`
**Category:** Naming / anti-AI-tics
**Severity:** Low

`src/lib/db.ts:4` calls `readServerEnvironment()` and discards the return value to force env validation at import time. The function name promises a value; the call site only wants the assertion. Either rename to `assertServerEnvironment()` (no return) or call it where `DATABASE_URL` is actually consumed. As written, the side-effect import is surprising and the returned `ServerEnvironment` is dead.

---

## Summary

**Finding count: 15**

Breakdown by category:

- Duplicated logic: 3, 4, 5, 6 (and contributes to 2)
- Duplicated UI: 7, 8
- Dead code / Rule of 2: 1, 2, 10
- Inconsistent patterns / pattern drift: 5, 9, 10, 11, 13
- Type/schema drift: 9, 14
- Magic values: 12
- Naming / anti-AI-tics: 15

Highest-impact items to address first: 2 (two implementations per domain concern), 5 (shared error handler), 11 (enum vs string literals), 14 (permission array typing), 9 (global-error token drift).
