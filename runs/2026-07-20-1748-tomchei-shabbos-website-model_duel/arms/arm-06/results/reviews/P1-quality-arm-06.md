# P1 Quality Review — arm-06 (blind)

Reviewer: external quality specialist
Scope: `arms/arm-06/workspace/` only — Test 4 P1
EXPECTED: `shared/phases/PHASE-P1-EXPECTED.md` (10 must-be-true items + smoke S1–S5)
Smoke evidence: `arms/arm-06/workspace/.scratch/PHASE-P1-SMOKE.md` + `.scratch/PHASE-P1-STATUS.md` + `.scratch/smoke/` (raw transcripts + response bodies)
Mode: findings only — no fixes proposed.

## Verdict

EXPECTED checklist: 10/10 items demonstrably DONE in code; smoke S1–S5 all PASS against a production build on `127.0.0.1:3106` (embedded Postgres on 4106). Concurrency smoke verified independently (`scripts/concurrency-smoke.mjs` → 1 win / 9 conflicts / 0 silent overwrites). No blockers found. One Major deviation from EXPECTED (documented), several Minor correctness/coverage gaps.

Counts: **Blocker 0 · Major 1 · Minor 7**

---

## Major

### M1 — Clerk not integrated; dev-auth bypass ships in its place (EXPECTED #3 partially unmet)
EXPECTED #3 requires "Clerk auth + middleware; StaffUser roles … with per-user permission grant/deny overrides." The arm ships an HMAC-signed cookie session (`lib/session-codec.ts`) plus `/dev-login` + `/api/dev-auth` gated by `DEV_AUTH_BYPASS=true` instead of Clerk. `@clerk/nextjs` is not in `package.json` and there is no Clerk middleware; `middleware.ts` only does a signature check on the custom cookie.

Documented as a deviation in `PHASE-P1-STATUS.md` § Deviation and `README.md` § Auth, with a clean swap seam at `lib/session-codec.ts`. All role/permission gates (`requirePermission`, `requireApiPermission`, `hasPermission` deny>grant>role-default) execute against real `StaffUser` rows + overrides, and S3–S5 exercise them — so the security model itself is functional and verified. The gap is the identity provider integration only. Major rather than Blocker because: (a) the arm could not obtain live Clerk keys on this host, (b) the seam is isolated, (c) every permission/role/impersonation/audit behavior EXPECTED cares about is implemented and smoke-verified. But strictly against EXPECTED wording, Clerk is absent.

Files: `lib/session-codec.ts`, `lib/auth.ts`, `middleware.ts`, `app/api/dev-auth/route.ts`, `app/dev-login/`, `package.json`.

---

## Minor

### m1 — `requireStaff` redirects to `/dev-login` unconditionally
`lib/auth.ts:53` does `redirect("/dev-login")` for any unauthenticated request to a protected page. `/dev-login` 404s when `DEV_AUTH_BYPASS=false` (`app/dev-login/page.tsx:16` calls `notFound()`), so in a production-shaped config an unauthenticated hit to `/admin` lands on a 404 instead of a real login page. Acceptable for P1 given M1, but the redirect target is hardcoded to the dev seam and will need rewiring when Clerk lands.

### m2 — Health endpoint leaks `devAuthBypass` flag to unauthenticated callers
`app/api/health/route.ts:12` returns `devAuthBypass: true` in the JSON body. S2 confirmed: `{"ok":true,"db":"up","env":"ok","devAuthBypass":true}`. This discloses the internal auth mode to any unauthenticated caller. The `env: "ok"` field is also returned unconditionally (the comment notes env validation happens at boot) — redundant but harmless. Consider dropping `devAuthBypass` from the public health payload.

### m3 — Dead code / premature scaffolding in `lib/`
`lib/money.ts`, `lib/ids.ts`, `lib/phone.ts`, `lib/dates.ts`, `lib/result.ts` have zero importers in P1 (grep across `app/`, `components/`, `scripts/`, `prisma/`). `README.md` § Patterns advertises `Result` + `maskError` and "Money: integer cents" as established patterns, but `maskError` is never called and `toCents`/`formatMoney`/`generatePublicId`/`normalizePhone`/`formatDate`/`addDays` have no call sites. Violates the Rule of 2 (no real call sites yet). Only `lib/season.ts` (storefront) and `lib/cn.ts` (UI kit) of the "utility" libs are actually used. Either delete the unused libs or stop advertising them as live patterns.

Files: `lib/money.ts`, `lib/ids.ts`, `lib/phone.ts`, `lib/dates.ts`, `lib/result.ts`, `README.md:40-43`.

### m4 — `global-error.tsx` does not report to `/api/client-error`
`app/error.tsx` POSTs bounded/redacted error info to `/api/client-error` (R-132). `app/global-error.tsx` — the root error boundary that catches errors the route boundary cannot — renders only a static message with no reporting call. So the most severe errors (root-level) escape the bounded client-error channel that EXPECTED #8 implies. The `/api/client-error` route itself is correctly bounded (`app/api/client-error/route.ts`: 500/300-char caps, first stack line only).

