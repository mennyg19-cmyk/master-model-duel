# Codebase inventory — arm-06 (data)

Partial inventory for the **data** slice only: persistence, schemas, migrations, files/blob storage, caching. A merge agent unions this with the other slices.

## Proof-of-read

- Rules files read: 5 (`vocabulary.mdc`, `clean-code.mdc`, `ponytail.mdc`, `workflow.mdc`, `codegraph.mdc`) + arm `AGENTS.md` + spawn prompt
- Top-level dirs sampled: `prisma/`, `src/server/`, `src/features/` (23 modules), `src/app/api/` (incl. cron + webhooks), `src/integrations/`, `src/lib/`, `scripts/` (incl. `nexternal/`), `public/`, root docs (`DATA-MIGRATION-INVENTORY.md`, `MIGRATION-PLAN.md`), `vercel.json`, `next.config.ts`, `package.json`
- Note: no `.codegraph/` index in the source tree and source is read-only (no `codegraph init` permitted) — used Read/rg fallback per `codegraph.mdc`.
- Stack: Next.js 16 + PostgreSQL + Prisma 6.19.3 + Vercel Blob 2.3.3 (`package.json`)

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | PostgreSQL + Prisma ORM persistence | `prisma/schema.prisma`, `package.json` | Single Postgres datasource; Prisma client generated on postinstall/build. |
| F-002 | Prisma client singleton | `src/server/db.ts` | Reuses client across dev hot reloads; query logging in dev, errors-only in prod. |
| F-003 | Normalized relational schema (~40 models, 20 enums) | `prisma/schema.prisma` | Money always integer cents; sections: identity, catalog, order tree, shipping, inventory, payments, email, settings. |
| F-004 | Migration-managed schema evolution (7 migrations) | `prisma/migrations/20260603000000_init/`, `…/20260603160000_review_round1_fixes/`, `…/20260607000000_shipment_label_fields/`, `…/20260607010000_reconciliation_report/`, `…/20260607160000_reconciliation_truncated/`, `…/20260611000000_draft_numbers/`, `…/20260611120000_export_log/` | Every schema change ships as a SQL migration; `migration_lock.toml` pins Postgres. |
| F-005 | CI gate: schema change requires a migration | `scripts/check-schema-has-migration.mjs`, `package.json` (`check-schema-migration`) | Fails the build if `schema.prisma` changed without a new migration; blocks `db push` in prod. |
| F-006 | Raw SQL CHECK constraints beyond Prisma | `prisma/migrations/20260603000000_init/migration.sql` | `num_nonnulls` XOR on inventory targets (exactly one of productId/addOnId); non-negative money on `Order`. |
| F-007 | Normalized order tree with price snapshots | `prisma/schema.prisma` (`Order`, `OrderLine`, `OrderLineAddOn`, `FulfillmentGroup`, `FulfillmentLine`) | Unit-price/option/add-on snapshots with `snapshotSource` (live/import/manual); donation lines exempt from fulfillment. |
| F-008 | Sequence tables for order/draft numbers | `prisma/schema.prisma` (`OrderNumberSequence`, `DraftNumberSequence`), `src/features/orders/server/finalizeOrder.ts` | Per-season order numbers and global `D-####` draft refs claimed inside transactions — no collisions, drafts never burn real numbers. |
| F-009 | Cached derived `paymentStatus` column | `prisma/schema.prisma` (`Order.paymentStatus`), `src/features/payments/server/recalcOrderPayment.ts` | Denormalized for fast list filtering; recomputed whenever payments change. |
| F-010 | Stripe-mirrored payment rows | `prisma/schema.prisma` (`PaymentIntent`, `Payment`, `Refund`) | Unique `stripePaymentIntentId`/`stripeRefundId` make duplicate webhooks physically unable to double-credit. |
| F-011 | Webhook idempotency claim table | `src/features/payments/server/webhookIdempotency.ts`, `prisma/schema.prisma` (`ProcessedWebhookEvent`) | Unique (provider, eventId); P2002 = replay, skip processing. |
| F-012 | Persisted Stripe reconciliation reports | `prisma/schema.prisma` (`ReconciliationReport`), `prisma/migrations/20260607160000_reconciliation_truncated/migration.sql`, `src/features/reconciliation/server/actions.ts` | Report-only (never changes money); discrepancy JSON + `truncated` flag when Stripe paging cap hit. |
| F-013 | Durable outbox for side effects | `src/server/outbox.ts`, `prisma/schema.prisma` (`OutboxEvent`) | Events enqueued in the same transaction as the change; retry with linear backoff, give up after 10 attempts. |
| F-014 | Outbox drain: inline + cron sweep | `src/server/outbox.ts` (`drainOutboxForEntity`), `src/app/api/cron/outbox-sweep/route.ts`, `vercel.json` | Inline drain for snappy UX; nightly sweep (50/batch) as safety net. |
| F-015 | Email send idempotency (SentEmail dedupe) | `prisma/schema.prisma` (`SentEmail`), `src/features/email/server/dispatchEmail.ts` | Unique (templateKey, dedupeKey) — production emails never sent twice. |
| F-016 | Test-mode email capture + purge cron | `prisma/schema.prisma` (`EmailLog`), `src/app/api/cron/purge-email-log/route.ts`, `vercel.json` | Test env logs instead of sending; nightly purge with retention window. |
| F-017 | Staff audit log | `prisma/schema.prisma` (`AuditLog`) | Records actor, optional impersonated user, action, entity, JSON details. |
| F-018 | Cron/job run observability log | `prisma/schema.prisma` (`JobRun`) | Name, start/finish, status, count, error per job run. |
| F-019 | DB-backed rate limiting | `src/server/withPublicGuard.ts`, `prisma/schema.prisma` (`RateLimitBucket`) | Atomic upsert per IP bucket; works across serverless instances, no new vendor. Wraps every public API route. |
| F-020 | Key-value settings store | `prisma/schema.prisma` (`Setting`), `src/config/settings.ts` | DB-backed `SETTING_DEFS` seeded idempotently. |
| F-021 | Unified per-season inventory (products + add-ons) | `prisma/schema.prisma` (`InventoryItem`) | One table, one row per season per product OR add-on; CHECK enforces XOR — structurally forbids the old add-on asymmetry bug. |
| F-022 | Optimistic concurrency on stock updates | `prisma/schema.prisma` (`InventoryItem.version`), `src/features/inventory/server/reserve.ts`, `src/features/inventory/server/writeoff.ts` | Compare-and-set UPDATEs against `version`. |
| F-023 | Inventory reservation lifecycle rows | `prisma/schema.prisma` (`InventoryReservation`) | waiting_on_production → reserved → consumed/released; binds stock to fulfillment lines or order-line add-ons (XOR CHECK). |
| F-024 | Production batch + write-off audit tables | `prisma/schema.prisma` (`ProductionBatch`, `WriteOff`) | Quantity, notes, createdBy per event, per season. |
| F-025 | Vercel Blob media library | `prisma/schema.prisma` (`MediaUpload`), `src/app/api/media/route.ts` | Blob URL stored per upload; products/add-ons reference via `imageMediaId` (SetNull on delete). |
| F-026 | Staff media upload API with validation | `src/app/api/media/route.ts` | jpeg/png/gif/webp only, 2MB max, filename sanitized, `products.edit` permission. |
| F-027 | Media delete (blob + row) | `src/app/api/media/[id]/route.ts` | Deletes Vercel Blob then the DB row; row delete proceeds even if blob delete fails. GET redirects to blob URL. |
| F-028 | next/image allowlist for blob host | `next.config.ts` | `*.public.blob.vercel-storage.com` remote pattern. |
| F-029 | Legacy product-image backfill to Blob | `scripts/link-old-product-images.ts` | One-off script linking old images into Vercel Blob / MediaUpload. |
| F-030 | On-demand CSV exports with audit log (no file storage) | `src/features/exports/server/exportResponse.ts`, `prisma/schema.prisma` (`ExportLog`), `src/app/api/export/` (deliveries, item-sales, lapsed-customers, year-end, year-metrics) | Files aren't stored — re-run for fresh data; each download logged (kind, rowCount, who). |
| F-031 | Static image assets | `public/images/` | Repo-committed static files served by Next. |
| F-032 | Staged import pipeline (stage → validate → commit) | `src/features/imports/server/batchEngine.ts`, `prisma/schema.prisma` (`ImportBatch`, `ImportBatchRow`) | All kinds (products, orders, customers, add-ons, inventory) through one engine; FK pre-check, all-or-nothing commit transaction, per-kind ordering (products before orders). |
| F-033 | Legacy Nexternal import scripts | `scripts/nexternal/customers/`, `scripts/nexternal/historical/`, `scripts/nexternal/products/`, `scripts/nexternal/shared/excel.ts` | CLI importers for customers, historical orders (Excel/CSV), products; address/customer/product matching; npm scripts `import:*`. |
| F-034 | Test-database runner for safe imports | `scripts/nexternal/shared/runWithTestDb.ts`, `scripts/reset-test-db.ts` | Swaps `DATABASE_URL` from `.env.test-branch` (password masked in logs) so imports dry-run against a test branch; admin wipe/seed routes too (`src/app/api/admin/`). |
| F-035 | Documented old→new data migration plan | `DATA-MIGRATION-INVENTORY.md`, `MIGRATION-PLAN.md` | Entity-by-entity migration map (waves, field renames, defaults) cross-audited by 5 models. |
| F-036 | Idempotent seed scripts | `prisma/seed.ts`, `scripts/seed-test-season.ts` | Upsert-based dev seed (season, fulfillment methods, settings, email defaults, dev user) + fake-season test data generator. |
| F-037 | DB-backed geocode cache with TTLs | `prisma/schema.prisma` (`GeocodeCache`), `src/features/shipping/server/geocode.ts` | One row per normalized address shared across groups; 7-day success TTL, 6-hour failure TTL with `retryAfter`. |
| F-038 | Outbox-triggered geocode refresh | `src/server/outbox.ts` (`geocode_refresh` handler), `src/features/shipping/server/geocodeRefresh.ts` | Saved-address re-geocoding queued as durable event. |
| F-039 | Next.js path revalidation after mutations | `src/features/products/server/productActions.ts`, `src/features/fulfillment/server/routeActions.ts`, `src/features/fulfillment/server/shipmentActions.ts`, `src/features/imports/server/actions.ts`, `src/features/settings/server/actions.ts` (+10 more server-action modules) | `revalidatePath` called in ~15 action files; no `use cache`/Redis — DB tables are the cache layer elsewhere. |
| F-040 | Short-lived shipping-quote cache rows | `prisma/schema.prisma` (`ShippingQuote`, `ShippingQuoteOption`) | Quote bundles with `expiresAt`; checkout accepts only real unexpired option rows ("unknown rate ships free" fix). |

## Blocked areas

None. Source tree fully readable; no `.codegraph/` index (read-only tree, init not permitted) — used documented Read/rg fallback.
