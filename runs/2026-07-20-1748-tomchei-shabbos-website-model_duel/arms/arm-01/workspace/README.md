# Tomchei Shabbos Purim Project

P1 provides the deployable application shell, PostgreSQL persistence, identity
boundaries, staff authorization, first-run bootstrap, staff tooling, and audit
trail. P2 adds the schema-first domain core for seasons, catalog, customers,
orders, packages, payments, shipping records, inventory, and assembly.
P3 adds the public marketing site, current and archived catalogs, newsletter
preferences, catalog and media administration, and storefront settings.
P4 adds the cart-first order builder, saved-recipient workflow, protected
authenticated and guest drafts, and customer account pages.
P5 adds recipient-level fulfillment, greeting capture, hosted Stripe Checkout,
signed payment webhooks, offline staff payments, and final order commitment.
P6 adds the permission-aware operations dashboard, Today queue, bounded order
and customer directories, order money actions, shared-builder POS, staged CSV
imports, audit views, and live settings.
P7 materializes finalized orders into physical packages, adds the staff
fulfillment board, and persists idempotent nightly and targeted reprint PDFs.
P8 adds Shippo rate shopping, margin capture, shipment planning, labels, address
validation, and tracking. P9 adds delivery routes, scoped driver magic links,
confirmed map reroutes, pickup operations, and bulk scheduling.
P10 adds forward replacement chains, reviewed customer and staff repeats,
bounded bulk repeats, a new-season cloning wizard, and scheduled status changes.
P11 adds Resend-backed campaigns, preference lists, configurable transactional
templates, a retrying message outbox, authenticated sweep/purge crons, and test capture.

## Local development

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Run `npm run db:deploy` and `npm run db:seed`.
3. Run `npm run dev -- -p 3101`.
4. Open `/setup` once to create the first manager, then use `/admin`.

Clerk activates when both Clerk environment variables are present. Without
them, non-production builds use the local identity adapter for smoke testing.

## Quality gates

- `npm run ci`
- `npm run build`
- `npm run smoke:concurrency`
- `npm run smoke:p7`
- `npm run smoke:p8`
- `npm run smoke:p9`
- `npm run smoke:p10`
- `npm run smoke:p11`
- `npm run smoke:p12`

The project uses one pattern per concern: server components for reads, route
handlers for mutations, Prisma for persistence, Tailwind tokens for styling,
and native `node:test` through `tsx` for unit tests.

## P1 routes

- `/` branded foundation page
- `/setup` one-time manager bootstrap
- `/admin` permission-gated operations shell
- `/admin/staff` staff, role, override, revocation, and impersonation tooling
- `/driver` isolated driver route group
- `/api/health` environment and database health

## P2 domain core

- Package grouping uses recipient, normalized address, fulfillment method, and
  greeting as its stable key.
- Order finalization claims per-season sequential numbers in serializable
  transactions and retries serialization conflicts.
- Inventory reservation uses one guarded database update, so the final unit
  cannot be claimed twice.
- Package stage changes use optimistic versions and write package-level audits.
- BOM and assembly-batch records are schema-only; no P2 business UI is exposed.

## P3 storefront and catalog

- `/`, `/catalog`, `/catalog/[productId]`, and `/collections` provide the
  responsive, season-aware storefront.
- `/order` enforces the current season and configured delivery ZIPs on the
  server; the cart builder remains intentionally deferred to P4.
- `/newsletter/preferences` uses signed 30-day HMAC links.
- `/admin/catalog`, `/admin/media`, and `/admin/settings` provide catalog CRUD,
  add-on/replacement shells, restricted media uploads, and live store settings.
- Production media uses Vercel Blob through `BLOB_READ_WRITE_TOKEN`. Local smoke
  mode stores validated image payloads in the media table when test auth is on.

## P4 cart and customer account

- `/order` provides inventory-aware product cards, options, restricted add-ons,
  autosave, three-way recipient assignment, desktop cart sidebar, and mobile FAB.
- New recipients are validated and deduplicated into one customer address book;
  customer edits enforce ownership and staff edits write an audit event.
- Authenticated drafts are scoped to the linked customer. Guest drafts use an
  expiring random access token and return 404 without the matching token.
- `/account`, `/account/orders/[orderId]`, `/account/profile`, and
  `/account/addresses` expose ownership-enforced customer account views.
- P4 stops before payment capture and fulfillment commitment.

## P5 checkout and payments

- `/checkout/[draftId]` collects fulfillment, manager-configured delivery day,
  default and recipient greetings, and an optional donation.
- Bulk delivery charges once per destination; per-package delivery charges per
  recipient and cannot bypass the configured delivery-ZIP list.
