# P1 Aggregate Review — arm-06 (blind)

Aggregator: external aggregate reviewer
Scope: `arms/arm-06/workspace/` — Test 4 P1 (Foundation: identity, roles, permissions, staff tooling)
Inputs: P1 specialist reviews (security, quality, rules, clean-code). No new findings.
Dedup: by location + claim; security blockers always survive (none reported).
Conflict resolution: `app/error.tsx` was read directly — it DOES POST to `/api/client-error` (lines 13-25); `app/global-error.tsx` does NOT. Therefore quality m4 is retained and clean-code m10 (inverted claim) is dropped as factually wrong.

## Counts

| Band | Before dedupe (sum across specialists) | After dedupe |
|---|---|---|
| Blocker | 0 | 0 |
| Major | 8 | 7 |
| Minor | 28 | 24 |

Source specialist counts (as submitted): security 0/3/7, quality 0/1/7, rules 0/2/3, clean-code 0/2/11.

---

## Blockers

None.

---

## Majors (7)

### A-M1. Impersonation actions mis-attributed in the audit trail
**Sources:** security M1.
**Files:** `lib/auth.ts` (AuthContext carries `impersonator` but unused by audit writers); `app/api/admin/staff/[id]/route.ts` PATCH; `app/api/admin/staff/[id]/revoke/route.ts`; `app/api/admin/staff/route.ts` POST; `lib/audit.ts` (no impersonator field on AuditEntry).
During impersonated sessions `ctx.staff` is the impersonated target, so every `recordAudit({ actor: { id: gate.ctx.staff.id, ... } })` row attributes the action to the target, not the impersonator. Only `impersonation_start`/`impersonation_stop` carry the impersonator identity. Defeats the forensic purpose EXPECTED #6 requires.

### A-M2. Cross-privilege impersonation is unbounded
**Sources:** security M2.
**Files:** `app/api/admin/staff/[id]/impersonate/route.ts` (no target-role ≤ actor-role check); `lib/permissions.ts` (`canTargetStaff` blocks self only).
Any holder of `staff.impersonate` can impersonate any active staff user including a MANAGER, inheriting all manager permissions. Since `staff.impersonate` is a grantable override, a Manager can grant it to STAFF/DRIVER who then escalate. Combined with A-M1 the escalated actions are audited under the impersonated manager's identity.

### A-M3. Sessions never expire and are not invalidated server-side
**Sources:** security M3.
**Files:** `prisma/schema.prisma` (`AuthSession` has no `expiresAt`, no revocation flag); `lib/auth.ts` (`getAuthContext` validates cookie signature + `status === "ACTIVE"` only, never consults `AuthSession`); `lib/session-codec.ts` (no `iat`/`exp` in payload).
A stolen cookie is a permanent credential. `AuthSession` is write-only — nothing reads it to validate or revoke; `/api/dev-auth` DELETE only clears the cookie client-side. Persistent-compromise risk for a staff-admin tool.

### A-M4. Clerk not integrated; dev-auth bypass ships in its place (EXPECTED #3 partially unmet)
**Sources:** quality M1.
**Files:** `lib/session-codec.ts`, `lib/auth.ts`, `middleware.ts`, `app/api/dev-auth/route.ts`, `app/dev-login/`, `package.json`.
EXPECTED #3 requires Clerk + middleware; arm ships an HMAC-signed cookie session plus `/dev-login` + `/api/dev-auth` gated by `DEV_AUTH_BYPASS=true`. `@clerk/nextjs` is not in `package.json`; `middleware.ts` only does a signature check on the custom cookie. Documented deviation with a clean swap seam at `lib/session-codec.ts`; all role/permission/impersonation/audit behaviors EXPECTED cares about are implemented and smoke-verified. Major (not Blocker) because the arm could not obtain live Clerk keys on this host, the seam is isolated, and the security model itself is functional.

### A-M5. Dead "for-later" helper modules in `lib/` + README advertises them as live
**Sources:** quality m3; rules Major 1; rules Minor 1; clean-code M2.
**Files:** `lib/dates.ts` (`formatDate`, `addDays`); `lib/money.ts` (`toCents`, `formatMoney`); `lib/ids.ts` (`generatePublicId`); `lib/phone.ts` (`normalizePhone`); `lib/result.ts` (`Result`, `ok`, `err`, `maskError`); `README.md:40` (Patterns table).
Five `lib/` modules ship functions with zero importers in the P1 tree. `ponytail.mdc` Rule of 2 + "no boilerplate for later"; `clean-code.mdc` dead-code refactor category + Anti-AI-Tics. Additionally `lib/result.ts` is a consistency violation: README documents `Result + maskError` as the error-handling pattern, but actual handlers use inline `NextResponse.json({ error }, { status })` and the `ApiGate` discriminated union in `lib/auth.ts:63-74`. Either delete the unused modules or stop advertising them as live patterns; the pattern choice could be a README line re-exported later.

