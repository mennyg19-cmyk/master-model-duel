# P1 Clean-Code Review — arm-06 (Test 4)

**Scope:** `arms/arm-06/workspace/` — duplication, naming, god files, pattern drift.
**Severity bands:** Blocker / Major / Minor. Findings only — no fixes.
**Rule source:** `arms/arm-06/.cursor/rules/clean-code.mdc`.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major   | 2 |
| Minor   | 11 |

No god files. Largest source file is `lib/auth.ts` at 91 lines; largest file overall is `prisma/schema.prisma` at 101 lines. All well under the 500-line god-file threshold.

---

## Major

### M1. Session-cookie issuance pattern duplicated 5×
The "encode session → build response → set cookie → return" sequence is copy-pasted across five API routes with only the payload and response body varying:

- `app/api/admin/staff/[id]/impersonate/route.ts:34-40`
- `app/api/admin/impersonation/stop/route.ts:30-33`
- `app/api/setup/route.ts:56-59`
- `app/api/dev-auth/route.ts:46-49`
- `app/api/invite/[token]/route.ts:27-31`

Each site repeats:
```ts
const sessionValue = await encodeSession({ staffUserId: ... }, env.AUTH_SECRET);
const response = NextResponse.json({ ... });
response.cookies.set(SESSION_COOKIE, sessionValue, sessionCookieOptions());
return response;
```
Five real call sites today (well past the Rule of 2). A single async helper in `lib/auth.ts` (e.g. `issueSessionResponse(payload, body)`) would remove ~14 net lines and centralize the cookie-shape decision (currently a drift risk: any change to `sessionCookieOptions()` propagation must be made in five places). `dev-auth/route.ts` also has a sixth variant for cookie *clearing* (line 54) that compounds the drift surface.

### M2. `lib/result.ts` is a dead module that the README claims is live
`Result`, `ok`, `err`, and `maskError` are all exported from `lib/result.ts`, but **nothing in the workspace imports them** (verified: no `from "@/lib/result"` / `from "../lib/result"` anywhere; `maskError` appears only at its own definition). Yet `README.md:40` advertises:

> Errors | `Result` + `maskError` (`lib/result.ts`); client errors POST to `/api/client-error` (bounded, redacted)

The actual error-handling pattern in the codebase is the local `ApiGate` discriminated union in `lib/auth.ts:63-74` (`{ ok: true; ctx } | { ok: false; response }`) for API routes, and `forbidden()`/`redirect()` throws for pages. `Result`/`ok`/`err` are never used. This is both dead code (clean-code §"Anti-AI-Tics": "every line must have a reason") and a consistency violation (clean-code §"Consistency": one error-handling approach per project — the README documents a second one that does not exist in code).

---

## Minor

### m1. `roleTones` constant duplicated verbatim
Identical definition in two files:
- `app/(admin)/admin/staff/page.tsx:11`
- `app/dev-login/dev-login-form.tsx:15`

```ts
const roleTones = { MANAGER: "brand", STAFF: "green", DRIVER: "amber" } as const;
```
Belongs in `lib/permissions.ts` (next to `ROLE_DEFAULTS`) or a shared UI-tone map. Two call sites now — exactly the Rule-of-2 threshold.

### m2. Client-side `response.json().catch(() => ({}))` + error-extract pattern repeated 7×
Across six client components:
- `app/(admin)/admin/staff/new/new-staff-form.tsx:30`
- `app/setup/setup-form.tsx:25`
- `app/invite/[token]/confirm-invite-button.tsx:16`
- `app/(admin)/admin/staff/[id]/staff-editor.tsx:55, 90, 104`
- `app/dev-login/dev-login-form.tsx` (similar shape via `response.ok`)

Each does: `fetch` → `await response.json().catch(() => ({}))` → `if (!response.ok) setError(body.error ?? "fallback")`. A small `apiFetch` helper returning `{ ok, body, error }` would dedupe the catch-fallback dance. Borderline under the "removing duplication adds more lines than it saves" carve-out, but the `body.error ?? "..."` fallback string is hand-rolled per call site and inconsistent.

### m3. `recordAudit` actor boilerplate repeated ~9×
`actor: { id: X.id, email: X.email }` is hand-constructed at every audit call:
- `app/api/admin/staff/route.ts:55`
- `app/api/admin/staff/[id]/route.ts:71-72, 81-82`
- `app/api/admin/staff/[id]/impersonate/route.ts:27`
- `app/api/admin/staff/[id]/revoke/route.ts:26`
- `app/api/admin/impersonation/stop/route.ts:23`
- `app/api/setup/route.ts:50`
- `app/api/dev-auth/route.ts:39`
- `app/api/invite/[token]/route.ts:21`

`recordAudit` could accept `ctx: AuthContext` (or an `actor: StaffUser` directly) and build the `{ id, email }` pair internally. Stable duplication, so Minor rather than Major, but it's nine sites of the same shape.

### m4. `request.json().catch(() => null)` + `safeParse` + 400 block repeated 5×
Across the JSON-accepting API routes:
- `app/api/admin/staff/route.ts:32-36`
- `app/api/admin/staff/[id]/route.ts:27-31`
- `app/api/setup/route.ts:17-21`
- `app/api/dev-auth/route.ts:19-23`
- `app/api/client-error/route.ts:14-18`

