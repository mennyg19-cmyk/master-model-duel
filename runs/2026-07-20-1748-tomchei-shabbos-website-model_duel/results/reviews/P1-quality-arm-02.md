# P1 Quality review — arm-02

Reviewer specialist: Quality
Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Tree: `arms/arm-02/workspace/`
Phase: P1 — Foundation, identity, roles, permissions, staff tooling
Source rubric: `kit/prompts/reviewer/review-quality.md` (focus: correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED)

## Summary

P1 lands in a clean, readable state. The scaffold, env validation, auth/session model, permission resolver, staff CRUD, overrides editor, impersonation, audit, and concurrency smoke are all present and internally consistent. `npm run ci` is green and the smoke log reproduces EXPECTED S1–S5 plus the revocation/override extras. The findings below are quality gaps — none block P1, but several should be fixed before later phases lean on this foundation.

**Finding count: 13**

---

## Findings

### Q1 — `SESSION_SECRET` is required but never used (dead config / misleading contract)
**Severity:** medium · **Kind:** correctness / stub
`lib/env.ts:7-9` requires `SESSION_SECRET` (min 16 chars) with the message *"used to sign session tokens"*, and `instrumentation.ts` imports `lib/env` so startup fails without it. But `lib/auth/session.ts` mints tokens from `randomBytes(32)`, stores only a SHA-256 hash in the DB, and never references the secret for signing or verification. The token is a random bearer secret looked up by hash — there is nothing to sign. The required env var and its documented purpose are both fictitious; a missing secret aborts startup for no functional reason. Either drop the variable, or actually HMAC the token with it (and verify on read).

### Q2 — Session cookie is not flagged `secure`
**Severity:** medium · **Kind:** correctness (security quality)
`lib/auth/session.ts:22-27` sets `httpOnly: true` and `sameSite: "lax"` but omits `secure: true`. In production over HTTPS the cookie is still marked transportable over plain HTTP, so a network-level downgrade or misconfigured proxy can leak the bearer token. Dev-mode localhost is unaffected, but this is the foundation session primitive — set `secure: process.env.NODE_ENV === "production"` (or `true` unconditionally behind HTTPS).

### Q3 — Manager impersonating a DRIVER is not redirected to `/driver`
**Severity:** medium · **Kind:** broken flow
`app/(admin)/admin/layout.tsx:19` redirects drivers out of admin only when `staff.actingAs.role === "DRIVER" && !staff.isImpersonating`. So a manager who starts impersonating a driver keeps landing on `/admin` with the driver's empty permission set — blank sidebar, dashboard card, and 403 on every gated sub-route. That defeats the stated purpose of impersonation (seeing exactly what the target sees). The condition should key off `actingAs.role` regardless of `isImpersonating`, so an impersonated driver is redirected to `/driver` just like a real driver.

### Q4 — `app/error.tsx` ships raw `error.message` to the server, contradicting the "redacted" comment
**Severity:** low · **Kind:** correctness / info-leak
`app/error.tsx:15-23` calls `/api/client-error` with `message: error.digest ?? error.message.slice(0, 500)`. The inline comment says *"Redacted report: message + path only, no stack or user data"*, but `error.message` is not redacted — it can carry user input, query strings, or internal identifiers up to 500 chars. The digest path is fine; the `error.message` fallback is the leak. Prefer sending only `error.digest` (and a stable code) and drop the message fallback, or whitelist a small set of known-safe message templates.

### Q5 — `writeAudit` runs outside the mutating transaction, so a transient DB error leaves an un-audited mutation
**Severity:** medium · **Kind:** correctness (audit integrity)
In `app/api/setup/route.ts:48-54`, `app/api/staff/route.ts:49-54`, `app/api/staff/[id]/route.ts:38-47`, and `app/api/staff/[id]/overrides/route.ts:41-46`, the audit row is written *after* the data mutation commits (and in setup, after `createSession` too). EXPECTED item 6 says "all mutations audited." If the audit insert throws, the staff/role/override change is already persisted with no audit trail. Wrap each mutation + its `writeAudit` in a single `db.$transaction` (the setup route already uses one — extend it to include the audit and session writes).

### Q6 — `PATCH /api/staff/[id]` mislabels the audit action when role and status change together
**Severity:** low · **Kind:** correctness (audit precision)
`app/api/staff/[id]/route.ts:38-39` picks the action as `parsed.data.role ? "staff.role_change" : "staff.status_change"`. When a manager sends both `role` and `status` in one PATCH, the action is recorded as `staff.role_change` only; the status transition is buried in `detail` and invisible to anyone filtering the audit log by action. Either emit two audit rows, or introduce a combined action label that reflects both fields.