### A-M6. Codegraph index never initialized
**Sources:** rules Major 2.
No `.codegraph/` directory anywhere under `arms/arm-06/workspace/`; no `codegraph init`/`status` evidence in `.scratch/`. `workflow.mdc` Session Start and `codegraph.mdc` Hard rule require an init attempt (or an "CLI unavailable" note) before structural work. Downgraded from Blocker to Major because 4 of 6 arms in this run lack the index, so CLI availability on this host is not fully confirmed from the tree alone — but the rule still requires an attempt and a note, neither of which exist.

### A-M7. Session-cookie issuance pattern duplicated 5×
**Sources:** clean-code M1.
**Files:** `app/api/admin/staff/[id]/impersonate/route.ts:34-40`; `app/api/admin/impersonation/stop/route.ts:30-33`; `app/api/setup/route.ts:56-59`; `app/api/dev-auth/route.ts:46-49`; `app/api/invite/[token]/route.ts:27-31`. Plus a sixth variant for cookie *clearing* in `dev-auth/route.ts:54`.
The "encode session → build response → set cookie → return" sequence is copy-pasted across five routes with only payload/body varying. Five real call sites (past Rule of 2). A single async helper (e.g. `issueSessionResponse(payload, body)`) in `lib/auth.ts` would remove ~14 net lines and centralize the cookie-shape decision — currently a drift risk: any change to `sessionCookieOptions()` propagation must be made in five places.

---

## Minors (24)

### Security

### A-m1. Non-constant-time HMAC signature comparison
**Sources:** security m1. **File:** `lib/session-codec.ts:48` — `if (signature !== expected) return null;`. String `!==` short-circuits on the first differing byte, exposing a timing side-channel on signature validation. Standard practice is a constant-time compare. Low network exploitability but a known-bad pattern for cookie/JWT signature checks.

### A-m2. Invite tokens never expire
**Sources:** security m2. **Files:** `app/api/invite/[token]/route.ts` (looks up by `inviteToken`, checks `status === "PENDING"` only); `prisma/schema.prisma` (`invitedAt` recorded but never consulted). `invitedAt` is populated on creation but no handler compares it to current time. UUIDv4 (122 bits) + single-use keeps risk low, but a leaked invite link stays live forever.

### A-m3. Unauthenticated `/api/client-error` writes to the security audit log
**Sources:** security m3. **File:** `app/api/client-error/route.ts`. Endpoint is unauthenticated and appends `client_error` rows to the same `AuditLog` table that holds `bootstrap_manager`, `role_change`, `impersonation_start`, etc. Schema is bounded (R-132, max 500 chars) so it cannot blow up the DB, but there is no rate limiting and no auth, so an attacker can pollute the audit trail with noise to obscure real security events.

### A-m4. `/api/health` leaks `devAuthBypass` flag to unauthenticated callers
**Sources:** security m4; quality m2. **File:** `app/api/health/route.ts:12` — `devAuthBypass: env.DEV_AUTH_BYPASS === "true"` in the 200 response body. S2 confirmed: `{"ok":true,"db":"up","env":"ok","devAuthBypass":true}`. Discloses the internal auth mode to any unauthenticated caller (tells an attacker whether `/api/dev-auth` is reachable). Drop `devAuthBypass` from the public health payload.

### A-m5. `AUTH_SECRET` minimum length is weak and dev `.env` ships a known value
**Sources:** security m5. **Files:** `lib/env-spec.ts:17` — `z.string().min(16)`; `.env:2` — `AUTH_SECRET="arm06-local-dev-secret-change-in-prod"`. 16 chars is below the conventional 32-byte (256-bit) guidance for HMAC-SHA256 keys. `.gitignore` correctly excludes `.env`, so this is a hygiene note, not a live leak — but if copied into a real environment an attacker who knows the harness convention could forge session cookies.

### A-m6. `x-forwarded-for` trusted verbatim for `AuthSession.ip`
**Sources:** security m6. **File:** `app/api/dev-auth/route.ts:35` — `ip: headerStore.get("x-forwarded-for")`. Header is client-controllable and stored as the session IP without sanitization or proxy-hop validation. Only used for logging (not auth decisions), so impact is limited to audit-log integrity — a reviewer examining sessions could be misled by a spoofed IP.

