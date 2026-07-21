# P1 Fix Notes — arm-03

Date: 2026-07-21  
Scope: one post-review fix pass (Critical A1–A5, High A6–A8)

## Fixed

| ID | Fix |
|---|---|
| **A1** | `AUTH_MODE` defaults to `clerk` (fail closed without Clerk keys). Dev bypass requires explicit `AUTH_MODE=dev`. `/api/setup` removed from public middleware matcher. |
| **A2** | Setup POST requires authenticated identity; claim lock via unique `AppSetting` create inside `$transaction` with manager insert (TOCTOU-safe); 409 on lock conflict. |
| **A3** | Impersonation start checks `canImpersonate` (strictly lower role + target perms ⊆ actor perms). Actor role recorded in audit meta. |
| **A4** | Start and stop both use `requireActorPermission("staff.impersonate")` on the real actor. Banner Stop calls audited `DELETE /api/impersonate`. Removed unaudited `?stopImpersonation=` page mutation. |
| **A5** | Removed invitation token generation and `STAFF_INVITED` audit path (dead redemption). Schema column left nullable for a future real invite flow. |
| **A6** | Added shared `apiErrorResponse` (`src/lib/api-error.ts` + `maskError`); adopted on setup/staff/impersonate/audit/gated/customer/health. |
| **A7** | Removed unused deps `class-variance-authority`, `lucide-react`, and orphaned `date-fns`. |
| **A8** | Deleted unused `money.ts`, `dates.ts`, `season.ts`, `ids.ts`; trimmed dead exports (`designTokens`, `formatPhone`, `normalizeWhitespace`/`normalizeKey`, `stopIfLocked`). |

## Deferred (Medium/Low/Nit — out of this pass)

A9–A44 from `AGGREGATE-REVIEW-P1.md` (token hashing if invites return, customer email-link takeover hardening, VersionedFixture schema move, OCC on revoke/override, audit list dedupe, cookie flags, etc.).

## Verification

- `npm run typecheck`: pass
- Bootstrap + `npm run smoke` S1–S5: **PASS** on :3103 / DB :4103
- `npm run test:concurrency`: 1 winner / 9 conflicts
- Evidence: `workspace/.scratch/PHASE-P1-SMOKE.md`
