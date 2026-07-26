# Tomchei Shabbos — Mishloach Manos platform

Greenfield rebuild of the nonprofit Purim mishloach manos platform.
This repository currently contains **phases P1 and P2**:

- **P1** — foundation, identity, roles, permissions, staff tooling.
- **P2** — the domain core as schema plus engine: seasons, catalog, customers and
  address book, orders, packages, payments, shipping and inventory. No storefront
  or admin screens for any of it yet.

Catalog UI, checkout, fulfillment and reporting land in later phases of
`shared/MERGED-BUILD-PLAN.md`.

## Ports

| Service | Port |
|---|---|
| Web | 3104 |
| Postgres | 4104 |

## Getting started

```bash
npm install
npm run db:start        # leave running: embedded Postgres on 4104
cp .env.example .env    # then fill in real values
npm run db:deploy       # apply migrations
npm run seed            # baseline manager, staff, driver and customers
npm run dev             # http://127.0.0.1:3104
```

On a database with no staff rows, `/setup` creates the first manager and then locks
itself permanently. `npm run seed` uses that same bootstrap path, so seeding cannot
produce an account the UI could not.

### There is no Docker or system Postgres here

`npm run db:start` runs a real PostgreSQL 17 cluster from the `embedded-postgres`
dev dependency, storing data in `.pgdata/`. Hosted environments ignore this
entirely and just set `DATABASE_URL`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js on port 3104 |
| `npm run lint` / `typecheck` | ESLint, `tsc --noEmit` |
| `npm test` | Unit tests plus the DB-backed bootstrap and concurrency tests |
| `npm run db:start` | Embedded Postgres cluster |
| `npm run db:migrate` / `db:deploy` | Prisma migrations |
| `npm run db:guard` | Fails if `prisma/schema` drifted from the committed migrations |
| `npm run db:fresh` | Drops and recreates the **local** database, then migrates |
| `npm run seed` | Baseline identities, catalog, stock and one placed order; idempotent |
| `npm run env:example` | Regenerates `.env.example` from `src/lib/env-spec.ts` |
| `npm run env:check` | Runs startup env validation on its own |
| `npm run ci` | lint → typecheck → migration guard → tests |
| `npm run smoke` | P1 smoke checks against a running dev server |
| `npm run smoke:p2` | P2 smoke: migrate, seed, read the domain back, run the engine tests |

`npm run smoke` needs `npm run dev` running and starts from an empty database
(`npm run db:fresh`), because it proves the first-run bootstrap. `npm run smoke:p2`
needs no dev server — P2 has no screens.

## Domain model

The Prisma schema is a folder, one file per concern: `identity`, `customers`,
`catalog`, `orders`, `fulfillment`, `inventory`, `ops`.

The engine that goes with it:

| Rule | Where |
|---|---|
| Which lines share a box | `src/lib/orders/grouping.ts` — recipient, address, method and greeting. A different greeting means a different card, so it splits the package |
| Which order status may follow which | `src/lib/orders/state-machine.ts` |
| Placing, cancelling and discarding | `src/lib/orders/order-service.ts` — one transaction that claims the draft, reserves stock, takes the season's next order number and builds the packages |
| Claiming the last unit | `src/lib/inventory/reserve.ts` — a single conditional UPDATE, so two checkouts cannot both win |
| What an order took out of stock | `Reservation` rows, written inside the same transaction. A cancel releases what those rows say, never what the lines say today |
| Package stages | `src/lib/fulfillment/package-stages.ts` — optional and forward-only; printing never means shipped |
| Cached payment totals | `src/lib/orders/payment-status.ts` — always recounted, never adjusted by a delta |

Order numbers are per season and gapless: the counter increments inside the same
transaction that places the order, so a rollback puts the number back.

## Authentication

`AUTH_PROVIDER` selects the identity provider:

- **`clerk`** — production. Requires `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
  `CLERK_SECRET_KEY`; `src/proxy.ts` runs `clerkMiddleware`.
- **`local`** — development and CI. A signed, httpOnly cookie identifies a staff
  member by email with no password. Env validation rejects it, and
  `startLocalSession` throws, unless `NODE_ENV` is not production **and** `APP_URL`
  is a loopback address — so a staging box cannot quietly deploy passwordless auth.

Both providers produce the same `ExternalIdentity`, and everything downstream —
roles, permission overrides, impersonation, audit — is provider-agnostic.

`src/proxy.ts` only answers "is anyone signed in?". Every real authorization
decision runs server-side in `requirePermission`, which returns a genuine 403
(and 401 when signed out) rather than redirecting.

### Roles and permissions

Roles set a baseline (`src/lib/auth/permissions.ts`). Per-person overrides adjust
it, and **deny always beats grant**, which is the only way to take a permission
away from a manager. Customers live in their own table and can never hold a
staff role.

## Conventions

One pattern per concern, picked here and followed from now on:

| Concern | Choice |
|---|---|
| Data access | Prisma, single client in `src/lib/db.ts` |
| Validation | Zod, at every trust boundary |
| Errors | `Result` from `src/lib/core/result.ts`; only its `publicMessage` reaches a browser |
| Money | Integer cents, `src/lib/core/money.ts`. Never floats |
| Dates | Platform `Intl`, `src/lib/core/dates.ts`. No date library |
| Styling | Tailwind with CSS-variable design tokens in `globals.css` |
| UI kit | Small shadcn-style primitives in `src/components/ui` |
| Concurrency | Optimistic `version` columns; conflicts are reported, never overwritten |
| Transactions | `runInTransaction` / `abort` in `src/lib/transaction.ts`. A domain failure rolls the work back; helpers that may run inside one take `DbClient` |
| Audit | `recordAudit` only. `AuditDetails` in `src/lib/audit.ts` declares what each action may write, so a new action is a typed decision |
| Tests | `node:test` via tsx. No test framework dependency |