### A-m7. `sameSite: "lax"` is the only CSRF mitigation for state-changing routes
**Sources:** security m7. **File:** `lib/auth.ts:82-88` (`sessionCookieOptions`). State-changing handlers (`POST /api/setup`, `POST /api/dev-auth`, `POST /api/admin/staff*`, `POST /api/invite/[token]`, `POST /api/admin/impersonation/stop`) rely solely on `sameSite: "lax"`. `lax` blocks cross-site form/JSON POSTs, but it is a single layer with no token, no custom-header check, no `SameSite=strict`. Acceptable for P1; tighten before the app handles money.

### Quality

### A-m8. `requireStaff` redirects to `/dev-login` unconditionally
**Sources:** quality m1. **File:** `lib/auth.ts:53` — `redirect("/dev-login")` for any unauthenticated request to a protected page. `/dev-login` 404s when `DEV_AUTH_BYPASS=false` (`app/dev-login/page.tsx:16` calls `notFound()`), so in a production-shaped config an unauthenticated hit to `/admin` lands on a 404 instead of a real login page. Acceptable for P1 given A-M4, but the redirect target is hardcoded to the dev seam and will need rewiring when Clerk lands.

### A-m9. `global-error.tsx` does not report to `/api/client-error`
**Sources:** quality m4. **Files:** `app/error.tsx` (route boundary — POSTs bounded/redacted error info to `/api/client-error` per R-132); `app/global-error.tsx` (root error boundary — renders only a static message with no reporting call). The most severe errors (root-level) escape the bounded client-error channel EXPECTED #8 implies. (Note: clean-code m10 inverted this claim — direct file read confirms quality m4 is correct; clean-code m10 dropped as factually wrong.)

### A-m10. Smoke coverage gaps on override + deny paths
**Sources:** quality m5. S3 verifies staff→403 on `/admin/staff`, manager→200, driver→403 on `/admin`. S5 verifies `role_change` + `impersonation_start` in audit. But: (a) the **grant-override** path (a STAFF/DRIVER with a `GRANT` override accessing a gated route they would otherwise be denied) is unit-tested only (`scripts/test-permissions.mts:31-35`) — no smoke exercises a real HTTP request through the gate with an override in place; (b) the **PATCH overrides** flow (replace-all semantics in `app/api/admin/staff/[id]/route.ts:44-55`) is not smoke-tested at all; only role-change PATCH is exercised (S5a), and `permission_override` audit row is never asserted in smoke; (c) the **deny-override-beats-manager** path is unit-only (`test-permissions.mts:37-41`). Override editor UI exists (`app/(admin)/admin/staff/[id]/staff-editor.tsx:79-85`) but its save path has no end-to-end smoke evidence.

### A-m11. `settings.manage` permission is an unused surface
**Sources:** quality m6. **File:** `lib/permissions.ts:8`. `test-permissions.mts:22` asserts STAFF lacks it, but there is no settings-management UI, no `/api/admin/settings` route, and no sidebar entry. The `Setting` model + `lib/settings.ts` typed store exist and `setup.completed` is written by `/api/setup`, but nothing reads `settings.manage`. Stub for a later phase — an unused permission that inflates the permission surface without a consumer.

### A-m12. Inconsistent `AuthSession` metadata capture
**Sources:** quality m7. **Files:** `app/api/dev-auth/route.ts:31-37` (records `ip` from `x-forwarded-for` and `userAgent`); `app/api/setup/route.ts:48` (creates `AuthSession` without IP/UA); `app/api/invite/[token]/route.ts:19` (same). Session audit metadata is captured for dev-logins but not for bootstrap or invite-confirm logins. Minor inconsistency in an audit-relevant field. (Distinct from A-m6, which is about header spoofing on the same field.)

### Rules

### A-m13. `assertDevAuthEnabled` single call site + throw/catch for control flow
**Sources:** rules Minor 2. **Files:** `lib/auth.ts:76` (`assertDevAuthEnabled(): void` throws when `DEV_AUTH_BYPASS` is off); `app/api/dev-auth/route.ts:14` (only call site, wrapped in `try { assertDevAuthEnabled() } catch { return 404 }`). Rule of 2 says a helper needs 2+ real call sites now; this could be an inline `if (!isDevAuthBypass) return NextResponse.json(...)`. The catch also discards the thrown message ("Dev auth is disabled. Set `DEV_AUTH_BYPASS=true` for local testing only.") and returns a vaguer "Dev auth is disabled" — `clean-code.mdc` Error Handling: "Error messages say what went wrong AND what the expected state was."

