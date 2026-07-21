# Codebase inventory — arm-03 (job: data)

## Proof-of-read
- Rules files read: 5 (ponytail, clean-code, workflow, vocabulary, codegraph)
- Top-level dirs sampled: prisma/, src/server/, src/app/api/, src/features/, src/config/, scripts/, package.json
- Focus: persistence, schemas, migrations, files/blob storage, caching

## Features
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | PostgreSQL + Prisma ORM client singleton | `prisma/schema.prisma`; `src/server/db.ts`; `package.json` | `provider = "postgresql"`; hot-reload-safe `PrismaClient` singleton |
| F-002 | Normalized domain schema (identity, catalog, orders, shipping, inventory, payments, email, infra) | `prisma/schema.prisma` | Full model/enum set; money as integer cents |
| F-003 | Prisma migration history (7 migrations) | `prisma/migrations/`; `prisma/migrations/migration_lock.toml` | init → review fixes → shipment labels → reconciliation → draft numbers → export log |
| F-004 | SQL CHECK constraints beyond Prisma | `prisma/migrations/20260603000000_init/migration.sql` | One-target inventory/production/writeoff/reservation; nonneg money/qty |
| F-005 | Schema-change requires co-located migration (CI gate) | `scripts/check-schema-has-migration.mjs`; `package.json` (`check-schema-migration`) | Fails if `schema.prisma` changed without new `prisma/migrations/` |
| F-006 | On-demand migration verify against disposable schema | `scripts/test-migration.mjs` | Applies migrations+seed; asserts expected CHECK names |
| F-007 | Dev/test seed (season, fulfillment methods, products, settings, staff) | `prisma/seed.ts`; `package.json` (`db:seed`) | Idempotent upserts |
| F-008 | Test-season seeder + wipe tooling | `scripts/seed-test-season.ts`; `src/features/testdata/server/seedTestSeason.ts`; `src/features/testdata/server/wipeTestData.ts` | Guarded by `IS_TEST_ENV`; wipe clears transactional tables |
| F-009 | Test-DB runner / reset helpers | `scripts/nexternal/shared/runWithTestDb.ts`; `scripts/reset-test-db.ts`; `src/test-support/itDatabase.ts` | Swap `DATABASE_URL` to test branch; reset utilities |
| F-010 | Vercel Blob media upload + `MediaUpload` rows | `src/app/api/media/route.ts`; `prisma/schema.prisma` (`MediaUpload`); `package.json` (`@vercel/blob`) | POST: jpeg/png/gif/webp ≤2MB → `put()` + DB row |
| F-011 | Media library list / search API | `src/app/api/media/route.ts` | GET newest-first; optional filename `q` |
| F-012 | Media delete (blob + DB row) | `src/app/api/media/[id]/route.ts` | `del()` from `@vercel/blob` then `mediaUpload.delete` |
| F-013 | Admin media picker / multi-upload UI | `src/app/(admin)/admin/media/media-actions.tsx`; `src/components/admin/media-picker.tsx` | Staff upload into library; attach to products/add-ons |
| F-014 | Product/add-on image FK to media | `prisma/schema.prisma` (`Product.imageMediaId`, `AddOn.imageMediaId`) | Storefront reads `image.blobUrl` |
| F-015 | DB-backed geocode cache (TTL) | `prisma/schema.prisma` (`GeocodeCache`); `src/features/shipping/server/geocode.ts` | 7-day success / 6-hour failure TTL; normalize-address key |
| F-016 | DB-backed public API rate limiting | `prisma/schema.prisma` (`RateLimitBucket`); `src/server/withPublicGuard.ts` | Atomic upsert per IP window across serverless instances |
| F-017 | Durable transactional outbox | `prisma/schema.prisma` (`OutboxEvent`); `src/server/outbox.ts`; `src/app/api/cron/outbox-sweep/route.ts` | Enqueue in txn; drain per entity + cron retry/backoff |
| F-018 | Staged import batches (validate → commit) | `prisma/schema.prisma` (`ImportBatch`, `ImportBatchRow`); `src/features/imports/server/batchEngine.ts` | Stage raw JSON rows; validate FKs; commit or fail |
| F-019 | Export history metadata (no file storage) | `prisma/schema.prisma` (`ExportLog`); `src/features/exports/server/exportResponse.ts`; `prisma/migrations/20260611120000_export_log/` | One row per CSV download; files not retained |
| F-020 | Cached/derived `Order.paymentStatus` column | `prisma/schema.prisma` (`PaymentStatus` comment); `src/features/payments/server/recalcOrderPayment.ts`; `src/features/payments/server/paymentMath.ts` | Recomputed from posted payments for list filters |
| F-021 | Inventory optimistic concurrency (`version`) | `prisma/schema.prisma` (`InventoryItem.version`); `src/features/inventory/server/reserve.ts`; `src/features/inventory/server/writeoff.ts` | Compare-and-set UPDATEs bump `version` |
| F-022 | Unified inventory/production/reservation persistence | `prisma/schema.prisma` (`InventoryItem`, `ProductionBatch`, `InventoryReservation`, `WriteOff`); `src/features/inventory/server/` | Products + add-ons share tables; CHECK one-target |
| F-023 | Key-value `Setting` store + typed readers | `prisma/schema.prisma` (`Setting`); `src/config/settings.ts`; `src/features/settings/server/actions.ts` | Registry-driven keys; DB overrides defaults |
| F-024 | Webhook idempotency store | `prisma/schema.prisma` (`ProcessedWebhookEvent`); `src/app/api/webhooks/stripe/route.ts` | Unique `(provider, eventId)` |
| F-025 | Sent-email dedupe persistence | `prisma/schema.prisma` (`SentEmail`); `src/features/email/server/dispatchEmail.ts` | Unique `(templateKey, dedupeKey)` before send |
| F-026 | Test-mode email capture log | `prisma/schema.prisma` (`EmailLog`); `src/features/email/server/dispatchEmail.ts`; `src/features/testdata/server/testModeActions.ts` | Production never writes; clearable in test mode |
| F-027 | Short-lived shipping quote persistence | `prisma/schema.prisma` (`ShippingQuote`, `ShippingQuoteOption`) | Checkout binds to unexpired option rows |
| F-028 | Order / draft number sequences | `prisma/schema.prisma` (`OrderNumberSequence`, `DraftNumberSequence`); `prisma/migrations/20260611000000_draft_numbers/` | Per-season order nums; global draft refs |
| F-029 | Next.js path cache revalidation after mutations | many under `src/features/*/server/*.ts` (e.g. `productActions.ts`, `customerActions.ts`) | `revalidatePath` from `next/cache` |
| F-030 | Reconciliation report persistence | `prisma/schema.prisma` (`ReconciliationReport`); `prisma/migrations/20260607010000_reconciliation_report/`; `prisma/migrations/20260607160000_reconciliation_truncated/` | Report-only Stripe vs local money diffs as JSON |
| F-031 | Job-run observability log | `prisma/schema.prisma` (`JobRun`); cron routes under `src/app/api/cron/` | Each cron records start/finish/status/count |
| F-032 | Audit log persistence | `prisma/schema.prisma` (`AuditLog`); `src/features/auth/server/audit.ts` | Staff action trail with optional impersonation |
| F-033 | Retention purge for logs / webhook / sent-email rows | `src/app/api/cron/purge-email-log/route.ts` | EmailLog 30d; SentEmail + ProcessedWebhookEvent 90d |
| F-034 | Shipment/fulfillment label URL fields persisted | `prisma/schema.prisma` (`Shipment.labelUrl`, `FulfillmentGroup.labelUrl`); `prisma/migrations/20260607000000_shipment_label_fields/` | External carrier label URLs (not Vercel Blob) |