### m5 — Smoke coverage gaps on override + deny paths
S3 verifies: staff→403 on `/admin/staff`, manager→200, driver→403 on `/admin`. S5 verifies `role_change` + `impersonation_start` in audit. But:
- (a) The **grant-override** path (a STAFF/DRIVER with a `GRANT` override accessing a gated route they would otherwise be denied) is unit-tested only (`scripts/test-permissions.mts:31-35`) — no smoke exercises a real HTTP request through the gate with an override in place.
- (b) The **PATCH overrides** flow (replace-all semantics in `app/api/admin/staff/[id]/route.ts:44-55`) is not smoke-tested at all; only role-change PATCH is exercised (S5a). The `permission_override` audit row is never asserted in smoke.
- (c) The **deny-override-beats-manager** path is unit-only (`test-permissions.mts:37-41`).

The override editor UI exists (`app/(admin)/admin/staff/[id]/staff-editor.tsx:79-85`) but its save path has no end-to-end smoke evidence.

### m6 — `settings.manage` permission is an unused surface
`lib/permissions.ts:8` defines `settings.manage`; `test-permissions.mts:22` asserts STAFF lacks it. But there is no settings-management UI, no `/api/admin/settings` route, and no sidebar entry. The `Setting` model + `lib/settings.ts` typed store exist and `setup.completed` is written by `/api/setup`, but nothing reads `settings.manage`. Stub for a later phase — not a regression, but an unused permission that inflates the permission surface without a consumer.

### m7 — Inconsistent `AuthSession` metadata capture
`/api/dev-auth` records `ip` (from `x-forwarded-for`) and `userAgent` (`app/api/dev-auth/route.ts:31-37`). The setup bootstrap (`app/api/setup/route.ts:48`) and invite-confirm (`app/api/invite/[token]/route.ts:19`) paths create `AuthSession` rows without IP/UA. So session audit metadata is captured for dev-logins but not for bootstrap or invite-confirm logins. Minor inconsistency in an audit-relevant field.

---

## What was verified clean (no finding)

- **EXPECTED #1** scaffold: route groups `(storefront)`/`(admin)`/`(driver)` present; `lib/env.ts` zod-validated at boot; `.env.example` generated from `lib/env-spec.ts` via `npm run gen:env-example`; missing `DATABASE_URL`/`AUTH_SECRET` aborts startup with both names listed (smoke env-validation evidence).
- **EXPECTED #2** `/api/health`: 200 + `db:up` confirmed (S2 transcript + `s2.json`).
- **EXPECTED #4** customers separate: `Customer` model with `clerkUserId` link; seed creates 1 customer, 0 staff (`prisma/seed.ts`).
- **EXPECTED #5** bootstrap+lock: advisory lock makes empty-DB check atomic (`app/api/setup/route.ts:25-38`); repost → 409 "Setup is locked"; page shows locked text (S4 + `s4-locked.html`).
- **EXPECTED #6** staff UI + impersonation + audit: list/new/`[id]` editor pages present; invite-confirm flow (R-112/113) works; impersonation API + banner (`s5-banner.html` contains "Viewing as shimon.staff@example.org (impersonated by rivka.manager@example.org). Actions are audited." + Stop button); audit rows for `role_change`, `impersonation_start`, `impersonation_stop`, `bootstrap_manager`, `staff_create`, `staff_confirm`, `session_login` all present (S5g).
- **EXPECTED #7** admin shell + 403: `app/(admin)/admin/layout.tsx` gates `admin.access`; sidebar filtered per permission; S3 staff→403, manager→200, driver→403 confirmed in transcript + `s3-*.html` bodies.
- **EXPECTED #8** design system + error page: Tailwind v4 `@theme` tokens (`app/globals.css`), `lib/brand.ts`, kit in `components/ui/` (button/input/label/select/card/badge), `app/error.tsx` + `global-error.tsx` + bounded `/api/client-error`. (See m4 for the gap.)
- **EXPECTED #9** CI scripts: `npm run lint`/`typecheck`/`migration-guard`/`test:permissions`/`seed` all present in `package.json`; `migration-guard.mjs` checks folder naming, order, `migrate status`, and `migrate diff` drift; 7/7 permission unit tests.
- **EXPECTED #10** concurrency: `scripts/concurrency-smoke.mjs` fires 10 versioned PATCHes at one fixture; transcript shows `[409×9, 200×1]`, `wins=1 conflicts=9 others=0 passed=true`. Optimistic concurrency via `updateMany` with `where: { id, version }` (`app/api/admin/staff/[id]/route.ts:59-65`) — stale writers are no-ops, not silent overwrites.
- **Self-target blocks (R-119)**: `canTargetStaff` enforced in role-change, revoke, and impersonate routes; staff-editor disables role select + Save when `isSelf`.
- **Impersonation applies target's real permissions**: manager impersonating driver → `/admin` → 403 (S5e confirmed).
- **Revoke kills session**: revoked driver → `/driver` → 307 to login (transcript); `getAuthContext` returns null when `status !== "ACTIVE"` (`lib/auth.ts:39`).

## Notes

- The arm ran `prisma migrate reset` was deliberately NOT used (requires interactive consent); baseline restored via `.scratch/clear-staff.mts` (FK-ordered deletes). Documented in smoke notes.
- PowerShell 5.1 `curl.exe` JSON quoting worked around with `--data-binary @file` payloads in `.scratch/run-smoke.ps1`. Documented.
- `experimental.authInterrupts` enabled in `next.config.mjs` for `forbidden()` 403 boundary (Next 15.5 flag). Documented in STATUS.