### Q7 — Override PUT audit records only the new list, not the prior state
**Severity:** low · **Kind:** correctness (audit completeness)
`app/api/staff/[id]/overrides/route.ts:41-46` writes `detail: { email, overrides: parsed.data.overrides }` — the *new* set only. The previous overrides (read into `target` but not captured) are lost. EXPECTED item 6 says permission-override edits are audited; an auditor cannot reconstruct what changed without a from/to. Capture `before` and `after` in `detail` (the `target` is already fetched — include `target.permissionOverrides`).

### Q8 — Missing smoke: self-target block is never exercised
**Severity:** low · **Kind:** missing smoke
EXPECTED item 6 and the status doc claim "self-target blocks enforced server-side." `run-smoke.ps1` never attempts a self-revoke or self-role-change against the logged-in manager. The guards exist in `app/api/staff/[id]/route.ts:16-21` and `app/api/staff/[id]/overrides/route.ts:22-24` but are unverified. Add an assertion that PATCH/PUT against `gate.staff.realUser.id` returns 400.

### Q9 — Missing smoke: driver redirect out of `/admin` is never asserted
**Severity:** low · **Kind:** missing smoke
EXPECTED item 7 requires "drivers are redirected out of `/admin`." `run-smoke.ps1` never logs in as a DRIVER and asserts the redirect to `/driver`. The redirect in `admin/layout.tsx:19` is unverified by smoke (and is the same line that Q3 breaks for the impersonation case).

### Q10 — Missing smoke: impersonation banner render is never asserted
**Severity:** low · **Kind:** missing smoke
EXPECTED item 6 requires "impersonation with banner." The smoke starts and stops impersonation and checks the audit entries, but never asserts the banner in `app/(admin)/admin/layout.tsx:27-35` renders during impersonation. A regression that drops the banner would pass the current smoke. At minimum, fetch `/admin` while impersonating and grep for a banner marker.

### Q11 — `Session` table lacks indexes on `staffUserId` and `expiresAt`
**Severity:** low · **Kind:** schema quality / scaling debt
`prisma/schema.prisma:63-71` indexes only `tokenHash` (unique). Revocation does `deleteMany({ where: { staffUserId } })` (`app/api/staff/[id]/route.ts:35`) and any future expired-session cleanup will filter by `expiresAt` — both scan the table. P1 volumes are trivial, but this is the foundation schema; add `@@index([staffUserId])` and `@@index([expiresAt])` now so P12 hardening isn't a migration.

### Q12 — `PermissionOverride.permission` is a plain `String`, not an enum
**Severity:** low · **Kind:** schema quality / drift
`prisma/schema.prisma:42-50` stores `permission` as `String`. The API guards writes with a zod enum (`app/api/staff/[id]/overrides/route.ts:10`), but the DB has no constraint, so stale or renamed permission keys can persist silently. `resolvePermissions` swallows unknown keys (`lib/auth/permissions.ts:28`), so a renamed permission quietly degrades to "ignored" with no DB signal. Use a Postgres enum (or a check constraint) mirroring `PERMISSIONS`.

### Q13 — Role-change `<Select>` in `StaffManager` fires instantly with no confirmation
**Severity:** low · **Kind:** UX quality / destructive mutation
`components/staff-manager.tsx:143-152` binds the role `<Select>` `onChange` directly to `callApi("/api/staff/{id}", "PATCH", { role })`. A manager who accidentally opens the dropdown and clicks another option immediately mutates the role (audited, but not easily reversible from the UI — there's no undo and no confirm). Revoke has the same one-click fire pattern (`staff-manager.tsx:164-173`). For an audited identity mutation, require a confirm step or an explicit "Save" button.

---

## Notes (not counted as findings)

- `destroySession` uses `deleteMany` on the unique `tokenHash` (`lib/auth/session.ts:46`); `delete` would be the precise call. Cosmetic.
- `app/(admin)/admin/page.tsx:17` uses `staff?.actingAs.name` with optional chaining, but the layout has already redirected when `staff` is null, so the `?.` is dead. Cosmetic.
- `AuditLog.actorStaffId` has no index; querying by actor will scan. Same category as Q11, lower priority.
- The concurrency smoke (`scripts/concurrency-smoke.ts`) reads `fixture.version` once and fires 10 `updateMany` calls against that same version, proving `updateMany` reports conflicts — which is exactly what EXPECTED item 10 asks for. It does *not* exercise a retry loop, so it doesn't prove a working OCC pattern, only single-shot conflict reporting. Not a finding against EXPECTED, but worth noting before P2/P5 lean on the version primitive.
- `/api/client-error` is unauthenticated and unthrottled (`app/api/client-error/route.ts`); anyone can flood server logs with bounded messages. Acceptable for P1, flag for P11/P12.
