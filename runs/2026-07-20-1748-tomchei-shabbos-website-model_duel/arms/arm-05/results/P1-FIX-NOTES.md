# P1 fix pass

## Fixed

- B1: Kept the Next.js 16 `proxy.ts` convention; `next build` now reports `ƒ Proxy (Middleware)`. The reviewer’s `middleware.ts` filename claim does not apply to this Next.js version.
- B2–B5: Staff, audit, and admin-security routes now bind actions to the signed-in Clerk user, require the relevant staff permission, reject cross-origin mutations, and block self-access changes.
- B6–B8: Replaced process-memory state with a Prisma/PostgreSQL repository, added the generated client, a baseline migration, persisted setup lock, and a seed setting. Bootstrap derives its email and ID from the signed-in Clerk user.
- B7: Health executes `SELECT 1` and returns 503 when PostgreSQL is unavailable.
- B9: Proxy matching covers all application and API paths; route handlers also enforce authorization.
- M1, M3, M4, M7, M13, M14: Removed the Clerk allow-all fallback, added origin checks, enforced the error-reporting token, persisted setup state, added a seed, and blocked self-targeted staff actions.

## Deferred

- Real S3–S5 flow needs configured Clerk credentials and a PostgreSQL database on port 4105; neither is available in this host.
- Permission-override editor, impersonation banner/stop flow, permission-gated server-rendered admin navigation, customer identity API, and migration drift harness remain P1 work.

## Verification

- `npm run typecheck`, `npm test` (3 passed, Prisma concurrency test skipped without `DATABASE_URL`), `npm run lint`, `npm run migration:guard`, `npm run migration:harness`, and `npm run build` passed.
- Full local smoke now passes with real PostgreSQL and signed development sessions: S1=200, S2=200, S3=403, S4=201→409, and S5 role-change plus impersonation audit evidence.

## Embedded PostgreSQL and local auth follow-up

- Added `embedded-postgres` 17.10, with `db:start`, `db:stop`, `db:migrate`, and `db:seed` scripts. It owns a persistent workspace-only cluster and uses `postgresql://postgres:postgres@127.0.0.1:4105/tomchei_shabbos`.
- Added a development-only HMAC session provider. `DEV_AUTH_MODE=true` and a local `DEV_AUTH_SECRET` enable short-lived `x-dev-session` values only under `next dev`; authorization still loads the signed user ID from the database and applies the same permission gates as Clerk.
- Added `smoke:p1`, which migrates, seeds, starts the app, then checks S1=200, S2=200, S3=403, S4=201→409, and S5 audit events.
- The stale port listener was cleared. The successful suite applied the foundation migration and seed, then verified all S1–S5 checks against PostgreSQL on port 4105. No P2 work was started.
