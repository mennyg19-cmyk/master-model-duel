# Tomchei Shabbos — P2 domain core

P1 provides the Next.js/TypeScript shell, PostgreSQL Prisma repository and migration, Clerk-gated staff APIs, first-manager setup, staff roles, permission overrides, optimistic updates, and security audit events.

P2 adds the season/catalog, customer/address, order/payment, package/shipping, inventory, geocode, cron, and hidden BOM schemas. The domain helpers group packages by recipient/address/method/greeting, enforce draft-only finalization/discard, serialize per-season order numbers, and atomically reserve finished-package inventory.

## Local verification

`npm run dev` starts the app on port 3105. It requires configured Clerk keys and PostgreSQL on port 4105 for protected staff flows. `/api/health` returns 503 rather than claiming success when PostgreSQL is unavailable.

## Local PostgreSQL and smoke

Run `npm run db:start` in one terminal to launch the workspace-managed PostgreSQL server on `127.0.0.1:4105`. It persists under `.local-db/`; use `npm run db:stop` to stop it. `npm run db:migrate` and `npm run db:seed` use `postgresql://postgres:postgres@127.0.0.1:4105/tomchei_shabbos`.

For local smoke only, set `DEV_AUTH_MODE=true` and an uncommitted random `DEV_AUTH_SECRET` in `.env.local`, then run `npm run dev`. The API accepts a short-lived HMAC-signed `x-dev-session` header only in `next dev`; it resolves the signed user ID through the same PostgreSQL staff records and permissions as Clerk. It is disabled in production and never trusts an email or user ID query parameter.

Start the embedded database with `npm run db:start`, then run `npm run smoke:p1` or `npm run smoke:p2`. The P2 smoke deploys migrations, regenerates Prisma, seeds the domain fixture, and proves grouping, order state, sequential finalization, and inventory-race behavior.

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run migration:guard`, and `npm run migration:harness` before a handoff.
