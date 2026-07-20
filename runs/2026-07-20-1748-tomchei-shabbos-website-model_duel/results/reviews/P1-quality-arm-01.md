# Reviewer specialist — Quality

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01`
**Tree / phase:** P1 — Foundation, identity, roles, permissions, staff tooling
**Output:** `results/reviews/P1-quality-arm-01.md`
**Reviewer focus:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.
**EXPECTED ref:** `shared/phases/PHASE-P1-EXPECTED.md`
**Smoke evidence reviewed:** `arms/arm-01/workspace/.scratch/PHASE-P1-SMOKE.md`, `.scratch/live-smoke.mjs`, `.scratch/PHASE-P1-STATUS.md`

---

## Summary

P1 is largely complete and the live smoke (20 checks) plus `npm run ci` pass. The schema, roles, permission overrides, optimistic concurrency, audit trail, and Clerk/local-dev auth adapter all work end-to-end through the API. However, several flows are broken or stubbed at the **UI/production** layer even though the API-level smoke masks them. The most serious are an unauthenticated bootstrap/accept-invite path that trusts a spoofable client header, a setup page that is unreachable in a browser before the first manager exists, and an invitation token that the UI never surfaces.

Findings only. No remediation steps are proposed here.

---

## Findings

### Q1 — Bootstrap and invite-acceptance trust a spoofable client header instead of Clerk (Critical)

`src/app/api/setup/route.ts:16` and `src/app/api/staff/accept-invite/route.ts:7` read the caller's Clerk identity from `request.headers.get("x-clerk-user-id")` and never call `auth()` from `@clerk/nextjs/server`. Every other protected endpoint in the arm goes through `getCurrentStaffUser()` → `auth()` when Clerk is configured. These two endpoints do not.

Consequence: in a production deployment with Clerk keys set, anyone can POST to `/api/setup` with an arbitrary `x-clerk-user-id` and create the first Manager (locking bootstrap to an attacker-chosen identity), and anyone holding an invite token can accept it bound to any spoofed `clerkUserId`. The `x-test-clerk-user-id` dev header is also conflated with the production `x-clerk-user-id` header in `src/lib/auth.ts:23`, so the local-dev bypass and the production spoof share the same code path.

Severity: Critical. This defeats EXPECTED #3 (Clerk auth) and #5 (first-run setup locks) for any non-local deployment.

### Q2 — Setup page is unreachable in a browser before the first Manager exists (Critical)

`src/app/(admin)/setup/page.tsx` lives inside the `(admin)` route group, so it is wrapped by `src/app/(admin)/admin/layout.tsx`. That layout unconditionally calls `getCurrentStaffUser()` and renders the 403 panel when no active staff session exists (`layout.tsx:9-24`). On an empty DB there is no staff user, so `getCurrentStaffUser()` returns null and `/setup` renders the access-denied page — the bootstrap form is never shown.

The smoke proves the **API** path works (`POST /api/setup` → 201 then 409), but it never loads the `/setup` page in a browser. The documented S4 flow ("setup page bootstraps first manager") is therefore broken at the UI layer.

Severity: Critical. EXPECTED #5 / S4 cannot be exercised through the UI as built.

### Q3 — Invitation token is generated but never surfaced in the UI (Major)

`POST /api/admin/staff` returns `inviteToken` in the response (`api/admin/staff/route.ts:88-91`), and the smoke uses it to call `/api/staff/accept-invite`. But `src/app/(admin)/admin/staff/staff-manager.tsx:37-44` discards `payload.inviteToken` and only shows "Invitation created for …". The token is hashed at rest (`StaffInvite.tokenHash`), so it cannot be recovered later. A manager using the UI has no way to retrieve or deliver the invite link, so the invitation flow is functionally incomplete from the staff management screen.

Severity: Major. EXPECTED #6 ("Staff management UI: add users, assign roles") delivers the create, but the invite cannot be delivered without the token.

### Q4 — Admin page gate returns 200 with a 403-styled body, not an HTTP 403 (Major)

`src/app/(admin)/admin/layout.tsx:10-24` returns JSX (HTTP 200) for unauthorized staff. EXPECTED S3 says "Staff without permission → 403 on protected admin route." The API routes correctly return 403 (`requirePermission` → `AccessDeniedError`), and the smoke's 403 evidence is all from `/api/admin/*`. The page route never emits an actual 403 status; it renders a 200 "Access denied" panel. Any tooling or middleware that relies on the HTTP status code (logs, monitoring, `next.config` rewrites) will not see a 403 for the admin pages.

Severity: Major. Partial miss on S3 for page routes.

### Q5 — Impersonation has no end control in the UI and never closes the DB session (Major)

`POST /api/admin/impersonation` creates an `ImpersonationSession` and an audit event, and sets a 1-hour `impersonate_staff_id` cookie. `DELETE /api/admin/impersonation` clears the cookie but:
- does not update `ImpersonationSession.endedAt` (`api/admin/impersonation/route.ts:63-70`), so sessions are never closed in the database;
- is not wired to any "Stop impersonating" button in `staff-manager.tsx` or the admin layout banner (`layout.tsx:30-35`). The banner only states "Impersonating …" with no exit action.

A manager is stuck impersonating until the cookie expires or they manually call the DELETE endpoint. EXPECTED #6 lists "impersonation with banner + audit trail"; the banner exists but the end-of-session flow is missing.

Severity: Major.

### Q6 — Concurrency smoke and live smoke are not wired into CI (Moderate)

`package.json` defines `smoke:concurrency` and `.scratch/live-smoke.mjs` exists, but `npm run ci` = `lint && typecheck && test && db:guard` — neither smoke is included. The CI workflow (`.github/workflows/ci.yml`) runs `db:deploy` then `npm run ci`. EXPECTED #10 ("Concurrency smoke") and #9 ("baseline seed runs") are therefore verified only manually in the status doc, not enforced in CI. The concurrency smoke script (`scripts/concurrency-smoke.ts`) also requires a live DB and is not run in the CI job that already provisions Postgres.

Severity: Moderate. The check exists but is not gating.

### Q7 — Baseline seed is not run in CI (Moderate)

`ci` does not invoke `db:seed`. The CI workflow runs `db:deploy` but never seeds. EXPECTED #9 explicitly lists "baseline seed runs." The seed script exists (`prisma/seed.ts`) and is gated behind `SEED_DEMO_STAFF`, but it is never executed in the pipeline, so a schema/seed drift would not be caught.

Severity: Moderate.

### Q8 — `client-errors` endpoint ignores `CLIENT_ERROR_TOKEN` (Minor)

`src/lib/env.ts:21` declares `CLIENT_ERROR_TOKEN` and `.env.example` advertises it, but `src/app/api/client-errors/route.ts` never reads or verifies it. Any unauthenticated caller can POST up to 2 KB per request and spam `console.error`. The token is a stub.

Severity: Minor. Incomplete vs the advertised contract.

### Q9 — `SessionStamp` model is dead schema (Minor)

`prisma/schema.prisma:99-108` defines `SessionStamp` with a `StaffUser` relation and indexes, but no code in `src/` ever writes to or reads from it. It is migrated into the DB and then unused. EXPECTED #1 lists the scaffold; this table is carried as dead weight.

Severity: Minor. Stub that should either be wired up or deferred to a later phase.

### Q10 — Unused helper libraries shipped in P1 (Minor)

`src/lib/money.ts`, `src/lib/dates.ts`, `src/lib/season.ts`, `src/lib/safe-result.ts`, and `normalizePhone` in `src/lib/normalize.ts` are defined but have no call sites in P1. `formatCents`, `formatOrganizationDate`, `getSeasonYear`, `formatSeasonName`, `maskUnexpectedError`, and `SafeResult` are all dead code at this phase. They are reasonable forward-looking helpers but violate the "Rule of 2" — no real call sites yet.

Severity: Minor. Premature; will likely be used in later phases, but currently dead.

### Q11 — PATCH permission arrays are not validated against the known permission set (Minor)

`api/admin/staff/route.ts:100-107` types `grantPermissions`/`denyPermissions` as `string[]` and persists them raw. `hasPermission` only ever compares against the fixed `permissions` tuple, so unknown strings are harmless at check time, but arbitrary strings can be written to the DB (data hygiene drift) and there is no server-side rejection of typos or malformed values. The UI only ever sends known values, but the API does not enforce it.

Severity: Minor.

### Q12 — Role/permission changes fire a PATCH on every checkbox/select change with no conflict UX (Minor)

`staff-manager.tsx:131,140,152,172` call `updateStaff` on every `onChange`. Rapid toggles race on the `version` field; a 409 just sets `message` to "This staff record changed. Reload before saving again." with no reload action offered. A misclick on the role `<select>` also immediately demotes/promotes a user with no confirmation. Functionally correct for a single edit, but fragile under fast interaction.

Severity: Minor. UX/correctness edge.

### Q13 — `next.config.ts` throws at module load when `DATABASE_URL` is missing (Minor)

`next.config.ts:3-7` throws if `DATABASE_URL` is unset. This is intentional fail-fast and the status doc confirms a "missing env" smoke passes, but it also means `next lint`/`next build` for static analysis and any tool that imports the config without a `.env` will crash with a non-actionable error rather than a structured message. The `readServerEnvironment()` helper in `src/lib/env.ts` already does this properly; the config duplicates it.

Severity: Minor.

---

## Smoke vs EXPECTED reconciliation

| EXPECTED | Status | Note |
|---|---|---|
| 1 Scaffold + route groups + env validation | Pass | `(storefront)`, `(admin)`, `(driver)` present; env validation in `lib/env.ts`. |
| 2 `/api/health` green when DB up | Pass | S2 smoke 200 + `database:"ok"`. |
| 3 Clerk auth + middleware + roles + overrides | Partial | Middleware (`proxy.ts`) and override logic work; **Q1** — setup/accept-invite bypass Clerk. |
| 4 Customers separate from staff | Pass | `CustomerAccount` distinct from `StaffUser`; smoke confirms. |
| 5 First-run setup bootstraps manager then locks | Partial | API locks correctly; **Q2** — setup page unreachable in browser. |
| 6 Staff management UI + impersonation + audit | Partial | UI exists; **Q3** invite token not surfaced; **Q5** impersonation end-flow missing. |
| 7 Admin shell + gated sidebar + 403 | Partial | Sidebar gates; **Q4** — page 403 is a 200 body, not HTTP 403. |
| 8 Design system baseline + global error page | Pass | `globals.css` tokens, `Button`, `global-error.tsx`. |
| 9 CI: lint, typecheck, migration guard, seed | Partial | lint/typecheck/guard pass; **Q6/Q7** — smokes and seed not in CI. |
| 10 Concurrency smoke (10 concurrent updates) | Pass (manual) | `live-smoke.mjs` proves 1×200 / 9×409; **Q6** — not enforced in CI. |

## Smoke gaps

- No browser-level smoke. All 20 checks hit API routes or static pages via `fetch`; none load `/setup` or `/admin/staff` through the gated layout, so Q2 and Q4 were not exercisable by the smoke.
- No production-Clerk smoke. The status doc notes Clerk keys were not supplied; the `auth()` path is unverified, which is exactly where Q1 lives.
- No impersonation-end smoke. The smoke starts impersonation but never calls `DELETE /api/admin/impersonation`, so Q5's unclosed session is invisible to the smoke.
