# P1 fix pass — arm-04

**Input:** `results/AGGREGATE-REVIEW-P1.md` (0 blockers, 7 majors, 23 minors)
**Scope:** one pass over `workspace/`. No new features, no P2.
**Outcome:** 7/7 majors fixed, 17 minors fixed (8–24 and 27), 5 deferred (25, 26, 28, 29, 30).
**Gates after the pass:** `npm run ci` green · 24/24 tests · 28/28 smoke checks · `next build` clean.

## Fixed — majors

| # | Fix | Where |
|---|---|---|
| 1 | `AUTH_SESSION_SECRET` is now rejected when it is the shipped placeholder, matches a known weak pattern (`change-me`, `placeholder`, `example`, `insecure`, all-zero), or carries fewer than 12 distinct characters. `.env.example` keeps a placeholder **on purpose** and CI generates a real secret with `openssl rand -base64 48`. | `src/lib/env-spec.ts`, `.github/workflows/ci.yml` |
| 2 | The local provider's trust boundary is no longer `NODE_ENV`. Env validation refuses `AUTH_PROVIDER=local` unless `APP_URL` is a loopback address, and `startLocalSession` independently refuses to issue a cookie in a production runtime **or** off loopback. A staging deploy now fails to boot instead of accepting any active staff email. | `src/lib/env-spec.ts`, `src/lib/auth/local-session.ts` |
| 3 | **No code change — the finding is a naming miss, verified at runtime.** Next 16 renamed the middleware convention to `proxy.ts`; `src/proxy.ts` wires `clerkMiddleware` under `AUTH_PROVIDER=clerk` and a cookie gate otherwise. Proof: `next build` lists `ƒ Proxy (Middleware)`, and an anonymous `GET /admin` answers `307 → /sign-in?next=%2Fadmin` before any page code runs. Adding a `middleware.ts` alongside it would be a file Next 16 no longer reads. | `src/proxy.ts` (unchanged) |
| 4 | `changeRoleAction`, `setStatusAction` and `setOverrideAction` now consume the `Result` and redirect with the failure code; both staff pages render the notice. A manager who loses a concurrent edit is told so instead of seeing the winner's state. | `src/app/(admin)/admin/staff/actions.ts`, `page.tsx`, `[staffUserId]/page.tsx`, `action-errors.ts` |
| 5 | `setCustomerPhone` — the one server-side mutation that threw instead of returning `Result` — is deleted rather than converted, because it has no call site (see 6). Every remaining server-side mutation returns `Result`, so the project has one error-handling pattern again. | `src/lib/customers.ts` |
| 6 | Deleted with zero P1 call sites: `maskError`, `normalizeName`, `normalizeAddressLine`, `addHours`, `formatDate`, `newId`, `newToken` (whole `core/ids.ts`), `setCustomerPhone`, and the now-unused `requireStaff`. **`linkCustomerIdentity` is deliberately kept:** EXPECTED item 4 requires customer identity linking to work in P1 and it carries test coverage, so deleting it would trade a YAGNI finding for a missing deliverable. | `src/lib/core/*`, `src/lib/customers.ts`, `src/lib/auth/staff.ts` |
| 7 | One `reportClientError(error)` helper; both error boundaries call it, and the "a failed report must not replace the crash screen" reasoning lives in one place instead of drifting between two copies. | `src/lib/report-client-error.ts`, `src/app/error.tsx`, `src/app/global-error.tsx` |

## Fixed — minors