### A-m14. Hardcoded "Back to home" links with no README exception
**Sources:** rules Minor 3. **Files:** `app/not-found.tsx:9`; `app/forbidden.tsx:12` — both render `<Link href="/">Back to home</Link>`. `clean-code.mdc` UI Consistency: "Back buttons go to where the user came from, not a hardcoded route. Define explicit exceptions (e.g., Settings always returns to Settings root) in the project README." No exception is declared in the README for these pages. (Arguably "go home" rather than "go back" affordances, but the rule covers back navigation generally and no exception is recorded.)

### Clean-code

### A-m15. `roleTones` constant duplicated verbatim
**Sources:** clean-code m1. **Files:** `app/(admin)/admin/staff/page.tsx:11`; `app/dev-login/dev-login-form.tsx:15`. Identical `const roleTones = { MANAGER: "brand", STAFF: "green", DRIVER: "amber" } as const;`. Belongs in `lib/permissions.ts` (next to `ROLE_DEFAULTS`) or a shared UI-tone map. Two call sites — exactly the Rule-of-2 threshold.

### A-m16. Client-side `response.json().catch(() => ({}))` + error-extract pattern repeated 7×
**Sources:** clean-code m2. **Files:** `app/(admin)/admin/staff/new/new-staff-form.tsx:30`; `app/setup/setup-form.tsx:25`; `app/invite/[token]/confirm-invite-button.tsx:16`; `app/(admin)/admin/staff/[id]/staff-editor.tsx:55, 90, 104`; `app/dev-login/dev-login-form.tsx`. Each does `fetch` → `await response.json().catch(() => ({}))` → `if (!response.ok) setError(body.error ?? "fallback")`. A small `apiFetch` helper returning `{ ok, body, error }` would dedupe the catch-fallback dance. Borderline under the "removing duplication adds more lines than it saves" carve-out, but the `body.error ?? "..."` fallback string is hand-rolled per call site and inconsistent.

### A-m17. `recordAudit` actor boilerplate repeated ~9×
**Sources:** clean-code m3. **Files:** `app/api/admin/staff/route.ts:55`; `app/api/admin/staff/[id]/route.ts:71-72, 81-82`; `app/api/admin/staff/[id]/impersonate/route.ts:27`; `app/api/admin/staff/[id]/revoke/route.ts:26`; `app/api/admin/impersonation/stop/route.ts:23`; `app/api/setup/route.ts:50`; `app/api/dev-auth/route.ts:39`; `app/api/invite/[token]/route.ts:21`. `actor: { id: X.id, email: X.email }` hand-constructed at every audit call. `recordAudit` could accept `ctx: AuthContext` (or an `actor: StaffUser` directly) and build the pair internally. Stable duplication, so Minor — but nine sites of the same shape.

### A-m18. `request.json().catch(() => null)` + `safeParse` + 400 block repeated 5×
**Sources:** clean-code m4. **Files:** `app/api/admin/staff/route.ts:32-36`; `app/api/admin/staff/[id]/route.ts:27-31`; `app/api/setup/route.ts:17-21`; `app/api/dev-auth/route.ts:19-23`; `app/api/client-error/route.ts:14-18`. A `parseBody(request, schema, fallbackMessage)` helper would collapse each to one line. Per-route error messages ("Name, valid email, and role are required", "Expected { version, role?, overrides? }", etc.) can be passed as the third arg.

### A-m19. `Role` / `Effect` string-literal unions redeclare Prisma enums (type/schema drift)
**Sources:** clean-code m5. **Files:** `app/(admin)/admin/staff/[id]/staff-editor.tsx:10-11` (`type Role = "MANAGER" | "STAFF" | "DRIVER"; type Effect = "GRANT" | "DENY";`); `app/dev-login/dev-login-form.tsx:8-13` (`role: "MANAGER" | "STAFF" | "DRIVER"` inside `StaffOption`). Hand-rolled unions duplicate `StaffRole` and `OverrideEffect` from `@prisma/client` (`prisma/schema.prisma:10-25`). If the schema enum ever gains a value, these types silently stay stale. Import `StaffRole`/`OverrideEffect` from `@prisma/client` instead.

### A-m20. `StaffOption` interface duplicates a `StaffUser` subset
**Sources:** clean-code m6. **File:** `app/dev-login/dev-login-form.tsx:8-13`. Bespoke `StaffOption` shape (`id`, `name`, `email`, `role`) mirrors the Prisma `StaffUser` projection the server already does with `select` (`app/dev-login/page.tsx:22`). Use `Pick<StaffUser, "id" | "name" | "email" | "role">` (or the Prisma-generated select type) so the client contract can't drift from the server projection.

