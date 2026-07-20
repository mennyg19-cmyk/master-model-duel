# Tomchei Shabbos Mishloach Manos — platform

Greenfield rebuild. Phase P1: foundation, identity, roles, permissions, staff tooling.

## Stack

Next.js (App Router) + TypeScript, Tailwind v4, Prisma + PostgreSQL, Zod env validation.
Route groups: `(storefront)`, `(admin)`, `(driver)`.

## Run locally

```
npm install
npm run db:start        # embedded Postgres on 127.0.0.1:4102 (keep running)
npm run db:migrate      # apply migrations
npm run db:seed         # baseline reference data
npm run dev             # web app on http://127.0.0.1:3102
```

First visit on an empty database: open `/setup` to create the first manager. After that,
setup locks and staff sign in at `/login`.

## Auth modes

`AUTH_MODE=dev` (default): email/password staff login with DB-backed sessions. Sessions
die immediately on account revocation.

`AUTH_MODE=clerk`: Clerk middleware takes over sign-in; requires the two Clerk keys in
`.env`. Staff/customer records link to Clerk identities via `clerkUserId`. No Clerk keys
were available in this environment, so dev mode is the tested path.

## Payments

Stripe hosted checkout with immediate capture. Without `STRIPE_SECRET_KEY` the gateway runs
in mock mode: `/dev/stripe-checkout` stands in for Stripe's page and posts signed events
through the real `/api/webhooks/stripe` route, so signatures, idempotency, amount-safety
auto-refunds, and refund sync run the same code as production. Set `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` in `.env` to go live; the mock page then 404s.

## Fulfillment & printing

Finalized orders explode into packages (grouped by recipient/address/method/greeting).
Staff work them on `/admin/packages` (split, regroup, stage advance) and `/admin/fulfillment`
(per-channel counts, bulk stage moves, print production). The nightly print batch is
idempotent per day and writes one PDF per filing group (= fulfillment method code) for
slips, labels, and greeting cards, plus a packing slip per order. PDFs come from the
dependency-free writer in `lib/pdf.ts`; printing never changes a package's stage.

## Patterns (one per concern)

- Data access: Prisma via `lib/db.ts` singleton.
- Authorization: `requirePermissionPage` (403 via `forbidden()`) / `requirePermissionApi`.
- Mutations: route handlers under `app/api/*` + client `fetch` + `router.refresh()`.
- Validation: Zod schemas at every API boundary.
- Styling: Tailwind + tokens in `globals.css`, shared primitives in `components/ui/`.
- Audit: `writeAudit` for every security-relevant mutation.

## Checks

```
npm run ci                 # lint + typecheck + migration guard + unit tests
npm run smoke:concurrency  # 10 concurrent versioned updates -> 1 commit, 9 conflicts
```