| # | Fix |
|---|---|
| 8 | Server actions validate `role`, `status` and `effect` against real allow-lists instead of casting with `as`; an unknown value returns a user-facing failure rather than a Prisma 500. |
| 9 | `version` must parse as a positive integer; `NaN` no longer relies on Prisma matching zero rows. |
| 10 | `POST /api/client-error` is capped at 60 reports a minute and answers 429 past that. The cap is global on purpose: a per-caller key would be keyed on a header the caller writes. |
| 11 | `/api/health` returns a static "The database is unreachable." and logs the driver error server-side, so a Postgres error can no longer echo the connection string. |
| 12 | `linkCustomerIdentity` catches the unique-constraint loser of a concurrent first link and reads the winning row. New test: "two simultaneous first links settle on one customer". |
| 13 | `signInLocally` re-checks the account is still ACTIVE immediately before opening the session, so a revoke mid-sign-in is reported instead of handing out a dead cookie. |
| 14 | The external id is computed once and reused, so the update-then-read-stale-value path is gone along with the misleading `??` fallback. |
| 15 | The admin layout calls `requirePermission('dashboard.view')`. A driver now gets the bare 403 page — smoke P1-5 asserts the admin chrome is absent. |
| 16 | `safeDestination` accepts only `/admin` and `/driver` (and their subpaths); `?next=/api/health` falls back to `/admin`. |
| 17 | `setStaffStatus` preserves the original `confirmedAt` on reactivation, so the field keeps meaning "first confirmation". |
| 18 | `x-forwarded-for` is read only when the new `TRUST_PROXY_HEADERS` says a trusted proxy is in front. Otherwise audit rows and login sessions store no IP rather than a forgeable one. |
| 19 | Smoke P1-1 and P1-4 read state back out of the app (role badge, permission badge) instead of hardcoding `true`. Added P1-10 (stale write surfaced), P1-11 (out-of-enum role refused), P1-12 (placeholder secret refused), P1-13 (local auth refused off loopback). 24 → 28 checks. |
| 20 | CI runs `db:deploy && seed`, so a broken `prisma/seed.ts` fails the build. |
| 21–24 | Naming: `result` → `updated`/`invited`/`changed`/`bootstrapped`; `item` → `navItem`; `ROLES` derives from `Object.values(StaffRole)`; dropped the redundant annotation after `isPermission`. |
| 27 | `startCluster` reuses `ensureDatabase`, which narrows on Postgres `42P04`, replacing the empty catch that hid auth and disk failures. |

## Deferred

| # | Item | Why |
|---|---|---|
| 25 | Hardcoded "Back to staff" link | Needs a project-wide back-navigation convention (and a README exception) rather than a one-file patch. |
| 26 | `unauthorized.tsx` / `forbidden.tsx` twins | The review itself calls this the Rule-of-2 edge. A third status page in P2 is the trigger to extract `StatusNotice`. |
| 28 | `changeStaffRole` / `setStaffStatus` share a shape | Flagged as stable today. They now differ more, not less (status reads the previous row). Extract when P2 adds a third staff mutation. |
| 29 | Split `scripts/smoke.ts` | It grew this pass. Splitting it now would churn the file that proves every other fix; better done when P2 needs to reuse the helpers. |
| 30 | `codegraph init` | The tooling reports the index as the user's decision and instructs agents not to initialise it. |

## Verification

Run against the embedded cluster on 4104 and the dev server on 3104.

- `npm run ci` → lint clean, `tsc --noEmit` clean, "Migration guard: schema and migrations agree", **24/24 tests pass** (up from 19: 5 new env-validation tests, 1 new identity-race test, 1 removed with `maskError`).
- `npm run build` → clean, and the route table lists `ƒ Proxy (Middleware)`.
- `npm run seed` → idempotent on a populated database.
- `npm run db:fresh && npm run smoke` → **28/28 checks pass**, written to `workspace/.scratch/PHASE-P1-SMOKE.md`.

Checks that exist only because of this pass:

```
PASS  P1-10  A lost concurrent edit is reported instead of silently discarded
        replayed role form -> 303 /admin/staff?error=stale_version, notice rendered on the staff page
PASS  P1-11  An out-of-enum role is refused before it reaches the database
        role=SUPERUSER -> 303 /admin/staff?error=invalid_submission
PASS  P1-12  The .env.example session secret cannot boot the app
        AUTH_SESSION_SECRET: AUTH_SESSION_SECRET is a known placeholder or has too little variety to be a real key
PASS  P1-13  Passwordless local auth is refused on a non-loopback deployment
        AUTH_PROVIDER=local is only allowed when APP_URL is a loopback address, but APP_URL is https://staging.tomchei.example
```

## One thing the fix changed about the design

Enforcing "local auth cannot run in production" at **startup** broke `next build`,
which sets `NODE_ENV=production` even for a loopback deployment. Keeping it there
would have made the app impossible to build under the provider CI uses. The gate
therefore splits: env validation enforces the deployment shape (`APP_URL` must be
loopback), and the runtime guard in `startLocalSession` enforces the production
refusal at the moment a cookie would be issued. Both cover the staging case the
review raised, and the build stays honest.
