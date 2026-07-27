# Tomchei Shabbos — Mishloach Manos platform

Greenfield rebuild of the nonprofit Purim mishloach manos platform.
This repository currently contains **phases P1 to P11**:

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
- **P10** — next year: the season calendar and its wizard, replacement mappings,
  and repeat orders for customers, the counter and the office.
- **P11** — email and notifications: the campaign builder, subscriber lists, the
  triggered emails an order sends, and the sweeper that finally delivers
  everything P9 has been queuing — over Resend for mail and Twilio for text.

The full year-one import pipeline and reporting land in later phases of
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
| `npm run smoke:p10` | P10 smoke: the repeat review page, staff and bulk repeat, the mappings screen, the wizard and the auto-flip |
| `npm run smoke:p11` | P11 smoke: preferences and tokens, the campaign, transactional email, a forced provider failure, the crons and the purge |
| `npm run fixtures:scale` | Generates 1,000 orders and 5,000 packages; `-- clear` takes them out again |

`npm run smoke` needs `npm run dev` running and starts from an empty database
(`npm run db:fresh`), because it proves the first-run bootstrap. `npm run smoke:p2`
needs no dev server — P2 has no screens. `npm run smoke:p3` onwards need both a dev
server and the seeded database; `smoke:p4` clears the drafts an earlier run left
behind so it starts from an empty cart, and `smoke:p6` generates the scale fixtures
and removes them again so the database is what it was.

`npm run newsletter:link` prints a subscriber's signed preferences link, which
is how those pages are opened without waiting for a letter to arrive.

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

`requireOpenStore` lives in `src/lib/http/store-gate.ts`, not beside the reader in
`store-state.ts`. Reading whether the store is open is a database question any
service may ask; turning that answer into a 403 is something only a route can do,
and mixing the two would drag `next/navigation` into every caller of
`readStoreState`. The four ordering routes — `/order`, its actions, and the two
checkout halves — import it from there.

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
| `/admin/email`, `/admin/email/campaigns/[campaignId]` | Every letter the org has written; draft one, preview it, test it against one address, then send it to the list |
| `/admin/email/lists`, `/admin/email/templates`, `/admin/email/outbox` | Hand-picked groups inside the newsletter, the wording of the emails an order sends, and every message the app has tried to deliver |
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

Five scheduled jobs run behind `CRON_SECRET` as a bearer token:
`/api/cron/pickup-expiry` stamps boxes nobody collected, `/api/cron/payment-reminder`
chases overdue orders once each, `/api/cron/season-flip` opens and closes seasons on
the calendar below, `/api/cron/notification-sweep` empties the outbox, and
`/api/cron/email-log-purge` clears delivered mail past its keep-by date. No secret
configured means every endpoint refuses everybody, which is the safe reading of
"not set up"; a hosted deployment must set it.

## Next year: seasons, mappings and repeat orders

`/admin/seasons` is the calendar. One season is open at a time — opening one closes
whichever was open, whether a manager pressed the switch or the scheduled flip did
it — and the dates are entered as the office's own wall clock rather than UTC.
Leaving the dates empty means the switch is worked by hand. Closed does not mean
dark: browsing and the archive stay up, only the order builder refuses (403).

`/admin/seasons/new` copies a season forward: pick which of this year's products to
take, whether to carry the add-ons, and whether to draw the replacement links as it
goes. The new season arrives **closed with empty shelves** — nothing is on hand
until somebody counts it in — so a copied catalogue can never sell stock that does
not exist.

`/admin/catalog/replacements` is where the office says what last year's item is
called this year. Mappings are followed as a chain across seasons (2025's tray →
2026's mini tray → 2027's box) with a depth limit and loop detection, and several
retired items may fold onto one survivor. An item deliberately left unmapped is not
silently dropped: the repeat has to ask.

A customer repeating an order lands on a review page before anything is written.
Each line says what it is now — the same item, a mapped replacement, or nothing —
and an unmapped line must be picked or taken off before the page will build a cart.
The default suggestion is the closest price inside the same category, but it starts
blank so the choice is the customer's. Recipients whose addresses left the book are
flagged the same way, greeting-card messages carry across, and both the swaps and
the recipients need an explicit tick. Only then is one draft written, at this year's
prices.

The counter has the same thing without the page: staff repeat one order onto their
own till, and `/admin/customers` bulk-repeats a stack of customers' histories,
reporting by name the ones with nothing to repeat rather than opening empty carts.

