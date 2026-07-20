# P1 Clean-code review — arm-02

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-02
**Tree / phase:** arms/arm-02/workspace/ — P1 foundation (identity, roles, staff tooling)
**Reviewer focus:** duplication, naming, god files, pattern drift (per `rules/clean-code.md`)
**Scope:** findings only.

---

## Findings

### F1 — Duplicated client-side fetch+error pattern (Rule of 2 → 3 call sites)
`components/staff-manager.tsx` `callApi`, `components/setup-form.tsx` `submitSetup`, and `app/login/page.tsx` `submitLogin` each reimplement the same shape: clear error → `fetch` → `response.json().catch(() => null)` → set error message from `body?.error ?? fallback` → branch on `response.ok`. Three real call sites with minor variations. Extract an `apiFetch` helper (or a small `useApiForm` hook) and let the call sites pass a success handler.

### F2 — Duplicated API route body-parsing boilerplate (5+ call sites)
Every JSON route repeats `const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });`. Appears in `app/api/staff/route.ts`, `app/api/staff/[id]/route.ts`, `app/api/staff/[id]/overrides/route.ts`, `app/api/auth/login/route.ts`, `app/api/setup/route.ts`, `app/api/impersonate/route.ts`, `app/api/client-error/route.ts`. Extract `parseBody(request, schema)` returning `{ data } | { error }`.

### F3 — Duplicated script bootstrap
`prisma/seed.ts` and `scripts/concurrency-smoke.ts` both open with `const db = new PrismaClient();` and close with the identical tail `main().catch((error) => { console.error(error); process.exit(1); }).finally(() => db.$disconnect());`. `lib/db.ts` already centralizes the client for the app; scripts can't reuse it (standalone process), but the run/disconnect scaffold is duplicated. Extract a `runScript(fn)` helper.

### F4 — Inconsistent button pattern within one file
`components/session-buttons.tsx` defines `StopImpersonationButton` using the shared `Button` component, but `LogoutButton` renders a raw `<button>` with hand-rolled classes (`text-xs text-muted hover:text-danger hover:underline`). Two styling approaches in the same file for the same concern. Either add a `variant="link"` to `Button` or use one consistent approach.

### F5 — Raw `<a>` vs `next/link` drift
`app/setup/page.tsx` uses `<a href="/login">` while `app/(storefront)/page.tsx`, `app/unauthorized.tsx`, `app/forbidden.tsx`, and `app/(admin)/admin/layout.tsx` all use `next/link` `Link`. The setup page is the lone outlier and loses client-side navigation. Use `Link`.

### F6 — Magic cookie string duplicated, single-source-of-truth broken
`lib/auth/session.ts` exports `SESSION_COOKIE = "tomchei_session"`, but `middleware.ts` hardcodes the literal `"tomchei_session"` (line 7). Constraint: middleware runs in the edge runtime and cannot import `lib/auth/session` (which pulls `db` + `next/headers`). Move `SESSION_COOKIE` to an edge-safe constants module (e.g. `lib/auth/constants.ts`) and import from both.

### F7 — Inconsistent color tokens (raw Tailwind vs semantic)
`components/ui/badge.tsx` uses `bg-red-100 text-danger` and `bg-green-100 text-success`; `components/staff-manager.tsx` line 53 uses `bg-red-100 text-danger` for the error banner. The rest of the app uses semantic tokens (`bg-brand-soft`, `bg-danger`, `bg-surface`). The `red-100`/`green-100` raw colors bypass the theme. Add `--danger-soft` / `--success-soft` tokens (mirroring `--brand-soft`) and use them.

### F8 — Inline styles in `global-error.tsx`
`app/global-error.tsx` uses `style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center" }}` and a second inline style on the button. Every other surface uses Tailwind classes against `globals.css` tokens. `global-error` renders its own `<html>` and cannot use the root layout, but it can still `import "./globals.css"` and use the tokenized classes — do that.

### F9 — Swallowed error in `app/error.tsx`
`app/error.tsx` line 23 ends the client-error report fetch with `.catch(() => {})` — an empty catch block. The clean-code rule bans swallowed errors. Either log a `console.warn` so transport failures are visible in dev, or add a comment stating the intentional swallow (report failures must never mask the original error).

### F10 — Vendor-locked naming `clerkUserId` (schema drift)
`lib/customers.ts` accepts a vendor-neutral `authUserId` param but persists it to a field named `clerkUserId` (`prisma/schema.prisma` `Customer.clerkUserId`, and `StaffUser.clerkUserId`). The function signature and the storage shape disagree on abstraction level, and the schema bakes a specific vendor into the column name. Rename the column/field to `authUserId` (or `externalAuthId`) so the data model stays vendor-neutral like the helper's API.

### F11 — Duplicated self-edit guard
`app/api/staff/[id]/route.ts` (line 16) and `app/api/staff/[id]/overrides/route.ts` (line 22) both open with `if (id === gate.staff.realUser.id) return Response.json({ error: "..." }, { status: 400 });` with slightly different messages. Extract `rejectSelfEdit(staff, id)` returning `Response | null`.

### F12 — Over-verbose inline dynamic import in `scripts/db-start.ts`
Line 14: `const isFreshCluster = !(await import("fs")).existsSync("./.pgdata/PG_VERSION");`. The inline `await import("fs")` is an unnecessary dynamic import. Use a top-level `import { existsSync } from "node:fs";` and call `existsSync(...)` directly.

### F13 — Defensive optional chaining on a guaranteed non-null
`app/(admin)/admin/page.tsx` renders `Signed in as {staff?.actingAs.name} ({staff?.actingAs.role}).` but the parent `app/(admin)/admin/layout.tsx` already `redirect("/login")` when `staff` is null, so `staff` is guaranteed non-null here. Either drop the `?.` (the layout guarantees presence) or, for consistency with the other admin pages, gate the page with `requirePermissionPage(null)` instead of `getStaffContext`. Weaker finding — the optional chain is harmless but signals intent drift.

### F14 — Duplicated "create staff user" core
`app/api/setup/route.ts` and `app/api/staff/route.ts` both perform `email.toLowerCase()` → `hashPassword(password)` → `db.staffUser.create({ data: { name, email, role, passwordHash } })`. Setup wraps it in a transactional bootstrap lock, so the contexts differ, but the create-step is duplicated. Extract a `createStaffUser(tx, input)` helper that both call. Weaker finding — the transactional lock makes the duplication shallow.

### F15 — `staff-manager.tsx` mixed concerns (approaching god file)
`components/staff-manager.tsx` is 240 lines holding four components: `StaffManager`, `AddStaffForm`, `StaffRow`, `OverrideEditor`. Under the 500-line threshold, but `OverrideEditor` is a self-contained tri-state permission editor with its own state and would read more clearly as `components/override-editor.tsx`. Splitting by concern (not by size) is justified. Weaker finding — not yet a god file.

---

## Notes (not findings)
- `lib/db.ts` global-singleton pattern, `lib/cn.ts`, `components/ui/*` tokenization, `lib/auth/*` gate structure, and the audit `writeAudit` helper are clean and consistent.
- Comments where present (`middleware.ts`, `app/api/staff/[id]/route.ts` line 34, `lib/customers.ts`) explain intent, not narration — good.
- `app/api/health/route.ts` try/catch around `db.$queryRaw` is legitimate (DB may be unreachable) — not an anti-tic.
- `app/api/staff/[id]/overrides/route.ts` `z.enum(ALL_PERMISSIONS as [string, ...string[]])` is a necessary tuple assertion, not a redundant one.
