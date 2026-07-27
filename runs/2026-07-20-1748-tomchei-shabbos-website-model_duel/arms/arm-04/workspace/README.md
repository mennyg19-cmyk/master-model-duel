# Tomchei Shabbos — Mishloach Manos platform

Greenfield rebuild of the nonprofit Purim mishloach manos platform.
This repository currently contains **phases P1 to P9**:

- **P1** — foundation, identity, roles, permissions, staff tooling.
- **P2** — the domain core as schema plus engine: seasons, catalog, customers and
  address book, orders, packages, payments, shipping and inventory. No screens.
- **P3** — the storefront and the screens that feed it: marketing homepage,
  catalog with filters and quick view, past-collections archive, newsletter with
  tokenized unsubscribe, admin catalog and add-on editors, the media library, and
  the settings hub.
- **P4** — the cart-first order builder, the customer address book, the customer
  account area, and the staff view of a customer's book.
- **P5** — checkout: reservations, fulfillment fees, payment and refunds.
- **P6** — the operations hub, the order desk, the counter and CSV imports.
- **P7** — the package board, splitting and regrouping, and the nightly print run.
- **P8** — carriage: carrier rates, the margin engine, labels and tracking.
- **P9** — the van: delivery routes and driver links, the pickup counter, bulk
  scheduling, the follow-up list and the scheduled sweeps.

Repeat orders, the mail and SMS transport, and reporting land in later phases of
`shared/MERGED-BUILD-PLAN.md`. P9 writes every customer message into a
notification outbox; nothing is actually posted until that transport exists.

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
| `npm run smoke:p4` | P4 smoke: builder, assignment, guest and account drafts, address book, staff audit |
| `npm run smoke:p5` | P5 smoke: checkout, reservations, payment, webhooks, refunds |
| `npm run smoke:p6` | P6 smoke: dashboard, order desk, POS, imports, and all of it at crunch scale |
| `npm run smoke:p7` | P7 smoke: the package board, splitting, the nightly batch and the three artifacts |
| `npm run smoke:p8` | P8 smoke: carrier rates, the margin, buying and cancelling a label, tracking |
| `npm run smoke:p9` | P9 smoke: building a route, the driver link, rerouting, pickup, bulk scheduling and the crons |
| `npm run fixtures:scale` | Generates 1,000 orders and 5,000 packages; `-- clear` takes them out again |

`npm run smoke` needs `npm run dev` running and starts from an empty database
(`npm run db:fresh`), because it proves the first-run bootstrap. `npm run smoke:p2`
needs no dev server — P2 has no screens. `npm run smoke:p3` onwards need both a dev
server and the seeded database; `smoke:p4` clears the drafts an earlier run left
behind so it starts from an empty cart, and `smoke:p6` generates the scale fixtures
and removes them again so the database is what it was.

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
| `/order` | The cart-first builder behind the store-open gate, plus the delivery-ZIP check |
| `/account`, `/account/orders`, `/account/profile`, `/account/addresses` | Dashboard, order history and detail, profile, address book |
| `/account/sign-in` | Customer sign-in, which also claims the cart built as a guest |

Quick view, the mobile menu, the recipient picker and the add-recipient dialog are
URLs and `<details>` elements, not JavaScript widgets, so all of them work with the
client bundle blocked and all of them survive a refresh.

### The order builder

Items go in first with no recipient at all, and each line is then pointed at the
person it is for — on the order, someone in the address book, or someone new, who
joins the book on the way past. A line is one recipient's box, so a quantity above
one is that many boxes for the same person and a second person is a second line.

The cart is one component rendered twice: pinned beside the catalogue on a desktop,
and behind the floating button on a phone. Drafts hold no stock — reservations are
taken at checkout in P5 — so the stock figure on a card is honest about being a
snapshot, and nothing in the builder promises a unit it cannot hold.

A cart exists before anyone signs in. A guest's draft is held by a random token in
an httpOnly cookie and stored only as its SHA-256 hash, so the row cannot be found
from the database side or guessed from the id. Signing in hands that draft to the
account; the cookie is cleared only if the hand-over succeeds, so an account that
is already building an order keeps both carts rather than losing one.

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

## The admin