`src/lib/imports/prior-year-orders.ts` is the year-one hook the P12 pipeline will
call: it lands an old order idempotently on `(season, importedOrderReference)`,
fills the family's address book, and creates anything the catalogue is missing as an
archived stub, so an imported order repeats like any other.

## Email and text

Nothing in the app sends a message itself. Every one is written to the
notification outbox — email and text as separate rows, because they succeed and
fail separately — and `/api/cron/notification-sweep` delivers them. That is what
makes a provider outage a delay instead of a hole, and it is why the screen that
queues a message says "3 queued" rather than claiming a delivery it has not seen.

Each row carries the key of the event that caused it, so a replayed webhook, a
second checkout attempt or a rerun campaign write nothing new. The sweeper claims
what is due with one conditional `UPDATE ... FOR UPDATE SKIP LOCKED`, so
overlapping sweeps cannot both take a message, and passes the same key to the
provider as an idempotency key in case a send times out after it was accepted. A
refusal pushes the row a minute, five, half an hour, then two hours into the
future and gives up after five tries; every attempt writes a `NotificationAttempt`
row, so "it arrived in the end" and "it failed four times first" are both
answerable next year.

`/admin/email` is the hub. Campaigns are drafted, previewed and test-sent before
anybody is written to, and sending is safe to press twice: a recipient already
written to for that campaign is skipped by a unique row rather than by hoping.
Lists are hand-picked subsets of the newsletter and can only hold people who
already subscribed. `/admin/email/templates` holds the wording of the three
emails an order sends — confirmation, payment link, refund — which ship in code
and stay there until somebody saves an override, so a fresh database sends
sensible mail on day one and Reset always has somewhere to go back to. A
placeholder the app cannot fill is refused at save time rather than printed as
`{{custmerName}}` in a donor's inbox. `/admin/email/outbox` answers "did she get
it?" with the attempt count, the provider's own words and when the next try is
due.

Mail goes through Resend and text through Twilio, each behind a one-function
`MessageProvider` so the outbox knows nothing about either. `EMAIL_PROVIDER` and
`SMS_PROVIDER` set to `capture` write the message into `CapturedMessage` instead
of sending it, which is what development, CI and the settings test sender use;
env validation refuses capture off this machine, because a hosted deployment that
captures its mail tells its customers nothing while every screen reports success.
Email also waits — queued, attempt count untouched — until a sender address is
set on Settings → Email, so configuring it later delivers the backlog rather than
finding it burnt out.

## Domain model

The Prisma schema is a folder, one file per concern: `identity`, `customers`,
`catalog`, `orders`, `fulfillment`, `inventory`, `ops`, `media`, `newsletter`,
`notifications`, `email`.

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
| Whether the store takes orders | `src/lib/store-state.ts` — season status and the `store.open` setting, both required. `src/lib/http/store-gate.ts` is the route-side gate that turns a closed store into a 403 |
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
| What actually delivers it | `src/lib/notifications/dispatch.ts` — claim what is due, hand it to the channel's provider, back off and record every attempt |
| What an email looks like and says | `src/lib/email/branding.ts` (the letterhead) and `email/templates.ts` (the shipped wording of each triggered email, and the placeholders it may use) |
| Which order events write an email | `src/lib/email/transactional.ts` — queued inside the same transaction as the order, payment or refund that caused it |
| Who a campaign reaches | `src/lib/email/campaigns.ts` — one audience query for the count, the preview and the send, so the number on screen is the number written to |
| How long delivered mail is kept | `src/lib/notifications/purge.ts` — only `SENT` rows past the retention setting; queued, failed and audit rows are never eligible |
| Who needs ringing | `src/lib/scheduling/follow-up.ts` — unpaid, unclaimed and undelivered on one list, one reason at a time |
| What last year's item is called now | `src/lib/catalog/replacements.ts` — the mapping chain, followed across seasons with a depth limit, a loop guard and the same slug preferred over a stale link |
| What a repeat would actually order | `src/lib/orders/repeat-plan.ts` — one plan the review page, the counter and the bulk sweep all read, so a customer and a staff member see the same answer. `repeat-recipients.ts` resolves who each line is going to; `repeat-apply.ts` is the write, and re-reads every chosen product inside its own transaction |
| Which past orders may be repeated | `src/lib/orders/repeatable.ts` — one status set, so the history row, the order page and the `/repeat` URL cannot disagree |
| Which season the storefront is in | `src/lib/seasons/management.ts` and `seasons/schedule.ts` — one open season, whether the switch was pressed or the clock reached it |
| What a copied catalogue starts with | `src/lib/seasons/wizard.ts` — closed, nothing on hand, and the replacement links already drawn |

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
