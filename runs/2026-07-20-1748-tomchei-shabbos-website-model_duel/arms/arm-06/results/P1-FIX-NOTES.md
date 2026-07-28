# P1 Fix Notes — arm-06

Pass: single fix pass on `AGGREGATE-REVIEW-P1.md`. All 7 Majors fixed; 23/24 Minors fixed; 1 Minor deferred (justified). Smoke S1–S6 re-run green on 3106/4106 (`workspace/.scratch/PHASE-P1-SMOKE.md`).

## Majors — all fixed

| # | Fix |
|---|---|
| **A-M1** Impersonated actions mis-attributed | `recordAudit` now takes `ctx` directly; actor = impersonator when impersonating, and `impersonatedAs: {id, email}` is stamped into metadata (also inside the PATCH transaction rows). Smoke S6d: impersonated role change is audited under the impersonator's email with `impersonatedAs` present. |
| **A-M2** Cross-privilege impersonation unbounded | `canImpersonate(actorRole, targetRole)` in `lib/permissions.ts` — target role rank ≤ actor rank, role-based so a granted `staff.impersonate` override can never escalate. Enforced in the impersonate route (403) and reflected in the UI button. Unit matrix added; smoke S6c proves the 403 over HTTP. |
| **A-M3** Sessions never expire / not revoked server-side | `AuthSession` gained `expiresAt` (12h) + `revokedAt` (migration `session_expiry_revocation`). Cookie payload carries `authSessionId`; `getAuthContext` validates the row every request. Revoke-staff revokes all rows; `DELETE /api/dev-auth` revokes server-side. Smoke: revoked user → 307; logged-out user → 307. |
| **A-M4** Clerk not integrated | Hardened the deviation: README states explicitly **Clerk is NOT installed** (no `@clerk/*`, no Clerk middleware), why, and the exact swap seam (`lib/session-codec.ts` → Clerk middleware mapping onto `AuthContext`). No code pretends otherwise. |
| **A-M5** Dead `lib/` modules + README drift | Deleted `lib/dates.ts`, `lib/money.ts`, `lib/ids.ts`, `lib/phone.ts`, `lib/result.ts` (zero importers, verified). README patterns table now documents the *actual* patterns (`apiFetch`, `parseBody`, session helpers, `ApiGate`); a line notes helpers land with the phase that first uses them. |
| **A-M6** Codegraph index | `codegraph init` succeeded — 58 files / 420 nodes / 362 edges (`.codegraph/codegraph.db`). Evidence: `workspace/.scratch/CODEGRAPH-STATUS.md`. |
| **A-M7** Cookie issuance duplicated 5× | `issueSessionResponse` / `clearSessionResponse` in `lib/auth.ts` — single cookie path for setup, dev-auth, invite, impersonate, stop (+ clearing on logout). `createLoginSession` centralizes session-row creation. |

## Minors — 23 fixed

- **m1** constant-time signature compare (`safeEqual` in codec)
- **m2** invite expiry: 7-day TTL enforced on page + API (410)
- **m3** `/api/client-error` rate-capped (30/min per process → 429)
- **m4** `devAuthBypass` dropped from `/api/health` (smoke asserts absence)
- **m5** `AUTH_SECRET` min 32 chars; dev `.env` rotated to 48-char random hex
- **m6** `x-forwarded-for` sanitized: first hop only, capped 45 chars
- **m8** `requireStaff` redirects to `/dev-login` only when dev-auth is on, else `/`
- **m9** `global-error.tsx` now reports to `/api/client-error`
- **m10** smoke gaps closed: S6a grant-override HTTP, S6b deny-beats-manager HTTP, `permission_override` + impersonated-write attribution asserted in audit
- **m11** unused `settings.manage` permission removed (surface + tests)
- **m12** `createLoginSession` shared by setup/dev-auth/invite — IP/UA/expiry captured consistently
- **m13** `assertDevAuthEnabled` deleted; inline 404 keeps the full message
- **m14** README declares the `/` back-link exception for 404/403 screens
- **m15** `ROLE_TONES` shared from `components/ui/badge.tsx` (2 call sites)
- **m16** `apiFetch` helper; 7 client fetch sites deduped
- **m17** killed with A-M1 (`recordAudit({ ctx })` at every call site)
- **m18** `parseBody(request, schema, message)`; 5 routes collapsed
- **m19** `StaffRole` / `OverrideEffect` imported from `@prisma/client` (no literal redeclarations)
- **m20** `StaffOption` = `Pick<StaffUser, …>`; staff editor props typed as the server's serialized `Pick`
- **m21** dead re-exports removed from `lib/auth.ts`
- **m22** `result` → destructured `{ conflict }`
- **m23** `fresh` → `reloadedStaff`
- **m24** `global-error.tsx` brand-styled (inline styles kept deliberately: root layout, hence `globals.css`, is replaced there — comment in file)

## Deferred — 1

- **m7 (CSRF single layer):** deferred per the review's own guidance ("acceptable for P1; tighten before the app handles money"). `sameSite: "lax"` remains the only mitigation; will add a custom-header/origin check with the first money-touching phase.

## Verification

- `npm run ci` green: lint, typecheck, migration-guard, permission unit tests (incl. new `canImpersonate` matrix).
- `npm run build` clean; prod server restarted on 3106.
- Smoke S1–S6 + concurrency + revocation + logout-revocation all PASS — `workspace/.scratch/PHASE-P1-SMOKE.md`, transcript `.scratch/smoke/transcript.log`.
