# Tomchei Shabbos — Mishloach Manos platform

Greenfield rebuild of the nonprofit Purim mishloach manos platform.
This repository currently contains **phases P1 to P3**:

- **P1** — foundation, identity, roles, permissions, staff tooling.
- **P2** — the domain core as schema plus engine: seasons, catalog, customers and
  address book, orders, packages, payments, shipping and inventory. No screens.
- **P3** — the storefront and the screens that feed it: marketing homepage,
  catalog with filters and quick view, past-collections archive, newsletter with
  tokenized unsubscribe, admin catalog and add-on editors, the media library, and
  the settings hub.

Cart and checkout, fulfillment and reporting land in later phases of
`shared/MERGED-BUILD-PLAN.md`. `/order` exists in P3 only as the gate that decides
whether ordering is possible at all — the builder behind it is P4.

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
| `npm run newsletter:link -- you@example.com` | Prints that subscriber's signed preferences link |
| `npm run smoke` | P1 smoke checks against a running dev server |
| `npm run smoke:p2` | P2 smoke: migrate, seed, read the domain back, run the engine tests |
| `npm run smoke:p3` | P3 smoke: storefront, gates, newsletter, media and settings over HTTP |

`npm run smoke` needs `npm run dev` running and starts from an empty database
(`npm run db:fresh`), because it proves the first-run bootstrap. `npm run smoke:p2`
needs no dev server — P2 has no screens. `npm run smoke:p3` needs both a dev server
and the seeded database.

Newsletter mail is a later phase, so `npm run newsletter:link` is how the
preferences and unsubscribe pages are opened until then.

## Storefront

| Page | What it is |
|---|---|
| `/` | Mission, impact, how it works, testimonials. The ordering CTA appears only while the store is open |
| `/collection` | The current season: category filters, price sort, sold-out cards that stay visible, and `?quick=slug` quick view |
| `/collection/[slug]` | Detail with every option priced |
| `/archive`, `/archive/[year]` | Past seasons, browse only, no buy controls anywhere |
| `/newsletter`, `/newsletter/manage`, `/newsletter/unsubscribe` | Signup, preferences and unsubscribe, all reached with a signed token instead of an account |
| `/order` | The ordering gate: store-open enforcement and the delivery-ZIP check |

Quick view and the mobile menu are a URL and a `<details>` element, not JavaScript
widgets, so both work with the client bundle blocked and both survive a refresh.

Two switches decide whether ordering is possible, and `src/lib/store-state.ts` is
the only place that reads them: the season's own status and the `store.open`
setting a manager can flip. Hiding buy buttons is a courtesy; `requireOpenStore`
answers 403 on the ordering routes, which is the half that holds when someone types
the URL.

## Media

Catalog photos go to Vercel Blob in a deployment and to `public/uploads` in
development, chosen by `MEDIA_STORAGE` (`src/lib/media/storage.ts`). Local storage
is refused unless `APP_URL` is a loopback address, for the same reason as local
auth: a hosted filesystem is read-only and per-instance.

Uploads must satisfy three separate checks — extension, declared content type, and
the file's own magic bytes — plus alt text, which the form requires because no later
screen would ask for it. SVG is rejected even though it is an image: it is a
document that can carry script, served from this site's origin.

## Domain model

The Prisma schema is a folder, one file per concern: `identity`, `customers`,
`catalog`, `orders`, `fulfillment`, `inventory`, `ops`, `media`, `newsletter`.

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
| Whether the store takes orders | `src/lib/store-state.ts` — season status and the `store.open` setting, both required |
| Where volunteers deliver | `src/lib/delivery-area.ts` — an explicit ZIP list with no override; an empty list means nobody |
| Which unsubscribe links work | `src/lib/newsletter/tokens.ts` — HMAC over a purpose string and the payload, 30-day expiry |

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
| Server actions | A `'use server'` module exports async functions and nothing else. Form state is a type there; its initial value is a const in the client component |
| Client-safe modules | Anything a `'use client'` file imports stays free of `db`, `env` and `server-only` — which is why the newsletter labels live in `src/lib/newsletter/preferences.ts`, apart from the service |
| Tests | `node:test` via tsx. No test framework dependency |
