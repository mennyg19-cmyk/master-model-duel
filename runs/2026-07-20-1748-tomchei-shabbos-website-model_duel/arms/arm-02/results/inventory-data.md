# Codebase inventory — arm-02 (partial: DATA)

Job: **data** — database schema, migrations, seeding, imports/exports, data-layer helpers, data infrastructure.
Source (read-only): `.scratch/sources/tomche-shabbos-website`. All evidence paths are relative to that root.

## Proof-of-read

- Rules files read: 6 (`workflow`, `vocabulary`, `ponytail`, `clean-code`, `grill-protocol`, `codegraph`) + arm `AGENTS.md`
- Top-level dirs sampled: `prisma/`, `src/lib/`, `src/server/`, `src/features/` (imports, exports, testdata), `scripts/`, root docs
- Codegraph: no `.codegraph/` index in source and source is read-only (cannot `codegraph init` there) — used Read/glob fallback per codegraph.mdc "Not initialized"

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| D-001 | PostgreSQL + Prisma data layer (singleton client) | `prisma/schema.prisma`, `src/server/db.ts` | `DATABASE_URL` datasource, prisma-client-js generator |
| D-002 | Staff identity & roles (5-role enum, confirmation flow) | `prisma/schema.prisma` (StaffUser, StaffRole) | developer/admin/manager/clerk/messenger; `isConfirmed`, `defaultStore` |
| D-003 | Per-user permission overrides | `prisma/schema.prisma` (PermissionOverride) | unique (staffUserId, permissionKey), granted boolean |
| D-004 | Customer records with normalized phone/email + dedupe support | `prisma/schema.prisma` (Customer) | `phoneNormalized`/`emailNormalized` indexes, `notDuplicateOf[]`, guest flag |
| D-005 | Saved addresses with geocoding fields | `prisma/schema.prisma` (SavedAddress) | lat/long/geocodedAt, default-address flag |
| D-006 | Audit log (actor, impersonation, entity, JSON details) | `prisma/schema.prisma` (AuditLog) | indexed by userId and createdAt |
| D-007 | Season model gating catalog per year | `prisma/schema.prisma` (Season) | `isOpen`, `closedMessage`; products/add-ons FK to season |
| D-008 | Product catalog with shipping dims & inventory flags | `prisma/schema.prisma` (Product, ProductStatus, ProductKind) | integer cents, weight/dims, `maxItemsPerBox`, donation kind |
| D-009 | Product options with price adjustments | `prisma/schema.prisma` (ProductOption) | `priceAdjustmentCents` |
| D-010 | Add-ons with per-product restriction modes | `prisma/schema.prisma` (AddOn, ProductAddOn, AddOnRestrictionMode) | none/include/exclude; `producedByUs` |
| D-011 | Season-aware product replacement chain (repeat orders) | `prisma/schema.prisma` (ProductReplacement) | unique (fromProductId, seasonYear); cycle protection in domain code |
| D-012 | Media uploads stored via blob URL | `prisma/schema.prisma` (MediaUpload) | linked from Product/AddOn images |
| D-013 | Normalized order tree (Order → OrderLine → add-ons) | `prisma/schema.prisma` (Order, OrderLine, OrderLineAddOn) | money totals in cents, discount + reason, staff notes, follow-up snooze |
| D-014 | Price snapshots on order lines | `prisma/schema.prisma` (OrderLine: unitPriceCentsSnapshot, snapshotSource) | source: live/import/manual, `pricedAt` |
| D-015 | Sequential order numbers per season (transactional sequence) | `prisma/schema.prisma` (OrderNumberSequence) | one row per season year, claimed at finalize |
| D-016 | Draft reference numbers (D-0001…) via global sequence | `prisma/schema.prisma` (DraftNumberSequence, Order.draftNumber), `prisma/migrations/20260611000000_draft_numbers/migration.sql` | drafts don't burn real order numbers |
| D-017 | Cached derived payment status on orders | `prisma/schema.prisma` (PaymentStatus enum + Order.paymentStatus) | recomputed when payments change; source of truth = posted payments |
| D-018 | Fulfillment groups (multi-destination orders) with snapshots | `prisma/schema.prisma` (FulfillmentGroup, FulfillmentLine) | address, geocode, pickup deadline/reminders, shipping cost snapshot, tracking/label |
| D-019 | Data-driven fulfillment methods (category enum + editable keys) | `prisma/schema.prisma` (FulfillmentMethod, FulfillmentCategory) | replaces hardcoded shipping-method enum |
| D-020 | Shipping quotes with selectable, expiring options | `prisma/schema.prisma` (ShippingQuote, ShippingQuoteOption) | checkout can only submit a real unexpired option row |
| D-021 | Admin-defined shipping price rules (ordered, first-match) | `prisma/schema.prisma` (ShippingRule) | condition field/operator/threshold, carrier fallback noted |
| D-022 | Pickup locations | `prisma/schema.prisma` (PickupLocation) | hours, notes, active + sort |
| D-023 | Package types & shipment boxes | `prisma/schema.prisma` (PackageType, ShipmentBox) | box weights/dims, per-box tracking + cost |
| D-024 | Shipments with Shippo rate-shopping fields | `prisma/schema.prisma` (Shipment), `prisma/migrations/20260607000000_shipment_label_fields/migration.sql` | customer vs cheapest rate, savings, label purchase, void |
| D-025 | Delivery routes & ordered route stops | `prisma/schema.prisma` (DeliveryRoute, RouteStop, DeliveryRouteStatus) | messenger assignment, per-stop deliveredAt |
| D-026 | Unified inventory for products + add-ons (XOR check, versioned) | `prisma/schema.prisma` (InventoryItem) | one row per season per product OR add-on; optimistic-concurrency `version` |
| D-027 | Production batches | `prisma/schema.prisma` (ProductionBatch) | product or add-on, quantity, notes |
| D-028 | Inventory reservations with lifecycle states | `prisma/schema.prisma` (InventoryReservation, ReservationState) | waiting_on_production → reserved → released/consumed; binds to fulfillment line or add-on |
| D-029 | Inventory write-offs | `prisma/schema.prisma` (WriteOff) | per product/add-on per season |
| D-030 | Stripe PaymentIntent modeling (webhook-duplicate-proof) | `prisma/schema.prisma` (PaymentIntent) | unique stripePaymentIntentId + checkout session id |
| D-031 | Payments (stripe/cash/check/comp) with posted/voided states | `prisma/schema.prisma` (Payment, PaymentMethod, PaymentRecordStatus) | unique nullable stripePaymentIntentId = at most one credit per intent |
| D-032 | Refunds with reason/method/status + Stripe refund id | `prisma/schema.prisma` (Refund, RefundReason, RefundMethod, RefundStatus) | linked to payment and order |
| D-033 | Email subscribers with preferences & unsubscribe tracking | `prisma/schema.prisma` (EmailSubscriber, EmailPreference) | all / if_not_ordered / once_yearly |
| D-034 | Mailing lists & memberships | `prisma/schema.prisma` (MailingList, MailingListMember) | unique (list, subscriber) |
| D-035 | Email campaigns + branded templates | `prisma/schema.prisma` (EmailCampaign, EmailTemplate) | WYSIWYG `blocksJson`, brand colors/logo defaults |
| D-036 | Triggered-email overrides + sent-email idempotency + test-mode email log | `prisma/schema.prisma` (TriggeredEmailOverride, SentEmail, EmailLog) | dedupe on (templateKey, dedupeKey); EmailLog is test-mode capture only |
| D-037 | Key-value settings store with typed registry | `prisma/schema.prisma` (Setting), `src/config/settings.ts` | SETTING_DEFS registry seeded at `prisma/seed.ts` |
| D-038 | Transactional outbox with retrying sweeper | `prisma/schema.prisma` (OutboxEvent, OutboxStatus), `src/server/outbox.ts`, `src/app/api/cron/outbox-sweep/` | side effects written in-transaction, drained with retry |
| D-039 | Webhook idempotency store | `prisma/schema.prisma` (ProcessedWebhookEvent) | unique (provider, eventId), retention window |
| D-040 | Geocode cache with success/failure TTLs | `prisma/schema.prisma` (GeocodeCache) | one row per normalized address; 7-day/6-hour TTL in domain code |
| D-041 | Staged import batches (stage → validate → commit) | `prisma/schema.prisma` (ImportBatch, ImportBatchRow), `src/features/imports/server/batchEngine.ts` | per-kind validator/committer, FK pre-check, atomic all-or-nothing commit, kind ordering |
| D-042 | Import admin actions | `src/features/imports/server/actions.ts` | server actions wrapping the batch engine |
| D-043 | DB-backed rate limiting | `prisma/schema.prisma` (RateLimitBucket) | windowed counters, works across serverless instances |
| D-044 | Cron/job run log | `prisma/schema.prisma` (JobRun) | name, status, count, error |
| D-045 | Stripe reconciliation reports (report-only, truncation flag) | `prisma/schema.prisma` (ReconciliationReport), `prisma/migrations/20260607010000_reconciliation_report/migration.sql`, `20260607160000_reconciliation_truncated/migration.sql` | discrepancies JSON; never changes money |
| D-046 | Export audit log (one row per CSV download) | `prisma/schema.prisma` (ExportLog), `prisma/migrations/20260611120000_export_log/migration.sql` | kind, rowCount, createdBy; files not stored |
| D-047 | CSV export endpoints (deliveries, item sales, lapsed customers, year-end, year metrics) | `src/app/api/export/*`, `src/features/exports/server/exportResponse.ts`, `src/lib/csv.ts` | shared CSV/response helpers |
| D-048 | Idempotent dev/test seed | `prisma/seed.ts` | open season, 4 fulfillment methods, sample products/add-ons, settings, email branding, dev staff user; all upserts |
| D-049 | Test-environment data tooling (reset / seed season / wipe) | `scripts/reset-test-db.ts`, `scripts/seed-test-season.ts`, `src/features/testdata/server/` (`seedTestSeason.ts`, `wipeTestData.ts`, `generators.ts`, `testModeActions.ts`), `src/app/api/admin/reset-test-db/`, `seed-test-season/`, `wipe-test-data/` | admin test-mode endpoints |
| D-050 | Nexternal legacy import pipeline (customers, products, historical orders) | `scripts/nexternal/customers/*`, `scripts/nexternal/products/importProducts.ts`, `scripts/nexternal/historical/*`, `scripts/nexternal/shared/*` | read → plan/transform/match → commit stages; Excel parsing, matching, reports |
| D-051 | Order-number repair script for imports | `scripts/nexternal/fix-order-numbers.ts` | post-import fix-up |
| D-052 | Schema-migration guard (every schema change needs a migration) | `scripts/check-schema-has-migration.mjs`, `prisma/migrations/` (7 migrations + lock) | enforced per schema header comment |
| D-053 | Migration test harness | `scripts/test-migration.mjs` | runs migrations against a test DB |
| D-054 | Data-layer helper libraries | `src/lib/money/index.ts`, `src/lib/normalize/index.ts`, `src/lib/phone/index.ts`, `src/lib/ids/index.ts`, `src/lib/season/index.ts`, `src/lib/dates/index.ts`, `src/lib/result/` | integer-cents money, email/phone normalization, id/season/date utilities, Result type + parse; unit tests alongside |
| D-055 | Legacy→new data migration plan (documented entity map) | `DATA-MIGRATION-INVENTORY.md` | wave-ordered entity migration map; references `scripts/migrate-from-old.ts` (script itself not present in tree) |
| D-056 | Env configuration for data services | `.env.example`, `scripts/gen-env-example.ts` | DATABASE_URL etc.; example file generated from code |
| D-057 | Old product image relinking script | `scripts/link-old-product-images.ts` | connects legacy images to migrated products |

## Blocked / notes

- `scripts/migrate-from-old.ts` is referenced by `DATA-MIGRATION-INVENTORY.md` (S1) but does not exist in the source tree — listed as documentation evidence only, not an invented feature.
- No codegraph index available in the read-only source; inventory built via directory listing + targeted file reads.