| Page | What it is |
|---|---|
| `/admin` | Season KPIs, the head of today's queue and the latest orders, each panel shown only to permissions that allow it |
| `/admin/today` | The day's work: money owed, paid and waiting to be packed, and carts left open at the counter |
| `/admin/orders` | One search box over order numbers, draft references and customers, with status and payment filters, paging, and bulk actions on the selected rows |
| `/admin/orders/[orderId]` | What is in the boxes, what was paid, a counter payment, a refund, and a status move |
| `/admin/pos`, `/admin/pos/[customerId]` | Find or create the customer, then the storefront's own builder and checkout pointed at the till |
| `/admin/customers`, `/admin/customers/[customerId]` | The directory and one person's orders and address book |
| `/admin/imports`, `/admin/imports/[batchId]` | Upload a CSV, read what it will do row by row, then commit it in one transaction |
| `/admin/routes`, `/admin/routes/[routeId]` | Build a route from the waiting boxes or just schedule their day; assign a driver, hand out a link, print the sheet and the cards, tick stops off |
| `/admin/pickup` | The counter: what is ready, what is blocked and why, the door list, and the collected stamp |
| `/admin/follow-up` | The call list: money owed, boxes nobody came for, deliveries promised and not out |
| `/drive/[token]`, `/driver` | The volunteer's phone — one route, no account — and the staff driver's list of their own vans |

The counter is the storefront: `/admin/pos/[customerId]` renders the same product
panel, cart and recipient picker as `/order`, and the same checkout summary priced
by the same engine, with the actions bound to the till instead of the customer.
Nothing about how an order is built is written twice, which is the only way "the
POS produces the same order as the website" survives the next change to either.

Cards are not taken at the counter. The POS settles in cash or by check, and the
payment row carries the name of the staff member who took it; a card goes through
the customer's own hosted payment page, which is what keeps card data off these
servers.

Every admin list reads one clamped page (`src/lib/admin/list-query.ts`), and a bulk
action is a bounded batch that attempts each order separately and reports what it
did to each — so two people sweeping the same rows during Purim week get an exact,
repeatable account rather than a silent overwrite.

## Carriage

`SHIPPING_PROVIDER` selects the carrier account, the same way auth and payments do:

- **`shippo`** — production. Requires `SHIPPO_API_TOKEN`. `SHIPPO_FEDEX_ACCOUNT_ID`
  and `SHIPPO_UPS_ACCOUNT_ID` are the organization's own carrier accounts; an empty
  slot means that carrier is never quoted and can never win the comparison.
- **`local`** — development and CI. An offline stand-in that prices, labels, voids
  and tracks on this machine. Env validation rejects it unless `APP_URL` is a
  loopback address, because its labels do not exist at any carrier.

Both go through the same five verbs in `src/lib/shipping/provider.ts`, so rate
shopping, the margin engine and the two-step label claim are exercised for real in
CI rather than mocked.

The margin rule (UR-003): every carrier the organization can ship the whole box
with is quoted, the customer is charged the **highest** of those quotes, the label
is bought on the **cheapest**, and the difference funds the campaign. It is stored
as its three numbers on each `ShipmentBox` row, not recovered later by re-quoting a
rate that has since moved. A carrier that could not price every parcel of a
multi-carton box is not eligible and is neither charged for nor bought from.

Buying a label is the only button that spends money, so the parcels are claimed in
this database *before* the carrier is called: a second person pressing Buy finds
the box claimed, and anything bought before a failure — including the label from
the failing attempt — is cancelled at the carrier before the error is raised.
Nothing is left bought that no row knows about.

Where carriers collect from is a setting, not an environment variable, edited on
Settings → Shipping. With no origin, no box types, or no carrier answering, the box
is priced at the administrator's flat rate and the quote row says `FALLBACK` — an
outage during Purim week must not close the store.

## The van, the counter and the sweeps

`/admin/routes` is where a manager ticks the boxes going out together and either
builds a route from them or just tells those customers which day they are coming.
Stops are placed with `MAPBOX_ACCESS_TOKEN` through the shared `GeocodeCache` — the
same cache the address book fills, so a house looked up when a donor saved it is
free when the route is planned — and ordered nearest-first from the shipping room.
With no token an offline stand-in places addresses instead; env validation refuses
it off this machine, because a real driver sent to a made-up point is a wasted
afternoon.

A driver gets a link, not an account: a random token whose SHA-256 is all the
database keeps, an optional 4-digit PIN kept as a salted scrypt hash and throttled
after five wrong tries, and a page that shows one route's stops with a Google Maps
link and a Delivered button. Every tap is audited with the link that made it. The
printed route sheet is the same run on paper, because a phone with no signal must
not be a stopped van.

Moving a box between shipping and delivery keeps the fee the customer agreed to and
cancels any carrier label through the P8 void hook. A van passing a shipping box's
door is offered it as a suggestion, and lifting it on takes a manager's explicit
confirmation, because that is what spends the label.

`/admin/pickup` is the counter: a box is announced only once it is packed and its
food is on the shelf, the notice goes out once, and the door list prints what is
waiting. `/admin/follow-up` is the call list — money owed, boxes nobody came for,
deliveries promised and not out — filtered one reason at a time.