A `parseBody(request, schema, fallbackMessage)` helper would collapse each to one line. The per-route error messages ("Name, valid email, and role are required", "Expected { version, role?, overrides? }", etc.) can be passed as the third arg.

### m5. `Role` / `Effect` string-literal unions redeclare Prisma enums (type/schema drift)
- `app/(admin)/admin/staff/[id]/staff-editor.tsx:10-11`: `type Role = "MANAGER" | "STAFF" | "DRIVER"; type Effect = "GRANT" | "DENY";`
- `app/dev-login/dev-login-form.tsx:8-13`: `role: "MANAGER" | "STAFF" | "DRIVER"` inside `StaffOption`

These hand-rolled unions duplicate `StaffRole` and `OverrideEffect` from `@prisma/client` (defined in `prisma/schema.prisma:10-25`). If the schema enum ever gains a value, these types silently stay stale. Import `StaffRole` / `OverrideEffect` from `@prisma/client` instead.

### m6. `StaffOption` interface duplicates a `StaffUser` subset
`app/dev-login/dev-login-form.tsx:8-13` defines a bespoke `StaffOption` shape (`id`, `name`, `email`, `role`) that mirrors the Prisma `StaffUser` projection the server already does with `select` (`app/dev-login/page.tsx:22`). Use `Pick<StaffUser, "id" | "name" | "email" | "role">` (or the Prisma-generated select type) so the client contract can't drift from the server projection.

### m7. Dead re-exports in `lib/auth.ts`
- Line 11: `export { SESSION_COOKIE };` — every consumer imports `SESSION_COOKIE` from `@/lib/session-codec` (verified across `middleware.ts` and all five session-issuing routes). Nobody imports it from `@/lib/auth`.
- Line 12: `export type { SessionPayload };` — likewise only re-used internally; no external import from `@/lib/auth`.
- Line 91: `export type { Prisma };` — `Prisma` is only ever imported from `@prisma/client` (in `lib/audit.ts:1` and `lib/auth.ts:5`). The re-export has no consumer.

Three dead exports; remove or consolidate the import surface to one path (`@/lib/session-codec` for codec symbols, `@prisma/client` for `Prisma`).

### m8. `result` variable name (banned standalone)
`app/api/admin/staff/[id]/route.ts:43, 95, 98` uses `result` as the `$transaction` return binding. `result` is on the clean-code banned list ("No vague names: `data`, `result`, `info`, `temp`, `val`, `item`, `thing`"). Rename to `transactionOutcome` / `updateOutcome` — or, since the only meaningful branch is `conflict`, a tighter `const { conflict } = await prisma.$transaction(...)` would let the rest read off `conflict` directly.

### m9. `fresh` variable name is vague
`app/api/admin/staff/[id]/route.ts:104`: `const fresh = await prisma.staffUser.findUnique(...)`. `fresh` isn't on the banned list but doesn't describe what it holds. `reloadedStaff` / `updatedStaff` reads as the re-read after the transaction.

### m10. Route-level `error.tsx` silently swallows errors; `global-error.tsx` reports them
- `app/error.tsx` (route error boundary) renders a fallback UI but does **not** POST to `/api/client-error`.
- `app/global-error.tsx:13-25` does POST to `/api/client-error`.

Two error boundaries, one reports and one doesn't — pattern drift in error reporting. Either the route boundary should also report, or the README should document why only the global boundary reports (e.g. route-boundary errors are already surfaced by the framework). Today the route boundary is a silent catch.

### m11. `global-error.tsx` is visually inconsistent with the app
`app/global-error.tsx:7` uses inline `style={{ padding: "4rem", fontFamily: "system-ui, sans-serif", textAlign: "center" }}` and an unstyled `<button>`, while every other screen uses Tailwind classes, the `Button` component, and the `brand` palette. The inline-style choice is defensible (Next.js `global-error` replaces the root layout, so `globals.css` may not be loaded), but the unstyled `<button>` and absence of `BRAND`/`Button` are not forced by that constraint — the component import path still works. Result: the most severe error screen looks least like the app (clean-code §"UI Consistency": "If a new screen looks different from the rest of the app, that's a bug").

---

## Notes / non-findings

- **No god files.** Largest TS file `lib/auth.ts` (91 lines); largest overall `prisma/schema.prisma` (101 lines).
- **Page vs API auth patterns differ** (`requirePermission` throwing `forbidden()`/`redirect()` vs `requireApiPermission` returning an `ApiGate` discriminated union). This is intentional — pages can't return `NextResponse` — and is not drift.
- **`concurrency-smoke.mjs` / `migration-guard.mjs` / `db-start.mjs`** are well-named, single-purpose scripts; no findings.
- **`lib/env.ts` + `lib/env-spec.ts` split** is a clean single-source-of-truth for env config; no drift.
- **`lib/settings.ts`** typed-key-value pattern is consistent and used by `setup/route.ts` only today, but is the right shape for future settings keys — not premature.