### A-m21. Dead re-exports in `lib/auth.ts`
**Sources:** clean-code m7. **File:** `lib/auth.ts`. Line 11 `export { SESSION_COOKIE };` — every consumer imports `SESSION_COOKIE` from `@/lib/session-codec` (verified across `middleware.ts` and all five session-issuing routes); nobody imports it from `@/lib/auth`. Line 12 `export type { SessionPayload };` — likewise only re-used internally; no external import from `@/lib/auth`. Line 91 `export type { Prisma };` — `Prisma` is only ever imported from `@prisma/client` (in `lib/audit.ts:1` and `lib/auth.ts:5`); the re-export has no consumer. Remove or consolidate the import surface to one path (`@/lib/session-codec` for codec symbols, `@prisma/client` for `Prisma`).

### A-m22. `result` variable name (banned standalone)
**Sources:** clean-code m8. **File:** `app/api/admin/staff/[id]/route.ts:43, 95, 98`. `result` is the `$transaction` return binding. `result` is on the clean-code banned list ("No vague names: `data`, `result`, `info`, `temp`, `val`, `item`, `thing`"). Rename to `transactionOutcome` / `updateOutcome` — or, since the only meaningful branch is `conflict`, a tighter `const { conflict } = await prisma.$transaction(...)` would let the rest read off `conflict` directly.

### A-m23. `fresh` variable name is vague
**Sources:** clean-code m9. **File:** `app/api/admin/staff/[id]/route.ts:104` — `const fresh = await prisma.staffUser.findUnique(...)`. `fresh` isn't on the banned list but doesn't describe what it holds. `reloadedStaff` / `updatedStaff` reads as the re-read after the transaction.

### A-m24. `global-error.tsx` is visually inconsistent with the app
**Sources:** clean-code m11. **File:** `app/global-error.tsx:7` uses inline `style={{ padding: "4rem", fontFamily: "system-ui, sans-serif", textAlign: "center" }}` and an unstyled `<button>`, while every other screen uses Tailwind classes, the `Button` component, and the `brand` palette. The inline-style choice is defensible (Next.js `global-error` replaces the root layout, so `globals.css` may not be loaded), but the unstyled `<button>` and absence of `BRAND`/`Button` are not forced by that constraint — the component import path still works. Result: the most severe error screen looks least like the app (`clean-code.mdc` UI Consistency: "If a new screen looks different from the rest of the app, that's a bug").

---

## Notes / non-findings carried forward

- Live Clerk integration (A-M4) is an allowed P1 deviation per the spawn prompt and README § Auth; the swap seam at `lib/session-codec.ts` is isolated.
- Rate limiting on `/api/setup`, `/api/invite/[token]`, `/api/dev-auth` — no rate limiting anywhere, but P1 EXPECTED does not require it.
- `/api/admin/staff` POST allows creating a MANAGER directly — by design for P1 (managers manage staff).
- No CSP or security headers in `next.config.mjs` — P1 EXPECTED does not require transport hardening.
- Sidebar mobile menu, client-error rate limiting — already listed as known limitations in `.scratch/PHASE-P1-STATUS.md`; not rule violations.
- Phase 2+ features (orders, packages, delivery routes) — not in P1 scope; their absence is correct.
- Page vs API auth patterns differ (`requirePermission` throwing `forbidden()`/`redirect()` vs `requireApiPermission` returning an `ApiGate` discriminated union) — intentional (pages can't return `NextResponse`), not drift.
- `concurrency-smoke.mjs` / `migration-guard.mjs` / `db-start.mjs` are well-named, single-purpose scripts; no findings.
- `lib/env.ts` + `lib/env-spec.ts` split is a clean single-source-of-truth for env config; no drift.
- `lib/settings.ts` typed-key-value pattern is consistent and used by `setup/route.ts` only today, but is the right shape for future settings keys — not premature.

## Dropped / merged during dedupe

- security m4 + quality m2 → A-m4 (same claim, same file:line).
- quality m3 + rules Major 1 + rules Minor 1 + clean-code M2 → A-M5 (dead `lib/` modules + README drift; same locations, overlapping claims).
- clean-code m10 dropped as factually inverted — direct read of `app/error.tsx` and `app/global-error.tsx` confirms quality m4 is the correct claim. The visual-styling portion of clean-code m10's neighbor m11 survives as A-m24.





