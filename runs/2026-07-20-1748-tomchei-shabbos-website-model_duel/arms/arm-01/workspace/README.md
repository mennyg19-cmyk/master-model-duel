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