- `/api/checkout/stripe` revalidates live prices and stock, then redirects to
  hosted Stripe Checkout with automatic capture. Local test auth uses the
  production-disabled `/checkout/test` stand-in when Stripe keys are absent.
- Signed Stripe webhooks are idempotent, commit stock once, assign the seasonal
  order number, trigger confirmation once, synchronize refunds, and safety-refund
  a charge when the paid order became stale.
- Staff with `payments:manage` may post and void cash/check payments with audit
  entries. Public checkout accepts Stripe only.
- Live Shippo rates remain deferred to P8; P5 stores deterministic placeholder
  rate snapshots so later fulfillment changes do not alter the paid total.

## P6 admin operations

- `/admin`, `/admin/today`, and `/admin/orders` provide bounded operational
  queues, KPIs, filters, pagination, bulk repeat, detail, refund, and audit.
- `/admin/pos` reuses the cart-first builder with customer find-or-create and
  staff-attributed cash/check payment.
- `/admin/customers` provides a bounded directory, address book, and order
  history. `/admin/imports` stages customer/product CSVs and blocks atomic
  commits until duplicates and invalid rows are corrected.
- `/admin/settings` persists Orders, Shipping, Email, and Developer values.
- `npm run smoke:p6` verifies S1-S4, including 1,000 orders and 5,000 packages.

## P7 package fulfillment

- `/admin/fulfillment` provides channel production summaries, package split and
  regroup controls, audited per-package and bulk status actions, and print jobs.
- Finalization materializes packages with the P2 recipient/address/method/greeting
  key. Regrouped source packages remain stored with their package audit history.
- Nightly batches are idempotent by date. Each fulfillment-method filing group
  receives slips, labels, and greeting-card PDFs; each order receives a packing slip.
- Filing-group and order reprints create isolated artifacts. PDF generation never
  changes `NEW`, `PRINTED`, `PACKED`, `SENT`, or `PICKED_UP` package stages.

## P9 delivery and pickup

- `/admin/delivery` builds Mapbox-geocoded routes, reassigns drivers, confirms
  nearby shipping reroutes, schedules bulk delivery, and runs pickup/follow-up desks.
- `/driver/routes/[token]` exposes only one route through a hashed, expiring
  magic link with optional throttled PIN, Google Maps stop links, and delivered-tap audit.
- Shipping/delivery switches preserve paid totals and void any unshipped label.
- Route print views contain the complete stop list and per-stop greeting cards.
- Pickup readiness is inventory-gated and idempotently notifies customers.
- Pickup-expiry and payment-reminder cron routes require `CRON_SECRET`.

## P10 seasons and repeat orders

- Customer and staff repeat flows stop on a review page until replacements and
  saved recipients are both confirmed; unmapped products must be chosen or removed.
- Catalog replacements point only into later seasons and resolve across chains.
- Bulk repeat creates current-season drafts only when every product and recipient
  resolves without staff judgment; conflicts remain explicit.
- The settings wizard clones catalog and operating setup with zero stock, closes
  the new current season, and maps the prior catalog forward.
- Manual Open/Closed changes and scheduled flips are audited. The storefront
  applies due flips lazily; `/api/cron/season-status` provides the bearer-auth sweep.

## P11 email and notifications

- `/admin/email` provides campaign drafts, preference lists, test sends,
  transactional template overrides, and recent outbox status.
- Confirmation, payment-link, refund, delivery, pickup, and SMS events use one
  idempotent transactional outbox with retry history.
- `/api/cron/message-outbox` claims work with PostgreSQL `SKIP LOCKED`;
  `/api/cron/message-log-purge` removes eligible logs while retaining outbox and audit rows.
- Resend is isolated in `src/lib/resend.ts`; test mode records captures without
  contacting Resend or the configured SMS provider.

## P12 launch readiness

- `/admin/reports` provides multi-season KPIs, item and fulfillment drill-downs,
  package-level shipping margin, five audited streaming CSV datasets, and Stripe
  reconciliation with durable idempotent findings.
- Historical JSON imports follow `docs/LEGACY-ENTITY-MAP.md`: dry-run validation,
  checkpoint resume, deterministic order-number repair, normalized customer and
  address dedupe, one serializable commit, and a staff review queue.
- The local-only test console seeds or resets the 1,000-order / 5,000-package
  dress-rehearsal fixture. Production returns 404 for destructive operations.
- A persistent TEST MODE banner and guided order, fulfillment, delivery, and
  reporting tours make environment state and launch procedures visible.
- `vercel.json` registers season, pickup, payment reminder, outbox, purge, and
  Stripe reconciliation jobs; every route requires `CRON_SECRET`.
