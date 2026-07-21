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

## Shipping (Shippo + margin engine)

Shipping packages get carrier labels through Shippo (`lib/shipping/`). Without
`SHIPPO_API_TOKEN` the wrapper runs in mock mode with deterministic fixture
rates (same idea as the Stripe mock); live mode also requires the org's FedEx
and UPS carrier-account ids. Pricing rule: quote every eligible carrier
(+USPS for light parcels), charge the customer the highest carrier's best
rate at checkout, buy the label on the cheapest, and record the spread on the
`Shipment` row. Contents are bin-packed into the configured shipment boxes.
Staff buy/void labels and refresh tracking from `/admin/packages` or the
order detail page; a label stays voidable until the package is marked sent.

## Seasons & repeat orders

One season sells at a time (Settings → Orders owns the switch). The new-season
wizard copies a prior catalog and links each old product to its copy, feeding
the replacement chains (Catalog → "Replaced by", cross-season allowed) that
repeat orders resolve through. Customers repeat from Account → Orders through a
review page that confirms replacements and recipients (discontinued items
default to the closest-priced product but must be picked or removed); staff
repeat single orders into POS drafts from the order detail page and bulk-repeat
a whole season from Customers. `opensAt`/`closesAt` schedules are fired once by
the `/api/cron/season-flip` cron and then cleared.

## Email & notifications

All outgoing email/SMS goes through one outbox (`Notification` rows). Business
code only ever enqueues (idempotent by `dedupeKey`); the sweeper cron
(`/api/cron/notification-sweeper`) delivers with retry/backoff and writes an
attempt trail. Providers are isolated wrappers: Resend (`lib/email/provider.ts`,
mock without `RESEND_API_KEY`) and Twilio-class SMS (`lib/sms/provider.ts`).
`EMAIL_TEST_MODE=true` captures everything instead of contacting providers.

The admin Email hub (`/admin/email`) manages campaigns (draft → preview →
test-send → send, reruns never duplicate), lists, subscribers, and triggered
templates (per-key subject/body overrides + enable switch). Order lifecycle
emails — confirmation, payment link when unpaid, refund notice — enqueue
inside the same transactions that finalize orders and book refunds. Settings →
Email owns sender identity, branding footer, a live test sender, and the log
retention the purge cron (`/api/cron/email-log-purge`) enforces.

## Reports, exports, reconciliation (P12)

`/admin/reports` (permission `reports.view`) has multi-season performance, per-season
drill-downs, and the shipping-margin reconciliation (charged vs paid per label).
`/admin/exports` downloads audited CSVs (deliveries, year-end, year metrics, item
sales, lapsed customers — streamed in pages) and runs Stripe payment reconciliation:
the matcher compares checkout sessions/intents against the posted payment ledger and
upserts `PaymentReconFlag` rows on unique references, so reruns (button or the
`stripe-reconciliation` cron) never duplicate a finding.

## Legacy migration

`/admin/import` → Legacy migration (permission `imports.legacy`). Entity map:
`order_number` → Order.orderNumber (blank/duplicate numbers repaired sequentially);
`order_date` → Order.finalizedAt + the "Legacy YYYY" closed season; customer columns →
Customer (dedupe on email, then normalized phone); `product_name`/`product_price` →
Product in the legacy season, `replacementId` pointed at the closest-priced active
product so repeat-order works year one; recipient/address columns → OrderLine
snapshots + CustomerAddress book entries (dedupe on the normalized key, suspect rows
land in the address review queue); `method` → FulfillmentMethod by keyword.

Dry-run writes nothing and stores a full report on a `LegacyImportRun` keyed by the
file hash. Commit runs four staged atomic transactions (catalog → customers →
addresses → orders); each stage records completion inside its own transaction, so an
interrupted commit resumes at the first missing stage when the same file is committed
again.

## Test mode & console

Test mode = no `STRIPE_SECRET_KEY` (mock money) or explicit `TEST_MODE=true`. A banner
shows on every surface; `/admin/test-console` (managers) can wipe the open season's
transactional data and reseed a demo order. Outside test mode the console page and its
API return 404. All six crons are registered in `vercel.json` and bearer-authed with
`CRON_SECRET`. Scale fixtures: `npm run db:seed-scale` (1k finalized orders / 5k
packages).

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