Two scheduled jobs run behind `CRON_SECRET` as a bearer token: `/api/cron/pickup-expiry`
stamps boxes nobody collected, and `/api/cron/payment-reminder` chases overdue
orders once each. No secret configured means both endpoints refuse everybody, which
is the safe reading of "not set up"; a hosted deployment must set it.

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
| Which carton a box goes in | `src/lib/shipping/bin-packing.ts` — the smallest stocked type it fits by usable volume and weight, spilling into copies of the largest when nothing does |
| What shipping costs and who is paid | `src/lib/shipping/margin.ts` — pure: charge the highest eligible quote, buy the cheapest, keep the spread |
| Where a quote comes from | `src/lib/shipping/quote-service.ts` — checkout and finalize both price through it, and both fall back to the settings rate when no carrier answers |
| Buying and cancelling carriage | `src/lib/shipping/label-service.ts` — claimed here before the carrier is called, cancelled at the carrier if anything after that fails |
| Cached payment totals | `src/lib/orders/payment-status.ts` — always recounted, never adjusted by a delta |
| Whether the store takes orders | `src/lib/store-state.ts` — season status and the `store.open` setting, both required |
| Where volunteers deliver | `src/lib/delivery-area.ts` — an explicit ZIP list with no override; an empty list means nobody |
| Who a cart belongs to | `src/lib/orders/draft-access.ts` — a customer id or a hashed guest token. Every cart read and write goes through the same owner filter, so "not yours" and "does not exist" are one answer |
| What is in the cart, and what it costs | `src/lib/orders/cart.ts` (read) and `cart-service.ts` (add, requantify, remove, claim) |
| Where a line is going | `src/lib/orders/assignment.ts` — the three-way picker, re-checked server-side: the method must still be offered, a saved address must be in this customer's own book, and delivery still only reaches its ZIPs |
| One address book per customer | `src/lib/addresses/address-book.ts` — normalized keys dedupe "12 Main St." onto "12 Main Street", edits follow open drafts but never a placed order, and rows are archived rather than deleted |
| Which unsubscribe links work | `src/lib/newsletter/tokens.ts` — HMAC over a purpose string and the payload, 30-day expiry |
| How long a list may be | `src/lib/admin/list-query.ts` — every admin list reads one clamped page, so no screen grows with the season |
| What the order desk shows | `src/lib/orders/order-desk.ts` — one search box over order number, draft reference and customer, with status and payment filters |
| What a sweep of orders did | `src/lib/orders/bulk-actions.ts` — bounded batches, each order attempted on its own and reported as updated, skipped or conflicted |
| Whose cart the counter is holding | `src/lib/pos/counter.ts` — a POS draft is owned by the staff member who opened it as well as the customer, so it cannot collide with the customer's own |
| What a spreadsheet will do before it does it | `src/lib/imports/import-service.ts` — staging writes a verdict per row and nothing else; the commit writes every row or none |
| What order the van drives in | `src/lib/routing/route-service.ts` — nearest-neighbour from the shipping room, with anything the geocoder could not place put last for the manager to handle |
| Whether a driver link opens | `src/lib/routing/route-links.ts` — hashed token, hashed PIN, five tries, and dead on completion or revocation |
| Whether a box may change how it travels | `src/lib/routing/reroute.ts` — the fee is never re-priced, a bought label is cancelled first, and a box already gone refuses |
| Whether a pickup box may be announced | `src/lib/pickup/pickup-service.ts` — packed *and* in stock, held for seven days, and the row says which of the two is missing |
| Who gets told what, once | `src/lib/notifications/outbox.ts` — every customer message is a row with a unique dedupe key, so a second press is a no-op rather than a second text |
| Who needs ringing | `src/lib/scheduling/follow-up.ts` — unpaid, unclaimed and undelivered on one list, one reason at a time |

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
| Server actions | A `'use server'` module exports async functions and nothing else, so the shared `FormState` and its empty value live in `src/lib/forms/form-state.ts` |
| Reading a posted form | `trimmedField` in `src/lib/forms/form-data.ts`; the eight address fields come back together from `addressFieldsFromForm` in `src/lib/addresses/address-form.ts`, so a new column is one edit |
| Reporting an action's outcome | A page with one form uses `useActionState`. A page with a form on every card and every row — the builder, the address list — redirects back with `?notice=` or `?problem=` and reports once at the top, which is one place to look instead of a hook per row |
| Client-safe modules | Anything a `'use client'` file imports stays free of `db`, `env` and `server-only` — which is why the newsletter labels live in `src/lib/newsletter/preferences.ts` and `addressSummary` in `src/lib/addresses/address-summary.ts`, apart from their services |
| Tests | `node:test` via tsx. No test framework dependency |
