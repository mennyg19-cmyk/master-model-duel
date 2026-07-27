# P1 Clean-code Review — arm-05

Reviewer: clean-code specialist (blind).
Scope: P1 only — foundation, identity, roles, permissions, staff tooling.
Reference rules: `arms/arm-05/.cursor/rules/clean-code.mdc`.
Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 4 |
| Minor | 6 |

---

## Major

### M1 — `StaffUser` type duplicated across three locations (type drift)

**Location:** `lib/staff-store.ts:8-16`, `app/admin/staff/page.tsx:5-13`, `prisma/schema.prisma:21-34`

**Claim:** The `StaffUser` shape is defined twice in TypeScript (in `staff-store` and inline in the admin page) and a third time as a Prisma model. The three definitions have already drifted: the TS type omits `clerkUserId`, `createdAt`, `updatedAt`, `loginStamps`, and `auditEvents` that the Prisma model carries. When the Prisma layer is wired in (per status doc: "production PostgreSQL Prisma schema"), the in-memory TS type will conflict with the Prisma-generated type. Violates "type/schema drift — centralize types, single source of truth" and Rule of 2.

**Evidence:**

```8:16:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/staff-store.ts
export type StaffUser = {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  revokedAt?: string;
  version: number;
  overrides: Partial<Record<Permission, PermissionEffect>>;
};
```

```5:13:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/admin/staff/page.tsx
type StaffUser = {
  id: string;
  displayName: string;
  email: string;
  role: "MANAGER" | "STAFF" | "DRIVER";
  revokedAt?: string;
  version: number;
  overrides: Record<string, "GRANT" | "DENY">;
};
```

The page version also widens `overrides` to `Record<string, "GRANT" | "DENY">`, dropping the `Permission` key constraint — a second drift in the same type.

---

### M2 — `AuditEvent` type duplicated and already drifted

**Location:** `lib/staff-store.ts:18-24`, `app/admin/audit/page.tsx:5`

**Claim:** `AuditEvent` is defined in the store and redefined inline in the audit page. The page copy omits the `subjectId` field and loosens `details` to `string` while the Prisma model declares `details Json`. Three sources of truth, two field-shape drifts in P1 alone.

**Evidence:**

```18:24:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/staff-store.ts
export type AuditEvent = {
  id: string;
  action: string;
  subjectId?: string;
  details: string;
  createdAt: string;
};
```

```5:5:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/admin/audit/page.tsx
type AuditEvent = { id: string; action: string; details: string; createdAt: string };
```

Prisma model says `details Json` (`prisma/schema.prisma:59`), so the in-store `string` typing is also drift.

---

### M3 — Two parallel persistence patterns for the same entity (pattern drift)

**Location:** `prisma/schema.prisma:21-69` vs `lib/staff-store.ts:33-39`

**Claim:** P1 ships a Prisma `StaffUser`/`PermissionOverride`/`AuditEvent`/`SessionLoginStamp` schema AND an in-memory `globalThis.__p1StaffState` store with hand-rolled arrays. Both are presented as the source of truth for staff state. The status doc admits the running app uses the memory adapter and the Prisma schema "was not live-tested." Two data layers for one concern violates "one state management pattern per project." Worse, the in-memory type shape does not match the Prisma model (see M1), so the migration path is not a swap — it is a rewrite.

**Evidence:**

```33:39:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/staff-store.ts
const state: State = globalThis.__p1StaffState ?? {
  firstManagerCreated: false,
  staff: [],
  audits: [],
};

globalThis.__p1StaffState = state;
```

The Prisma schema (`prisma/schema.prisma:21-69`) defines the same entities as relational tables. There is no adapter interface bridging them — `lib/staff-store.ts` is a concrete in-memory implementation with no Prisma counterpart behind a common interface.

---

### M4 — Role union literal re-declared in four places

**Location:** `lib/permissions.ts:9`, `app/api/staff/route.ts:9`, `app/api/staff/[staffId]/route.ts:9`, `app/admin/staff/page.tsx:9`

**Claim:** `StaffRole = "MANAGER" | "STAFF" | "DRIVER"` already exists in `lib/permissions.ts`, but each route and the admin page re-declares the union inline (via `z.enum([...])` or a literal type). Adding a fourth role later requires touching four files. Violates "single source of truth" and Rule of 2 (4 real call sites now).

**Evidence:**

```9:9:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/permissions.ts
export type StaffRole = "MANAGER" | "STAFF" | "DRIVER";
```

```9:9:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/api/staff/route.ts
  role: z.enum(["MANAGER", "STAFF", "DRIVER"]),
```

```9:9:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/api/staff/[staffId]/route.ts
  role: z.enum(["MANAGER", "STAFF", "DRIVER"]).optional(),
```

```9:9:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/admin/staff/page.tsx
  role: "MANAGER" | "STAFF" | "DRIVER";
```

---

## Minor

### m1 — `PermissionEffect` literal re-inlined despite existing export

**Location:** `app/api/staff/[staffId]/route.ts:38`, `app/admin/staff/page.tsx:12`

**Claim:** `lib/permissions.ts:10` exports `PermissionEffect = "GRANT" | "DENY"`, but the dynamic route casts to `Partial<Record<Permission, "GRANT" | "DENY">>` inline and the admin page widens it to `Record<string, "GRANT" | "DENY">`. Both should import `PermissionEffect`. The page version also drops the `Permission` key constraint (same drift called out in M1).

