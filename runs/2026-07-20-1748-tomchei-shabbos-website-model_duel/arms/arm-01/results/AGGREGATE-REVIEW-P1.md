# Aggregate Review — P1 — arm-01

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01`
**Phase:** P1 (Foundation, identity, roles, permissions, staff tooling)
**Output:** `arms/arm-01/results/AGGREGATE-REVIEW-P1.md`

**Inputs aggregated:**
- `results/reviews/P1-security-arm-01.md` (13 findings: 2 CRIT, 2 HIGH, 5 MED, 4 LOW)
- `results/reviews/P1-quality-arm-01.md` (13 findings: Q1-Q13)
- `results/reviews/P1-rules-arm-01.md` (ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol)
- `results/reviews/P1-clean-code-arm-01.md` (F1-F9)

**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings introduced during aggregation. Severity mapping: CRIT/HIGH security + quality Critical = **blocker**; security MED + quality Major/Moderate + rules VIOLATION + clean-code P2 = **major**; security LOW + quality Minor + rules MINOR + clean-code P3 = **minor**.

---

## Counts

| Severity | Count |
|---|---|
| Blocker | 5 |
| Major | 12 |
| Minor | 13 |
| **Total** | **30** |

---

## Blockers (5)

### B1 — Bootstrap `/api/setup` trusts a spoofable `x-clerk-user-id` header (no Clerk verification)
**Sources:** SEC CRIT-1, Q1 (setup half), SEC LOW-3
**Locations:** `src/app/api/setup/route.ts:15-22`, `src/app/(admin)/setup/page.tsx:21-23`
**Claim:** `POST /api/setup` reads caller identity from the `x-clerk-user-id` header set by the page from a plain text input, with no `auth()` verification. First unauthenticated caller wins on an empty DB and becomes the first `MANAGER`, locking bootstrap to an attacker-chosen identity. The `bootstrapState` lock only prevents a *second* manager; it does not authenticate the *first*.

### B2 — `accept-invite` binds invitation to a client-asserted identity
**Sources:** SEC HIGH-1, Q1 (accept-invite half), SEC LOW-3
**Locations:** `src/app/api/staff/accept-invite/route.ts:7-39`
**Claim:** `POST /api/staff/accept-invite` takes `clerkUserId` from `x-clerk-user-id` with no proof the caller owns that Clerk identity, then permanently binds the invitation to it. Anyone holding a leaked/intercepted invite token redeems it under their own identity (persistent takeover) or displaces the intended staffer. Single-use token protection is defeated by trust-on-client-header.

### B3 — Local-dev identity fallback trusts any `x-test-clerk-user-id` header outside production
**Sources:** SEC CRIT-2
**Locations:** `src/lib/auth.ts:14-24`
**Claim:** `getAuthenticatedClerkUserId()` returns `headers().get("x-test-clerk-user-id")` whenever Clerk is unconfigured and `NODE_ENV !== "production"`, falling back to `__local_manager__`. The gate is `NODE_ENV`, not a test/CI flag — staging, preview, or any misconfigured non-production deployment is fully impersonable by anyone who guesses a `clerkUserId`. The local-dev bypass and the production spoof (B1/B2) share the same code path (`auth.ts:23`).

### B4 — Invite token returned in plaintext and never delivered / surfaced in UI
**Sources:** SEC HIGH-2, Q3
**Locations:** `src/app/api/admin/staff/route.ts:54,88-91`, `src/app/(admin)/admin/staff/staff-manager.tsx:37-44`
**Claim:** `POST /api/admin/staff` stores only the SHA-256 hash (good) but returns the raw 32-byte token in the JSON response with 7-day validity. No email delivery path in P1, no audit entry for token view, and the staff-manager UI discards `payload.inviteToken`. Anyone observing the response (client logs, devtools, proxy, future `audit:view` consumer) gets a live bearer credential; a manager using the UI has no way to retrieve/deliver the invite.

### B5 — Setup page is unreachable in a browser before the first Manager exists
**Sources:** Q2
**Locations:** `src/app/(admin)/setup/page.tsx`, `src/app/(admin)/admin/layout.tsx:9-24`
**Claim:** `/setup` lives inside the `(admin)` route group and is wrapped by `admin/layout.tsx`, which unconditionally calls `getCurrentStaffUser()` and renders the 403 panel when no staff session exists. On an empty DB there is no staff user, so `/setup` renders access-denied — the bootstrap form is never shown. The API path works (smoke proves `POST /api/setup` → 201 then 409) but the documented S4 flow cannot be exercised through the UI as built.

---

## Majors (12)

### M1 — Impersonation cookie not bound to actor; persists after permission revoke
**Sources:** SEC MED-1
**Locations:** `src/app/api/admin/impersonation/route.ts:26-53`, `src/lib/auth.ts:43-54`
**Claim:** `impersonate_staff_id` cookie is the bare target `StaffUser.id` with no signature/MAC binding it to the actor. `getCurrentStaffUser` honors it for any authenticated caller; `requirePermission` only re-checks `staff:impersonate` on the actor when a gated handler runs. Between cookie set and next `requirePermission`, effective identity is the impersonated user regardless of current actor permissions. No server-side expiry shorter than 1h, no rotation, no revocation. Stolen cookie = silent impersonation up to an hour.

### M2 — Impersonation session never closed; audit trail incomplete; no stop control in UI
**Sources:** SEC MED-2, Q5, RULES workflow VIOLATION, RULES workflow MINOR (stop UI)
**Locations:** `src/app/api/admin/impersonation/route.ts:63-70`, `src/app/(admin)/admin/staff/staff-manager.tsx`, `src/app/(admin)/admin/layout.tsx:30-35`
**Claim:** `DELETE /api/admin/impersonation` only clears the cookie — it does not `update({ endedAt })` on the open `ImpersonationSession` row and writes no `staff.impersonation_ended` audit entry. Start is audited; end is not, so a 1-hour impersonation is indistinguishable from a 1-second one. No "Stop impersonating" button exists in the UI; the banner only states the state. P1 §6 requires "impersonation with banner + audit trail"; the trail is half-written and the end-flow is missing.

### M3 — Manager self-protection guard bypassable; impersonation widens it
**Sources:** SEC MED-3, RULES workflow MINOR (self-edit overrides)
**Locations:** `src/app/api/admin/staff/route.ts:116-124`
**Claim:** Self-edit guard only fires when `staffId === actor.id` and only blocks `body.role` or `body.status === REVOKED`. A manager can still self-strip via `denyPermissions: ["admin:view","staff:manage","staff:impersonate","audit:view","settings:manage"]` or `grantPermissions: []` without triggering the guard. While impersonating, `actor.id` is the impersonator's, so a manager impersonating another manager can `PATCH { id: <impersonatedManagerId>, status: "REVOKED" }` and revoke them — the guard does not protect the *effective* identity.

### M4 — Permission arrays written verbatim with no validation against the Permission enum
**Sources:** SEC MED-4, Q11, RULES clean-code MINOR (permissions), F8
**Locations:** `src/app/api/admin/staff/route.ts:100-138`, `src/lib/permissions.ts:19-36`
**Claim:** `PATCH /api/admin/staff` accepts arbitrary `grantPermissions`/`denyPermissions` string arrays and writes them to the DB without validating against the `permissions` const. `hasPermission` only matches known strings (inert at check time) but junk pollutes audit metadata/staff record and confuses downstream UI that renders arrays verbatim. No dedup, no length cap; `denyPermissions` is checked before `grantPermissions` so a single `deny` silently overrides a role grant. Types are `string[]` instead of `Permission[]`, so a typo like `"staff:manag"` is not caught at compile time.

### M5 — `client-errors` endpoint unauthenticated, unthrottled, ignores `CLIENT_ERROR_TOKEN`
**Sources:** SEC MED-5, Q8
**Locations:** `src/app/api/client-errors/route.ts:1-26`, `src/lib/env.ts:5,21`
**Claim:** `CLIENT_ERROR_TOKEN` is declared in the env schema and advertised in `.env.example` but never read by the route. Any anonymous client can POST up to 2 KB per request; body is `console.error`'d with only `slice(0,200)`/`slice(0,80)` truncation. No auth, no token check, no rate limit, no log sanitization — enables log flooding and log injection (attacker-controlled `route`/`category` written verbatim to stderr). The declared token is dead config.

### M6 — Admin page gate returns 200 with a 403-styled body, not HTTP 403
**Sources:** Q4
**Locations:** `src/app/(admin)/admin/layout.tsx:10-24`
**Claim:** The layout returns JSX (HTTP 200) for unauthorized staff. EXPECTED S3 says "Staff without permission → 403 on protected admin route." API routes correctly return 403 via `requirePermission` → `AccessDeniedError`, and all smoke 403 evidence is from `/api/admin/*`. The page route never emits an actual 403; any tooling relying on the HTTP status (logs, monitoring, rewrites) will not see one.

### M7 — Concurrency smoke and live smoke are not wired into CI
**Sources:** Q6
**Locations:** `package.json`, `.github/workflows/ci.yml`, `.scratch/live-smoke.mjs`, `scripts/concurrency-smoke.ts`
**Claim:** `smoke:concurrency` and `live-smoke.mjs` exist but `npm run ci` = `lint && typecheck && test && db:guard` — neither smoke is included. The CI workflow runs `db:deploy` then `npm run ci`. EXPECTED #10 (concurrency smoke) and #9 (baseline seed) are verified only manually in the status doc, not enforced. The concurrency smoke script requires a live DB and is not run in the CI job that already provisions Postgres.

### M8 — Baseline seed is not run in CI
**Sources:** Q7
**Locations:** `package.json`, `.github/workflows/ci.yml`, `prisma/seed.ts`
**Claim:** `ci` does not invoke `db:seed`. The CI workflow runs `db:deploy` but never seeds. EXPECTED #9 explicitly lists "baseline seed runs." The seed script exists and is gated behind `SEED_DEMO_STAFF` but is never executed in the pipeline, so schema/seed drift would not be caught.

### M9 — Over-broad Prisma catch in `/api/setup` misreports conflicts as "Setup is locked"
**Sources:** RULES clean-code VIOLATION
**Locations:** `src/app/api/setup/route.ts:78-86`
**Claim:** The handler treats any `Prisma.PrismaClientKnownRequestError` as "Setup is locked." A unique-constraint violation on `StaffUser.clerkUserId` or `StaffUser.email` (e.g. a duplicate bootstrap attempt racing the lock) would be misreported as "Setup is locked" and return 409 instead of surfacing the real conflict. Narrow to `error.code === "P2002"` or rely on the `BOOTSTRAP_LOCKED` sentinel alone.

### M10 — `AccessDeniedError → 403` handler duplicated across three routes
**Sources:** F1
**Locations:** `src/app/api/admin/staff/route.ts:9-14`, `src/app/api/admin/impersonation/route.ts:55-60`, `src/app/api/admin/overview/route.ts:21-26`
**Claim:** A local `permissionError` helper exists in `staff/route.ts` but the identical logic is inlined in two other routes. Three call sites, one local helper, no shared export. Per Rule of 2, lift `permissionError` (or a `withPermission(handler)` wrapper) into `src/lib/auth.ts` and import everywhere.

### M11 — Duplicated `StaffUser` select projection with `orderBy` drift
**Sources:** F2
**Locations:** `src/app/api/admin/staff/route.ts:21-30`, `src/app/(admin)/admin/staff/page.tsx:11-20`
**Claim:** The exact same `select` block appears in the API route and the server page, and the two disagree on `orderBy` (`displayName` vs `createdAt`) — a quiet pattern drift. Extract a shared `staffUserSelect` constant (e.g. `src/lib/staff-projection.ts`) and pick one canonical ordering.

### M12 — Audit-log writes repeated inline with magic action strings
**Sources:** F4
**Locations:** `staff/route.ts` POST (line 76), `staff/route.ts` PATCH (lines 146-148), `impersonation/route.ts` POST (line 36), `accept-invite/route.ts` POST (line 47), `setup/route.ts` POST (line 65)
**Claim:** Every mutating route hand-rolls an `auditLog.create` inside its transaction with a near-identical `{ actorStaffId, action, targetType: "StaffUser", targetId, ... }` skeleton, and each `action` is a bare string literal. Five call sites. A typo in an action string is invisible to the type checker, and adding a new audit field means editing five places. Add a `writeAuditLog(tx, { action, targetId, ... })` helper in `src/lib/audit.ts` and a `const AuditAction = { ... } as const` (or union type).

---

## Minors (13)

### m1 — Health endpoint discloses auth mode to unauthenticated callers
**Sources:** SEC LOW-1
**Locations:** `src/app/api/health/route.ts:9-14`
**Claim:** `GET /api/health` returns `auth: "local-development" | "clerk"` to any caller. Combined with B3, an unauthenticated probe learns whether the instance is in the spoofable local-dev mode, enabling targeted header injection.

### m2 — No rate limiting on identity-adjacent endpoints
**Sources:** SEC LOW-2
**Locations:** `src/app/api/setup/route.ts`, `src/app/api/staff/accept-invite/route.ts`, `src/app/api/admin/impersonation/route.ts`, `src/app/api/admin/staff/route.ts`
**Claim:** No throttling on bootstrap, invite redemption, impersonation start, or staff invite creation. Invite-token brute force is infeasible (32 random bytes), but `accept-invite` token enumeration, bootstrap racing (pre-B1 fix), and impersonation spam have no backoff. P1 §6/§7 do not require rate limiting, but it is the natural mitigation for several findings here.

### m3 — CSRF posture relies solely on cookie `sameSite=lax`
**Sources:** SEC LOW-4
**Locations:** `src/app/api/admin/staff/route.ts`, `src/app/api/admin/impersonation/route.ts`, `src/app/api/staff/accept-invite/route.ts`
**Claim:** State-changing handlers are plain `fetch` JSON routes (not Server Actions), so they do not receive Next.js's Server-Action CSRF protection. They rely entirely on Clerk's session cookie being `sameSite=lax` to block cross-site writes. Currently effective for cross-origin POST, but implicit and fragile — any future change to the auth cookie's `sameSite` (or a same-site XSS) reopens every state-changing endpoint at once. No explicit CSRF token or `Origin`/`Sec-Fetch-Site` check exists.

### m4 — `SessionStamp` model is dead schema
**Sources:** Q9
**Locations:** `prisma/schema.prisma:99-108`
**Claim:** `SessionStamp` is defined with a `StaffUser` relation and indexes, but no code in `src/` ever writes to or reads from it. It is migrated into the DB and then unused. EXPECTED #1 lists the scaffold; this table is carried as dead weight. Wire it up or defer to a later phase.

### m5 — Unused `lib/` helpers shipped with zero call sites (premature abstractions)
**Sources:** Q10, RULES ponytail VIOLATION, F3
**Locations:** `src/lib/dates.ts` (`formatOrganizationDate`), `src/lib/money.ts` (`formatCents`), `src/lib/season.ts` (`getSeasonYear`, `formatSeasonName`), `src/lib/safe-result.ts` (`SafeResult`, `maskUnexpectedError`), `src/lib/normalize.ts` (`normalizePhone`)
**Claim:** These modules are defined but imported nowhere in `src/`, `prisma/`, `scripts/`, or `tests/`. Violates the arm's own Rule of 2 ("Needs 2+ real call sites right now. Not 'might be useful later.'") and "No premature abstractions." `safe-result.ts` in particular is a 2-export grab-bag with no consumer. Delete for P1 and re-introduce when a real call site arrives, or co-locate next to the first consumer.

### m6 — Role/permission changes fire a PATCH on every change with no conflict UX
**Sources:** Q12
**Locations:** `src/app/(admin)/admin/staff/staff-manager.tsx:131,140,152,172`
**Claim:** `updateStaff` is called on every `onChange`. Rapid toggles race on the `version` field; a 409 just sets a message ("This staff record changed. Reload before saving again.") with no reload action offered. A misclick on the role `<select>` immediately demotes/promotes with no confirmation. Correct for a single edit, fragile under fast interaction.

### m7 — `next.config.ts` throws at module load when `DATABASE_URL` is missing
**Sources:** Q13
**Locations:** `next.config.ts:3-7`
**Claim:** The config throws if `DATABASE_URL` is unset. Intentional fail-fast and the status doc confirms a "missing env" smoke passes, but it also means `next lint`/`next build` for static analysis and any tool that imports the config without a `.env` crashes with a non-actionable error rather than a structured message. `readServerEnvironment()` in `src/lib/env.ts` already does this properly; the config duplicates it.

### m8 — `ponytail` ladder tags absent on stdlib-over-dep choices
**Sources:** RULES ponytail MINOR
**Locations:** `src/lib/ids.ts:3`, `src/lib/money.ts`, `src/lib/dates.ts`
**Claim:** No `ponytail:` comment anywhere in the tree. `ids.ts` uses `node:crypto.randomBytes` (stdlib) instead of a `uuid`/`nanoid` dep, and `money.ts`/`dates.ts` use `Intl` instead of a date/currency library — both are deliberate stdlib-over-dep choices the rule asks to tag. Tag them so the next reader knows the shortcut was chosen, not lazy.

### m9 — Client `StaffUser` type hand-declared, drifts from Prisma schema
**Sources:** RULES clean-code MINOR (client type drift)
**Locations:** `src/app/(admin)/admin/staff/staff-manager.tsx:8-17`
**Claim:** The client component hand-declares a `StaffUser` type with the same shape Prisma already generates. It imports `StaffRole`/`StaffStatus` enums (good), but the record shape is duplicated. A `type StaffUser = Pick<...>` from a shared module (or `Prisma.StaffUserGetPayload`) would keep the client in sync with schema changes. Acceptable that the full Prisma client isn't bundled to the client; the shape still shouldn't be retyped by hand.

### m10 — Role `<option>` lists duplicated and inconsistent
**Sources:** F5
**Locations:** `src/app/(admin)/admin/staff/staff-manager.tsx:107-110,134-137`
**Claim:** The `StaffRole` enum is rendered as hardcoded `<option>` lists twice, in different orders (`STAFF,DRIVER,MANAGER` vs `MANAGER,STAFF,DRIVER`). `permissions.ts` already owns the canonical `rolePermissions` Record keyed by `StaffRole`; derive the option list from that single source (or `Object.values(StaffRole)`) instead of re-listing by hand.

### m11 — Grant/deny checkbox fieldsets duplicated
**Sources:** F6
**Locations:** `src/app/(admin)/admin/staff/staff-manager.tsx:146-164,165-183`
**Claim:** Two near-identical `<fieldset>` blocks over `permissions`, differing only in `grantPermissions`/`denyPermissions` and the legend text. Extract a `PermissionChecklist({ legend, selected, onChange })` component — exactly two real call sites, satisfies Rule of 2.

### m12 — `global-error.tsx` hardcodes hex colors instead of CSS tokens (undocumented exception)
**Sources:** F7, RULES clean-code MINOR (global-error)
**Locations:** `src/app/global-error.tsx:12-25`
**Claim:** `#f7f3f7`, `#8f2f67`, `#241f2d`, `#6f6878` are the literal values of `--surface`, `--brand`, `--ink`, `--muted` from `globals.css`. Every other surface uses `var(--…)`. `global-error.tsx` runs outside the root layout so `globals.css` may not load — a legitimate exception, but the duplicated raw hex values are an undocumented drift trap, and the clean-code "define explicit exceptions in the project README" clause wants it noted. Inline a `<style>` with the same `:root` tokens, or add a comment and keep them in sync with `globals.css`.

### m13 — `getCurrentStaffUser` return shape is implicit and inconsistent
**Sources:** F9
**Locations:** `src/lib/auth.ts:26-55`
**Claim:** The function returns `null | { actor: StaffUser; effective: StaffUser }` but the type is inferred and the "session" concept (`staffSession` is the local name in every consumer) is never named. Define an explicit `StaffSession` type and annotate the return, so consumers don't drift on `{ actor, effective }` field names.

---

## Non-findings (looked at, no action)

- **codegraph** — index present (`.codegraph/`); process adherence not verifiable from the build artifact. No finding.
- **grill-protocol** — not observable in a foundation phase with a frozen plan; no grill transcript to grade. No finding.
- **vocabulary** — term accuracy and pattern match pass clean. No finding.
- No god files (largest source file 189 lines). No barrel files, no <5-line wrapper components. Exact version pinning, fail-fast env validation, cookie hardening, optimistic-concurrency on staff updates, and audit coverage for the *start* of every security mutation all pass.

---

## Top 5 for fix pass

Ordered by security impact, then smallest blast radius.

1. **B1 + B2 + B3 — Spoofable `x-clerk-user-id` / `x-test-clerk-user-id` identity header across setup, accept-invite, and the local-dev fallback.** One root cause: client-supplied headers are trusted as the authenticated identity without `auth()` verification, and the dev bypass shares the production code path. Fix together: add real Clerk `auth()` verification in `/api/setup` and `/api/staff/accept-invite`, gate the local-dev header behind a real test/CI flag (not `NODE_ENV`), and extract a shared `assertClerkIdentity()` helper so the pattern cannot be copied again. Closes the pre-auth takeover (CRIT/HIGH) and the LOW-3 recurring-pattern note.

2. **B4 — Invite token plaintext exposure + never surfaced in UI.** Stop returning the raw token in the API response; deliver it through a one-time, authenticated channel (signed URL / email) or surface it once in the staff-manager UI right after creation with an audit entry. The token is already hashed at rest — only the transport and UI are broken.

3. **B5 — Setup page unreachable in browser before the first Manager.** Move `/setup` out of the `(admin)` route group (or make `admin/layout.tsx` skip the staff-session gate when `bootstrapState` is empty) so the bootstrap form actually renders on an empty DB. Restores the documented S4 flow.

4. **M2 — Impersonation end-flow: close the session, audit the end, add a stop button.** `DELETE /api/admin/impersonation` must `update({ endedAt })` on the open `ImpersonationSession`, write a `staff.impersonation_ended` audit row, and the staff-manager UI / admin banner must expose a "Stop impersonating" control. Closes the half-written audit trail (SEC MED-2, Q5, workflow VIOLATION) in one pass.

5. **M9 + M3 — Over-broad Prisma catch in `/api/setup` + bypassable self-protection guard.** Narrow the catch to `P2002` (or rely on `BOOTSTRAP_LOCKED`) so a real conflict is not misreported as "Setup is locked"; extend the self-edit guard to block self-PATCH of own `grantPermissions`/`denyPermissions` and to compare against the *effective* identity while impersonating. Two cheap, localized fixes that close a correctness bug and a privilege-escalation path.

---

## Dedupe map (which sources folded into which aggregate finding)

| Aggregate | Folded sources |
|---|---|
| B1 | SEC CRIT-1, Q1 (setup), SEC LOW-3 |
| B2 | SEC HIGH-1, Q1 (accept-invite), SEC LOW-3 |
| B3 | SEC CRIT-2 |
| B4 | SEC HIGH-2, Q3 |
| B5 | Q2 |
| M1 | SEC MED-1 |
| M2 | SEC MED-2, Q5, RULES workflow VIOLATION, RULES workflow MINOR (stop UI) |
| M3 | SEC MED-3, RULES workflow MINOR (self-edit overrides) |
| M4 | SEC MED-4, Q11, RULES clean-code MINOR (permissions), F8 |
| M5 | SEC MED-5, Q8 |
| M6 | Q4 |
| M7 | Q6 |
| M8 | Q7 |
| M9 | RULES clean-code VIOLATION |
| M10 | F1 |
| M11 | F2 |
| M12 | F4 |
| m1 | SEC LOW-1 |
| m2 | SEC LOW-2 |
| m3 | SEC LOW-4 |
| m4 | Q9 |
| m5 | Q10, RULES ponytail VIOLATION, F3 |
| m6 | Q12 |
| m7 | Q13 |
| m8 | RULES ponytail MINOR |
| m9 | RULES clean-code MINOR (client type drift) |
| m10 | F5 |
| m11 | F6 |
| m12 | F7, RULES clean-code MINOR (global-error) |
| m13 | F9 |

No new findings were introduced during aggregation. Security blockers (CRIT/HIGH) survive as B1-B4.
