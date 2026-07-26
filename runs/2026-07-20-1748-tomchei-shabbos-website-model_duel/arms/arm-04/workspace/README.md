# Tomchei Shabbos — Mishloach Manos platform

Greenfield rebuild of the nonprofit Purim mishloach manos platform.
This repository currently contains **phase P1 only**: foundation, identity, roles,
permissions and staff tooling. Catalog, ordering, fulfillment and reporting land in
later phases of `shared/MERGED-BUILD-PLAN.md`.

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
| `npm run db:guard` | Fails if `schema.prisma` drifted from the committed migrations |
| `npm run db:fresh` | Drops and recreates the **local** database, then migrates |
| `npm run seed` | Baseline identities, idempotent |
| `npm run env:example` | Regenerates `.env.example` from `src/lib/env-spec.ts` |
| `npm run env:check` | Runs startup env validation on its own |
| `npm run ci` | lint → typecheck → migration guard → tests |
| `npm run smoke` | Phase smoke checks against a running dev server |

`npm run smoke` needs `npm run dev` running and starts from an empty database
(`npm run db:fresh`), because it proves the first-run bootstrap.

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
| Tests | `node:test` via tsx. No test framework dependency |