**Evidence:**

```38:38:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/api/staff/[staffId]/route.ts
    { role: parsed.data.role, overrides: parsed.data.overrides as Partial<Record<Permission, "GRANT" | "DENY">> },
```

```12:12:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/admin/staff/page.tsx
  overrides: Record<string, "GRANT" | "DENY">;
```

---

### m2 — Dead code: most of `lib/foundation.ts` is unused at P1

**Location:** `lib/foundation.ts:1-29`

**Claim:** Of five exports (`brand`, `centsToDollars`, `normalizeEmail`, `normalizePhone`, `createPublicId`, `maskError`), only `normalizeEmail` is imported anywhere in the workspace. The other five are speculative helpers with zero call sites — exactly the "might be useful later" case the Rule of 2 forbids. `maskError` in particular is named in the plan (R-136 production error masking) but is not wired into `app/error.tsx` or the client-error endpoint.

**Evidence:** Grep across `arms/arm-05/workspace` for `brand|centsToDollars|normalizePhone|createPublicId|maskError` returns only the definitions in `lib/foundation.ts`. `app/error.tsx` and `app/api/client-error/route.ts` do not import `maskError`.

---

### m3 — Dead code: entire `lib/settings.ts` module unused at P1

**Location:** `lib/settings.ts:1-19`

**Claim:** Neither `getSetting` nor `setSetting` is imported anywhere in the workspace. The plan calls for a "typed key-value settings store (R-161)" in P1, but this module is a hard-coded in-memory object with no caller. Rule of 2 fails (0 call sites). Same pattern-drift concern as M3: a second in-memory store when the Prisma `AppSetting` model already exists (`prisma/schema.prisma:71-75`).

**Evidence:** Grep for `setSetting|getSetting` returns only the definitions in `lib/settings.ts`. Grep for `from "@/lib/settings"` returns no matches.

---

### m4 — `loadStaff` duplicated by the initial `useEffect` in the same file

**Location:** `app/admin/staff/page.tsx:19-30`

**Claim:** `loadStaff` (lines 19-22) fetches `/api/staff` and `setStaff`s. The `useEffect` (lines 24-30) fetches `/api/staff` again with a different pattern (AbortController + `.then` chain) instead of calling `loadStaff`. Two fetch patterns for the same endpoint in one component. Either the effect should call `loadStaff` (and `loadStaff` should accept an AbortSignal), or the effect should be the only fetch.

**Evidence:**

```19:30:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/admin/staff/page.tsx
  async function loadStaff() {
    const response = await fetch("/api/staff");
    setStaff((await response.json()).staff);
  }

  useEffect(() => {
    const abortController = new AbortController();
    void fetch("/api/staff", { signal: abortController.signal })
      .then(async (response) => response.json())
      .then((body) => setStaff(body.staff));
    return () => abortController.abort();
  }, []);
```

---

### m5 — Vague name: `act` in admin staff page

**Location:** `app/admin/staff/page.tsx:43`

**Claim:** The function is named `act(staffId, action)`. `act` is a generic verb that does not describe what it does — it dispatches a revoke or impersonate call to the staff API. The clean-code rule "Function names describe what they DO" calls for something like `dispatchStaffAction` or `runStaffMutation`. The parameter name `action` is similarly vague but is constrained by the union type, so the function name is the real offender.

**Evidence:**

```43:43:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/admin/staff/page.tsx
  async function act(staffId: string, action: "revoke" | "impersonate") {
```

---

### m6 — Magic numbers duplicated across setup and staff schemas

**Location:** `app/api/setup/route.ts:7-8`, `app/api/staff/route.ts:7-8`

**Claim:** `displayName: z.string().trim().min(2).max(80)` and `email: z.string().email()` are repeated verbatim in the setup and staff POST routes. The `2`/`80` bounds are magic numbers with no named constant and no shared schema. A third call site (any future route that accepts a name) will copy them again. Rule of 2 is satisfied (2 call sites now); extracting a shared `staffInviteSchema` (or at least named constants) would prevent drift.

**Evidence:**

```7:8:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/api/setup/route.ts
  displayName: z.string().trim().min(2).max(80),
  email: z.string().email(),
```

```7:8:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/api/staff/route.ts
  displayName: z.string().trim().min(2).max(80),
  email: z.string().email(),
```

---

## Notes (not findings)

- No god files. Largest file is `lib/staff-store.ts` at 139 lines; nothing approaches the 500-line split threshold.
- No narration or change-explanation comments anywhere — comment discipline is clean.
- No swallowed errors and no unnecessary try/catch wrapping.
- `app/admin/audit/page.tsx:11` does a `fetch().then()` with no error handling and no AbortController, while the sibling staff page uses an AbortController. This is pattern drift on error handling but is captured under m4's broader "two fetch patterns" concern; not double-counted.
- `tests/concurrency.test.ts:8` does `if (!created.ok) return;` after `assert.equal(created.ok, true)` — defensive against a state the assertion just proved impossible. Borderline anti-tic; not elevated because tests legitimately need the narrowing for TypeScript.
