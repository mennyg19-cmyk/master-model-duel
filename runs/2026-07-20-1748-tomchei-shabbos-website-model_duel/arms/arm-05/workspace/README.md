# Tomchei Shabbos — P4 cart-first ordering

P1 provides the Next.js/TypeScript shell, PostgreSQL Prisma repository and migration, Clerk-gated staff APIs, first-manager setup, staff roles, permission overrides, optimistic updates, and security audit events.

P2 adds the season/catalog, customer/address, order/payment, package/shipping, inventory, geocode, cron, and hidden BOM schemas. The domain helpers group packages by recipient/address/method/greeting, enforce draft-only finalization/discard, serialize per-season order numbers, and atomically reserve finished-package inventory.

P3 adds the public Purim storefront, season-aware catalog and archive, double-opt-in newsletter preferences with opaque HMAC unsubscribe tokens, staff catalog/add-on management, Vercel Blob media uploads, and the initial settings hub. Newsletter confirmation delivery requires `NEWSLETTER_DELIVERY_WEBHOOK_URL`; product media uploads require `BLOB_READ_WRITE_TOKEN`. The local P3 smoke verifies image validation without sending an external Blob write.

P4 adds cart-first draft building with stock-aware catalog selections, options and restricted add-ons, three-way recipient assignment, auto-saved address-book recipients, customer account history, and opaque guest-draft access tokens. Customer address edits are ownership-checked; staff edits require `orders.read` and create an audit event. Postal-centroid coordinates are stored only as temporary local geocoding until the mapped-provider phase.

## Local verification

`npm run dev` starts the app on port 3105. It requires configured Clerk keys and PostgreSQL on port 4105 for protected staff flows. `/api/health` returns 503 rather than claiming success when PostgreSQL is unavailable.

## Local PostgreSQL and smoke

Run `npm run db:start` in one terminal to launch the workspace-managed PostgreSQL server on `127.0.0.1:4105`. It persists under `.local-db/`; use `npm run db:stop` to stop it. `npm run db:migrate` and `npm run db:seed` use `postgresql://postgres:postgres@127.0.0.1:4105/tomchei_shabbos`.

For local smoke only, set `DEV_AUTH_MODE=true` and an uncommitted random `DEV_AUTH_SECRET` in `.env.local`, then run `npm run dev`. The API accepts a short-lived HMAC-signed `x-dev-session` header only in `next dev`; it resolves the signed user ID through the same PostgreSQL staff records and permissions as Clerk. It is disabled in production and never trusts an email or user ID query parameter.

Start the embedded database with `npm run db:start`, then run `npm run smoke:p1`, `npm run smoke:p2`, `npm run smoke:p3`, or `npm run smoke:p4`. The P4 smoke deploys migrations, regenerates Prisma, seeds the storefront fixture, and proves three-way recipient assignment, draft isolation, and audited address edits.

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run migration:guard`, and `npm run migration:harness` before a handoff.
