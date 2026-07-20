# Codebase inventory — arm-02 (MERGED)

Source root: `D:\Projects\Personal\Tools\agent-duel-harness\.scratch\sources\tomche-shabbos-website`
All evidence paths are relative to that source root.

## Proof-of-read

- Arm `AGENTS.md` read (contestant rules: build only in `workspace/`, no git, no cross-arm reads).
- All five partial inventories read in full:
  - `results/inventory-product.md` — 93 features (F-001..F-093)
  - `results/inventory-security.md` — 32 features (SEC-001..SEC-032)
  - `results/inventory-data.md` — 57 features (D-001..D-057)
  - `results/inventory-ui.md` — 77 features (F-UI-001..F-UI-077)
  - `results/inventory-integrations.md` — 29 features (INT-001..INT-029)
- Partial total: 288 rows. After dedup by meaning + evidence path: **165 merged features**, **2 conflicts**.

## Merge method

- No new IDs invented. Each merged row keeps one existing partial ID as primary; absorbed duplicate IDs are listed in Notes as `Merged: …`.
- Rows were merged when they describe the same feature by meaning with overlapping or directly adjacent evidence (e.g. the same page cited by the product and UI slices; a schema model cited 1:1 with its single behavior row). Schema/data rows that stand on their own (models serving many features) were kept as separate features.
- Conflicts between partials are tagged **CONFLICT** in Notes with both evidence paths.

## Features

### Storefront — browsing & marketing

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | Marketing home page (hero, how-it-works, packages grid, mission, testimonials, CTAs) | src/app/(storefront)/page.tsx | Merged: F-UI-001 |
| F-002 | Animated impact-stats bar on home page | src/components/storefront/home-impact-bar.tsx | Merged: F-UI-002 |
| F-003 | Packages catalog page with grid + loading skeleton | src/app/(storefront)/packages/page.tsx; src/app/(storefront)/packages/packages-grid.tsx; src/app/(storefront)/packages/loading.tsx | Merged: F-UI-008 |
| F-004 | Package detail page | src/app/(storefront)/packages/[id]/page.tsx | Merged: F-UI-009 |
| F-005 | Product quick-view dialog (storefront) | src/components/storefront/product-quick-view.tsx | Merged: F-UI-010; builder-side quick view under F-UI-012 |
| F-006 | Past collections page | src/app/(storefront)/past-collections/page.tsx | Merged: F-UI-026 |
| F-007 | Store open/closed gate with configurable closed message + storefront banner | src/features/storefront/server/storeStatus.ts; src/app/(storefront)/order/page.tsx; src/app/(storefront)/layout.tsx | Merged: F-UI-004 (banner) |
| F-008 | Email newsletter subscribe (footer form + API) | src/components/storefront/email-subscribe.tsx; src/app/api/subscribe/route.ts; src/features/email/server/upsertSubscriber.ts | Merged: F-UI-007; subscribe half of INT-012 |
| F-009 | One-click unsubscribe (tokenized page + HMAC-signed tokens, timing-safe verify) | src/app/(storefront)/unsubscribe/page.tsx; src/app/(storefront)/unsubscribe/unsubscribe-form.tsx; src/app/api/unsubscribe/route.ts; src/features/email/server/unsubscribeToken.ts | Merged: F-UI-027, SEC-022, INT-012 |
| F-010 | First-run setup page (bootstrap; only works on empty staff table) | src/app/(storefront)/setup/page.tsx; src/app/api/setup/route.ts | Merged: F-UI-028, SEC-024 (409 no-op once any StaffUser exists) |
| F-011 | Mobile sheet menu + signed-in user menu (staff link when staff) | src/components/storefront/mobile-menu.tsx; src/components/storefront/user-menu.tsx | Merged: F-UI-005, F-UI-006 |
| F-012 | Test-mode banner on storefront | src/components/storefront/test-mode-banner.tsx | Merged: F-UI-029 |
| F-UI-003 | Storefront shell: sticky glass header, brand, desktop nav, auth CTAs, 3-column footer | src/app/(storefront)/layout.tsx; src/lib/brand.ts | UI slice only |

### Storefront — order builder

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-013 | Multi-recipient order builder (shared storefront/POS shell) | src/app/(storefront)/order/page.tsx; src/app/(storefront)/order/order-builder.tsx; src/features/order-builder/components/OrderBuilderShell.tsx | Merged: F-UI-011 |
| F-UI-012 | Order builder product panel + product cards + in-builder quick view | src/features/order-builder/components/ProductPanel.tsx; src/features/order-builder/components/ProductCard.tsx; src/features/order-builder/components/ProductQuickView.tsx | UI slice only |
| F-014 | Draft autosave + resume (`?draft=ID` or latest web draft); guest draft cleared on success | src/features/order-builder/components/AutoSave.tsx; src/features/orders/server/saveDraft.ts; src/features/orders/server/loadDraft.ts; src/features/order-builder/components/ClearGuestDraftOnSuccess.tsx | Merged: F-UI-016 |
| F-015 | Add / manage recipients, assign packages to recipients | src/features/order-builder/components/AddRecipientDialog.tsx; src/features/order-builder/components/RecipientAssignDialog.tsx; src/features/order-builder/orderDraftReducer.ts | Merged: F-UI-014 |
| F-016 | Saved addresses inside builder ("myself" default, edit dialog) | src/features/customers/server/savedAddresses.ts; src/features/order-builder/components/EditSavedAddressDialog.tsx | Merged: F-UI-015 |
| F-017 | Address autocomplete (Mapbox) + server-side address validation (USPS placeholder, format-checks only) | src/components/ordering/address-autocomplete.tsx; src/components/ordering/address-fields.tsx; src/app/api/addresses/validate/route.ts | Merged: F-UI-017, INT-018 (works without NEXT_PUBLIC_MAPBOX_TOKEN), INT-020 (USPS_USER_ID declared but unused) |
| F-018 | Add-ons with per-product restriction modes (none/include/exclude) | src/features/order-builder/catalog.ts; src/features/products/server/addOnActions.ts; prisma/schema.prisma (AddOn, ProductAddOn, AddOnRestrictionMode) | Merged: D-010 |
| F-019 | Live stock awareness in builder (product kind + stock) | src/app/(storefront)/order/page.tsx; src/features/inventory/server/reserve.ts | |
| F-020 | Order sidebar (cart) + mobile cart FAB | src/features/order-builder/components/OrderSidebar.tsx; src/features/order-builder/components/MobileCartFab.tsx | Merged: F-UI-013 |

### Checkout & payments

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-021 | Checkout page: ownership guard (signed-in match or guest token), per-recipient summary, shipping quotes, payment choice | src/app/(storefront)/checkout/page.tsx; src/features/orders/server/orderAccess.ts; src/features/checkout/server/checkoutToken.ts; src/features/checkout/components/CheckoutClient.tsx | Merged: F-UI-018 (shared web/POS modes) |
| F-022 | Card payment via Stripe hosted Checkout Session (finalization deferred to webhook; discounts via Stripe coupons) | src/app/api/checkout/route.ts; src/features/checkout/components/CheckoutClient.tsx | Merged: INT-004. See CONFLICT at INT-029 |
| F-023 | Offline payment checkout (cash/check) when enabled in settings | src/app/api/checkout/offline/route.ts; src/app/(storefront)/checkout/page.tsx; src/features/orders/server/adminPayments.ts | Merged: INT-008 (coexists with Stripe records in payment math) |
| F-024 | Price snapshot + checkout validation (issues surfaced before pay) | src/features/checkout/server/checkoutValidation.ts; src/features/checkout/server/pricing.ts | Snapshot storage under D-014 |
| F-025 | Shipping rate calculation at checkout | src/features/checkout/shippingRates.ts; src/features/checkout/server/shipping.ts | Quote persistence under D-020 |
| F-026 | Checkout success page | src/app/(storefront)/checkout/success/page.tsx | Merged: F-UI-019 |
| F-027 | Payment recalculation on order changes | src/features/payments/server/recalcOrderPayment.ts; src/features/payments/server/paymentMath.ts | Keeps paid/due amounts consistent |

### Customer account

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-028 | Account dashboard + sub-nav layout | src/app/(storefront)/account/page.tsx; src/app/(storefront)/account/layout.tsx | Merged: F-UI-020 |
| F-029 | Order history + order detail | src/app/(storefront)/account/orders/page.tsx; src/app/(storefront)/account/orders/[id]/page.tsx | Merged: F-UI-021 |
| F-030 | Cancel own draft order | src/app/(storefront)/account/orders/[id]/cancel-draft-button.tsx; src/features/orders/server/cancelOwnDraft.ts | Merged: F-UI-022 |
| F-031 | Repeat a past order (customer self-serve, review screen) | src/app/(storefront)/account/orders/[id]/repeat/page.tsx; src/features/orders/server/repeat/repeatOrder.ts; src/features/orders/server/repeat/buildRepeatPlan.ts; src/components/ordering/repeat-review.tsx | Merged: F-UI-023 |
| F-032 | Profile editing (API enforces clerkUserId ownership) | src/app/(storefront)/account/profile/profile-form.tsx; src/app/(storefront)/account/profile/page.tsx; src/app/api/account/profile/route.ts | Merged: F-UI-024, SEC-023 |
| F-033 | Saved addresses management page | src/app/(storefront)/account/addresses/page.tsx | Merged: F-UI-025; schema under D-005 |

### Order lifecycle (shared business rules)

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-034 | Order status state machine (draft → confirmed → fulfilled; cancellable) | src/features/orders/server/orderStateMachine.ts; src/features/orders/server/transitionOrder.ts | PLACED_ORDER_STATUSES drives inventory/reports/repeat |
| F-035 | Order finalization (draft becomes placed order) | src/features/orders/server/finalizeOrder.ts | Claims number from D-015 sequence |
| F-036 | Draft discard | src/features/orders/server/discardDraft.ts | |
| F-037 | Draft reference numbers (D-0001…, global sequence) + number scheme on the wire | src/features/orders/draftWire.ts; prisma/schema.prisma (DraftNumberSequence, Order.draftNumber); prisma/migrations/20260611000000_draft_numbers/migration.sql | Merged: D-016 (drafts don't burn real order numbers) |
| F-038 | Product replacement chains (this year's item = last year's item) | src/app/(admin)/admin/products/[id]/replacement-editor.tsx; src/app/(admin)/admin/products/[id]/page.tsx; src/features/orders/server/repeat/replacementChain.ts; src/features/orders/server/repeat/matcher.ts; prisma/schema.prisma (ProductReplacement) | Merged: F-UI-048, D-011 (unique (fromProductId, seasonYear); cycle protection) |

### Admin — operations hub

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-039 | Admin dashboard with stats | src/app/(admin)/admin/page.tsx; src/features/orders/server/dashboardStats.ts | Merged: F-UI-032 |
| F-040 | "Today" work queue — 8 permission-gated action cards | src/app/(admin)/admin/today/page.tsx; src/features/today/server/workQueue.ts | Merged: F-UI-033 (confirm, pickups, labels, dispatch, routes, shortfall, calls, staff alerts) |
| F-041 | Orders list with search | src/app/(admin)/admin/orders/page.tsx; src/app/(admin)/admin/orders/orders-search-bar.tsx | Merged: F-UI-034 |
| F-042 | Order detail with money actions (record/remove payment) | src/app/(admin)/admin/orders/[id]/page.tsx; src/app/(admin)/admin/orders/[id]/order-money-actions.tsx; src/features/orders/server/adminPayments.ts | Merged: F-UI-035; shipment actions under F-060 |
| F-043 | Refunds (incl. Stripe refund path) | src/features/refunds/server/createRefund.ts; src/features/refunds/server/createRefund.integration.test.ts; prisma/schema.prisma (Refund, RefundReason, RefundMethod, RefundStatus) | Merged: INT-006, D-032 |
| F-044 | Packing slip print view | src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx; src/components/admin/print-button.tsx | Merged: F-UI-036 |
| F-045 | Admin repeat of a single order | src/app/(admin)/admin/orders/[id]/repeat/page.tsx | Merged: F-UI-037 (single-order part) |
| F-046 | Bulk repeat of last season's orders | src/app/(admin)/admin/orders/repeat-bulk/page.tsx; src/app/(admin)/admin/orders/repeat-bulk/bulk-repeat-form.tsx | Merged: F-UI-037 (bulk part) |
| F-047 | POS: staff order builder with customer search / walk-in / new customer + staff notes | src/app/(admin)/admin/pos/page.tsx; src/app/(admin)/admin/pos/pos-builder.tsx | Merged: F-UI-038 (shared builder shell, source "pos") |
| F-048 | POS checkout | src/app/(admin)/admin/pos/checkout/[orderId]/page.tsx | Merged: F-UI-039 (reuses CheckoutClient in pos mode) |
| F-049 | Customer directory (search, add customer, find-or-create API) | src/app/(admin)/admin/customers/page.tsx; src/app/(admin)/admin/customers/customer-search.tsx; src/app/(admin)/admin/customers/add-customer-dialog.tsx; src/app/api/customers/search/route.ts; src/app/api/customers/find-or-create/route.ts | Merged: F-UI-041 |
| F-050 | Customer detail page (edit, history) | src/app/(admin)/admin/customers/[id]/page.tsx; src/app/(admin)/admin/customers/[id]/customer-detail-client.tsx; src/features/customers/server/customerActions.ts | Merged: F-UI-042 |
| F-051 | CSV customer import: dialog + staged batch engine (stage → validate → commit, atomic) | src/components/admin/csv-import-dialog.tsx; src/features/imports/server/batchEngine.ts; src/features/imports/server/actions.ts; prisma/schema.prisma (ImportBatch, ImportBatchRow) | Merged: F-UI-068, D-041, D-042 (per-kind validator/committer, FK pre-check, kind ordering) |

### Admin — catalog & inventory

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-052 | Product management (list, create, edit, detail, season assignment) | src/app/(admin)/admin/products/page.tsx; src/app/(admin)/admin/products/product-form.tsx; src/app/(admin)/admin/products/product-actions.tsx; src/app/(admin)/admin/products/new/page.tsx; src/app/(admin)/admin/products/[id]/edit/page.tsx; src/app/(admin)/admin/products/season-select.tsx; src/features/products/server/productActions.ts | Merged: F-UI-047 |
| F-053 | Add-on management | src/app/(admin)/admin/addons/page.tsx; src/app/(admin)/admin/addons/addon-actions.tsx | Merged: F-UI-049 |
| F-054 | Media library (Vercel Blob): upload/manage, "needs photos" panel, media picker, legacy image relink | src/app/(admin)/admin/media/page.tsx; src/app/(admin)/admin/media/needs-photos-panel.tsx; src/app/api/media/route.ts; src/app/api/media/[id]/route.ts; src/components/admin/media-picker.tsx; prisma/schema.prisma (MediaUpload); scripts/link-old-product-images.ts | Merged: F-UI-050, INT-022 (put(), jpeg/png/gif/webp max 2MB, BLOB_READ_WRITE_TOKEN), D-012, D-057 |
| F-055 | Inventory dashboard (overview + production tabs) | src/app/(admin)/admin/inventory/page.tsx; src/app/(admin)/admin/inventory/inventory-tabs.tsx; src/features/inventory/server/dashboard.ts | Merged: F-UI-051 (also covers F-056 UI) |
| F-056 | Production batch recording + history (daily batch dialog) | src/app/(admin)/admin/inventory/daily-batch-dialog.tsx; src/app/(admin)/admin/inventory/production-history.tsx; src/features/inventory/server/production.ts; prisma/schema.prisma (ProductionBatch) | Merged: D-027 |
| F-057 | Stock reserve / allocate / release engine with reservation lifecycle states | src/features/inventory/server/reserve.ts; src/features/inventory/server/allocate.ts; src/features/inventory/server/release.ts; prisma/schema.prisma (InventoryReservation, ReservationState) | Merged: D-028 (waiting_on_production → reserved → released/consumed); integration-tested |
| F-058 | Shortfall detection and write-offs | src/features/inventory/server/shortfall.ts; src/features/inventory/server/writeoff.ts; prisma/schema.prisma (WriteOff) | Merged: D-029; feeds Today page production card |

### Admin — fulfillment & delivery

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-059 | Fulfillment overview by channel (pickups / local deliveries / shipments) with status counts + actions | src/app/(admin)/admin/fulfillment/page.tsx; src/features/fulfillment/server/fulfillmentPool.ts; src/app/(admin)/admin/fulfillment/channel-action-button.tsx | Merged: F-UI-052 |
| F-060 | Carrier shipment labels: Shippo rating, label purchase/void, label fields | src/features/fulfillment/server/shipmentActions.ts; src/features/shipping/server/shipmentPlanning.ts; src/app/(admin)/admin/orders/[id]/shipment-actions.tsx; prisma/schema.prisma (Shipment); prisma/migrations/20260607000000_shipment_label_fields/migration.sql | Merged: INT-015 (ship-from via SHIP_FROM_* env), D-024 (customer vs cheapest rate, savings) |
| F-061 | Shipment planning with bin packing into package types | src/features/shipping/server/binPacking.ts; src/features/shipping/server/shipmentPlanning.ts | Package type schema under D-023 |
| F-062 | Shipping rules engine + carrier rate resolution (flat vs calculated; usps_/ups_/fedex_/shippo_ prefixes) | src/features/shipping/server/ruleEngine.ts; src/features/shipping/server/rateResolution.ts; prisma/schema.prisma (ShippingRule) | Merged: INT-016 (shared by checkout, POS, finalization), D-021 (ordered, first-match rules) |
| F-063 | Delivery route builder (Mapbox GL map, geocoded stops, coordinate refresh) | src/app/(admin)/admin/fulfillment/build-route/route-builder.tsx; src/app/api/route-builder/refresh-coords/route.ts; src/features/shipping/server/geocode.ts | Merged: F-UI-053, INT-019 |
| F-064 | Route management: list, detail, reassign driver, print manifest | src/app/(admin)/admin/routes/page.tsx; src/app/(admin)/admin/routes/[id]/page.tsx; src/app/(admin)/admin/routes/[id]/reassign-button.tsx; src/app/(admin)/admin/routes/[id]/print/page.tsx; src/features/fulfillment/server/routeActions.ts; prisma/schema.prisma (DeliveryRoute, RouteStop, DeliveryRouteStatus) | Merged: F-UI-054, F-UI-055 (print part), D-025 |
| F-065 | Greeting cards print view per route | src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx | Merged: F-UI-055 (greeting-cards part) |
| F-066 | Messenger (driver) portal: my routes with progress, finished-today; managers see all | src/app/(messenger)/messenger/page.tsx; src/app/(messenger)/messenger/layout.tsx | Merged: F-UI-071 |
| F-067 | Driver route execution: start route, mark stop delivered | src/app/(messenger)/messenger/routes/[id]/page.tsx; src/app/(messenger)/messenger/routes/[id]/start-route-button.tsx; src/app/(messenger)/messenger/routes/[id]/deliver-button.tsx; src/features/fulfillment/server/markDelivered.ts | Merged: F-UI-072 |
| F-068 | Follow-up calls queue (unpaid / pickup-overdue / lapsed, filterable) | src/app/(admin)/admin/follow-up/page.tsx; src/app/(admin)/admin/follow-up/follow-up-list.tsx; src/app/(admin)/admin/follow-up/follow-up-filters.tsx | Merged: F-UI-040; cutoffs from follow-up policy settings |

### Admin — email & marketing

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-069 | Email hub: 5-tab management (campaigns, subscribers, lists, templates, triggered) | src/app/(admin)/admin/email/page.tsx; src/app/(admin)/admin/email/email-tabs.tsx; src/app/(admin)/admin/email/campaigns-tab.tsx | Merged: F-UI-043 |
| F-070 | Campaign builder (block-based) + create/edit/send via Resend pipeline | src/app/(admin)/admin/email/campaign-builder.tsx; src/app/(admin)/admin/email/campaign-blocks.ts; src/app/(admin)/admin/email/new/page.tsx; src/app/(admin)/admin/email/[id]/edit/page.tsx; src/features/email/server/campaignSend.ts; prisma/schema.prisma (EmailCampaign, EmailTemplate) | Merged: F-UI-044, INT-011, D-035 (WYSIWYG blocksJson, brand defaults); send integration-tested |
| F-071 | Subscriber + mailing list management (preferences: all / if_not_ordered / once_yearly) | src/app/(admin)/admin/email/subscribers-tab.tsx; src/app/(admin)/admin/email/lists-tab.tsx; src/app/(admin)/admin/email/subscriber-controls.tsx; src/app/(admin)/admin/email/list-editors.tsx; src/features/email/server/marketingActions.ts; prisma/schema.prisma (EmailSubscriber, EmailPreference, MailingList, MailingListMember) | Merged: F-UI-046, D-033, D-034 |
| F-072 | Email template management + rendering | src/app/(admin)/admin/email/templates-tab.tsx; src/features/email/server/templateActions.ts; src/features/email/server/templateRender.ts | Template schema in D-035 (merged into F-070) |
| F-073 | Triggered (transactional) emails with editable overrides per key; sent-email idempotency; test-mode email log | src/app/(admin)/admin/email/triggered-tab.tsx; src/app/(admin)/admin/email/triggered/[key]/edit/page.tsx; src/app/(admin)/admin/email/email-editors.tsx; src/features/email/server/triggeredEmailDefaults.ts; prisma/schema.prisma (TriggeredEmailOverride, SentEmail, EmailLog) | Merged: F-UI-045, D-036 (dedupe on templateKey+dedupeKey) |
| F-074 | Order lifecycle emails (confirmation / payment link / refund notice) with order summary HTML | src/features/email/server/orderEmails.ts; src/features/email/server/orderSummaryHtml.ts; src/features/email/server/dispatchEmail.ts; src/server/outbox.ts | Merged: INT-010 (queued as durable outbox events) |
| F-075 | Payment reminder emails (scheduled) | src/app/api/cron/payment-reminders/route.ts | Cron infra under INT-024 |
| F-076 | Pickup expiry sweep (scheduled) | src/app/api/cron/pickup-expiry/route.ts | |
| F-077 | Transactional outbox with retrying sweeper (emails + geocoding; retry/backoff/park-as-failed) | src/server/outbox.ts; src/app/api/cron/outbox-sweep/route.ts; prisma/schema.prisma (OutboxEvent, OutboxStatus) | Merged: INT-025, D-038 (side effects written in-transaction) |

### Admin — reporting, money & exports

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-078 | Season reports: year-vs-average comparison, year table, item-level sales | src/app/(admin)/admin/reports/page.tsx; src/features/reports/server/seasonReports.ts | Merged: F-UI-056; items lined up via replacement chain + name matching |
| F-079 | Report drill-downs: lapsed customers and item winners/losers (`?drill=`) | src/app/(admin)/admin/reports/page.tsx | |
| F-080 | CSV export center + export audit log (one row per download: kind, rowCount, createdBy) | src/app/(admin)/admin/export/page.tsx; src/features/exports/server/exportResponse.ts; prisma/schema.prisma (ExportLog); prisma/migrations/20260611120000_export_log/migration.sql | Merged: F-UI-057, SEC-027, D-046 |
| F-081 | CSV export endpoints: deliveries, year-end accounting, year metrics, item sales, lapsed customers | src/app/api/export/deliveries/route.ts; src/app/api/export/year-end/route.ts; src/app/api/export/year-metrics/route.ts; src/app/api/export/item-sales/route.ts; src/app/api/export/lapsed-customers/route.ts; src/features/exports/server/exportResponse.ts; src/lib/csv.ts | Merged: D-047 (shared CSV/response helpers) |
| F-082 | Stripe reconciliation: run report + view, monthly scheduled reconcile (report-only, truncation flag) | src/app/(admin)/admin/reconciliation/page.tsx; src/app/(admin)/admin/reconciliation/run-button.tsx; src/features/reconciliation/server/runReconciliation.ts; src/features/reconciliation/server/matcher.ts; src/app/api/cron/reconcile-stripe/route.ts; prisma/schema.prisma (ReconciliationReport); prisma/migrations/20260607010000_reconciliation_report/migration.sql; prisma/migrations/20260607160000_reconciliation_truncated/migration.sql | Merged: F-UI-058, INT-007 (vercel.json cron 0 6 1 * *), D-045 (never changes money); matcher tested |

### Admin — configuration & staff tooling

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-083 | Settings hub + Orders tab: store open/close, package types, pickup locations, follow-up policy | src/app/(admin)/admin/settings/page.tsx; src/app/(admin)/admin/settings/orders-tab.tsx; src/app/(admin)/admin/settings/store-status-card.tsx; src/app/(admin)/admin/settings/package-types-card.tsx; src/app/(admin)/admin/settings/pickup-locations-card.tsx; src/app/(admin)/admin/settings/follow-up-settings.tsx | Merged: F-UI-059 (hub), F-UI-060 (orders-tab cards) |
| F-084 | Settings, Shipping tab: rates, rules, delivery ZIP allowlist | src/app/(admin)/admin/settings/shipping-tab.tsx; src/app/(admin)/admin/settings/shipping-rates-card.tsx; src/app/(admin)/admin/settings/shipping-rules-card.tsx; src/app/(admin)/admin/settings/delivery-zips-card.tsx | Merged: F-UI-060 (shipping cards) |
| F-085 | Settings, Email + Developer tabs | src/app/(admin)/admin/settings/email-tab.tsx; src/app/(admin)/admin/settings/developer-tab.tsx | Developer tab role-gated |
| F-086 | New season wizard | src/app/(admin)/admin/settings/new-season-wizard.tsx | Merged: F-UI-061 |
| F-087 | Staff user management with per-user permission overrides UI | src/app/(admin)/admin/users/page.tsx; src/app/(admin)/admin/users/users-client.tsx; src/app/(admin)/admin/users/add-staff-dialog.tsx; src/app/(admin)/admin/users/permission-overrides-dialog.tsx; src/features/users/server/actions.ts | Merged: F-UI-062; server-side guards under SEC-016/SEC-017/SEC-018 |
| F-088 | Customer/staff impersonation ("view as"): developer-only, httpOnly cookie, 8h TTL, audited, visible bar | src/app/(admin)/admin/impersonate/page.tsx; src/app/(admin)/admin/impersonate/impersonate-button.tsx; src/app/api/impersonate/route.ts; src/features/auth/server/impersonation.ts; src/components/admin/impersonation-bar.tsx | Merged: F-UI-063, SEC-013 (target must be confirmed staff; forged cookies ignored for non-developers) |
| F-089 | Audit log viewer | src/app/(admin)/admin/audit-log/page.tsx; src/app/(admin)/admin/audit-log/audit-table.tsx | Merged: F-UI-065, SEC-015; also feeds Today page staff alerts. Logging engine = SEC-014 |
| F-090 | In-app help articles | src/app/(admin)/admin/help/page.tsx; src/app/(admin)/admin/help/help-articles.ts; src/app/(admin)/admin/help/help-content.tsx | Merged: F-UI-066 |
| F-091 | Guided admin tours (driver.js style) | src/features/tours/tours.ts; src/features/tours/admin-tour.tsx; src/features/tours/run-driver.ts | Merged: F-UI-067 |
| F-092 | Test mode console: seed test season, reset DB, wipe test data, clear test emails | src/app/(admin)/admin/test-mode/page.tsx; src/app/(admin)/admin/test-mode/seed-buttons.tsx; src/app/(admin)/admin/test-mode/reset-button.tsx; src/app/(admin)/admin/test-mode/clear-emails-button.tsx; src/features/testdata/server/seedTestSeason.ts; src/features/testdata/server/wipeTestData.ts; src/features/testdata/server/generators.ts; src/features/testdata/server/testModeActions.ts; scripts/reset-test-db.ts; scripts/seed-test-season.ts; src/app/api/admin/reset-test-db/route.ts; src/app/api/admin/seed-test-season/route.ts; src/app/api/admin/wipe-test-data/route.ts | Merged: F-UI-064 (sidebar testOnly), D-049; route guards under SEC-025 |
| F-093 | Test/live sister-environment switch | src/app/(admin)/admin/env-switch/route.ts; src/components/admin/env-switch-link.tsx | Merged: INT-028 (NEXT_PUBLIC_SISTER_URL + IS_TEST_ENV); other admin chrome under F-UI-070 |
| F-UI-031 | Admin shell: collapsible permission-gated sidebar (Today/Dashboard pinned, 6 sections), mobile nav | src/app/(admin)/admin/admin-shell.tsx; src/components/admin/admin-sidebar.tsx; src/components/admin/sidebar-config.ts; src/components/admin/mobile-nav.tsx | Nav hints + permission/role/test-env gating |
| F-UI-069 | Shared admin list controls: search, pagination, page-size selector, remembered list URLs, sortable/responsive tables, status badges | src/components/admin/list-search.tsx; src/components/admin/pagination.tsx; src/components/admin/page-size-selector.tsx; src/components/admin/remember-list-url.tsx; src/components/ui/sortable-table.tsx; src/components/ui/responsive-table.tsx; src/components/admin/status-badges.tsx | |
| F-UI-070 | Admin chrome links: visit-store link, alert banner, back link | src/components/admin/visit-store-link.tsx; src/components/admin/alert-banner.tsx; src/components/admin/back-link.tsx | Env-switch part merged into F-093 |

### Auth, permissions & security controls

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| SEC-001 | Clerk identity integration (single SDK boundary: getClerkAuth / getClerkUser) | src/integrations/clerk.ts | Merged: INT-001; only file importing @clerk/* |
| SEC-002 | Clerk middleware on all app/API requests | src/middleware.ts | clerkMiddleware() with static-asset-excluding matcher; pages/routes enforce their own guards |
| SEC-003 | Sign-in / sign-up pages (Clerk-hosted catch-all UI) | src/app/(auth)/sign-in/[[...sign-in]]/page.tsx; src/app/(auth)/sign-up/[[...sign-up]]/page.tsx; src/config/env-schema.ts | Merged: F-UI-030, INT-002; URLs configurable via NEXT_PUBLIC_CLERK_* env |
| SEC-004 | Role model: RBAC with linear rank + allow-list carve-outs | src/config/permissions.ts; prisma/schema.prisma (StaffUser, StaffRole) | **CONFLICT** — security partial says six-role model (developer/admin/manager/clerk/messenger/customer, `src/config/permissions.ts`); data partial says 5-role StaffRole enum without customer (`prisma/schema.prisma`). Likely reconciliation: customer is a permissions-layer role, not a StaffRole enum value — needs verification. Merged: D-002 |
| SEC-005 | Per-user permission overrides (grant/deny beats role default) | src/config/permissions.ts (canWithOverrides, getOverridablePermissions); src/features/auth/server/resolveUser.ts; prisma/schema.prisma (PermissionOverride) | Merged: D-003 (unique (staffUserId, permissionKey)); role-locked powers never overridable |
| SEC-006 | Server-side authorization gate for actions/routes/pages | src/features/auth/server/requirePermission.ts | requirePermission throws, requirePagePermission redirects, userCan pure check; explicit deny wins; logs denials |
| SEC-007 | Effective-user resolution (Clerk id → StaffUser role + overrides) | src/features/auth/server/resolveUser.ts | Unconfirmed/revoked staff demoted to customer; overrides and canDrive deliberately not applied |
| SEC-008 | Staff invite auto-link by normalized email | src/features/auth/server/resolveUser.ts (linkStaffByEmail) | No auto-creation of staff |
| SEC-009 | "Must be staff" hard guard + storefront staff check | src/features/auth/server/staff.ts | requireStaffUser() throws unless confirmed clerk+; isConfirmedStaff() best-effort |
| SEC-010 | canDrive carve-out for driver-route permissions | src/config/permissions.ts (isDriverRoutePermission); src/features/auth/server/requirePermission.ts (allows) | Non-messenger with canDrive gets routes.viewOwn / routes.completeStop only; explicit deny still wins |
| SEC-011 | Admin area layout guard (sign-in redirect + staff-only) | src/app/(admin)/admin/layout.tsx | Unauthenticated → /sign-in?redirect_url=/admin; non-staff → / or /messenger |
| SEC-012 | Messenger area guard + own-route scoping | src/app/(messenger)/messenger/layout.tsx; src/app/(messenger)/messenger/routes/[id]/page.tsx | Requires routes.viewOwn; non-managers only own routes |
| SEC-014 | Audit logging of privileged actions (actor, impersonation attribution, entity, JSON details) | src/features/auth/server/audit.ts; prisma/schema.prisma (AuditLog) | Merged: D-006; logAction() never throws; indexed by userId and createdAt |
| SEC-016 | Staff user mutations gated on users.edit + server-side self-target blocking | src/features/users/server/actions.ts | assertNotSelf blocks self role-change/revoke/delete; roles validated against ASSIGNABLE_ROLES |
| SEC-017 | Access revocation (unlink Clerk id + unconfirm) | src/features/users/server/actions.ts (revokeAccess) | |
| SEC-018 | Permission-override editor with key whitelisting + self-edit block | src/features/users/server/actions.ts (savePermissionOverrides) | Only developers may edit their own overrides |
| SEC-019 | Public API guard: same-origin check + DB-backed IP rate limit + Zod parse | src/server/withPublicGuard.ts; prisma/schema.prisma (RateLimitBucket) | Merged: D-043 (windowed counters, cross-instance); fail-closed on rate-limit DB errors |
| SEC-020 | Cron endpoint bearer-secret verification | src/server/verifyCronSecret.ts; src/app/api/cron/outbox-sweep/route.ts | Authorization: Bearer CRON_SECRET; denies if unset or wrong |
| SEC-021 | Stripe webhook receiver: signature verification + idempotency store | src/app/api/webhooks/stripe/route.ts; src/features/payments/server/webhookIdempotency.ts; prisma/schema.prisma (ProcessedWebhookEvent) | Merged: INT-005 (500 on handler failure so Stripe retries), D-039 (unique (provider, eventId), retention window) |
| SEC-025 | Test-data admin routes double-gated (IS_TEST_ENV + developer permission) | src/app/api/admin/reset-test-db/route.ts; src/app/api/admin/wipe-test-data/route.ts; src/app/api/admin/seed-test-season/route.ts | 403 unless isTestEnv, then developer-only permission |
| SEC-026 | Guarded staff-only API routes (media, exports, route-builder) | src/app/api/media/route.ts; src/app/api/export/deliveries/route.ts; src/app/api/route-builder/refresh-coords/route.ts | Each calls requirePermission with its specific permission |
| SEC-028 | Env secret schema + boot validation + .env.example generation | src/config/env-schema.ts; src/config/env.ts; scripts/gen-env-example.ts; .env.example | Merged: D-056; all secrets Zod-validated; example file kept in sync by test |
| SEC-029 | Session login stamping (lastLoginAt, deduped per Clerk session) | src/features/auth/server/staff.ts (logSessionLogin) | Deliberately not written to AuditLog |
| SEC-030 | Permission unit tests (guard behavior locked by tests) | src/config/permissions.test.ts; src/features/auth/server/requirePermission.test.ts | Role ranks, overrides, canDrive carve-out, deny-wins |
| SEC-031 | Production error masking for server actions (tryAction / DomainError) | src/lib/result/index.ts | Unexpected errors masked in production |
| SEC-032 | CI guardrails workflow | .github/workflows/agent-guardrails.yml | Repo-level control, not app runtime |

### Data model & data infrastructure

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| D-001 | PostgreSQL (Neon) + Prisma data layer (singleton client) | prisma/schema.prisma; src/server/db.ts; .env.example | Merged: INT-023 (DATABASE_URL, sslmode=require) |
| D-004 | Customer records with normalized phone/email + dedupe support | prisma/schema.prisma (Customer) | phoneNormalized/emailNormalized indexes, notDuplicateOf[], guest flag |
| D-005 | Saved addresses with geocoding fields | prisma/schema.prisma (SavedAddress) | lat/long/geocodedAt, default-address flag |
| D-007 | Season model gating catalog per year | prisma/schema.prisma (Season) | isOpen, closedMessage; products/add-ons FK to season |
| D-008 | Product catalog schema with shipping dims & inventory flags | prisma/schema.prisma (Product, ProductStatus, ProductKind) | Integer cents, weight/dims, maxItemsPerBox, donation kind |
| D-009 | Product options with price adjustments | prisma/schema.prisma (ProductOption) | priceAdjustmentCents |
| D-013 | Normalized order tree (Order → OrderLine → add-ons) | prisma/schema.prisma (Order, OrderLine, OrderLineAddOn) | Money totals in cents, discount + reason, staff notes, follow-up snooze |
| D-014 | Price snapshots on order lines | prisma/schema.prisma (OrderLine: unitPriceCentsSnapshot, snapshotSource) | Source: live/import/manual, pricedAt |
| D-015 | Sequential order numbers per season (transactional sequence) | prisma/schema.prisma (OrderNumberSequence) | One row per season year, claimed at finalize (F-035) |
| D-017 | Cached derived payment status on orders | prisma/schema.prisma (PaymentStatus enum + Order.paymentStatus) | Source of truth = posted payments |
| D-018 | Fulfillment groups (multi-destination orders) with snapshots | prisma/schema.prisma (FulfillmentGroup, FulfillmentLine) | Address, geocode, pickup deadline/reminders, shipping cost snapshot, tracking/label |
| D-019 | Data-driven fulfillment methods (category enum + editable keys) | prisma/schema.prisma (FulfillmentMethod, FulfillmentCategory) | Replaces hardcoded shipping-method enum |
| D-020 | Shipping quotes with selectable, expiring options | prisma/schema.prisma (ShippingQuote, ShippingQuoteOption) | Checkout can only submit a real unexpired option row |
| D-022 | Pickup locations | prisma/schema.prisma (PickupLocation) | Hours, notes, active + sort |
| D-023 | Package types & shipment boxes | prisma/schema.prisma (PackageType, ShipmentBox) | Box weights/dims, per-box tracking + cost |
| D-026 | Unified inventory for products + add-ons (XOR check, versioned) | prisma/schema.prisma (InventoryItem) | One row per season per product OR add-on; optimistic-concurrency version |
| D-030 | Stripe PaymentIntent modeling (webhook-duplicate-proof) | prisma/schema.prisma (PaymentIntent) | Unique stripePaymentIntentId + checkout session id |
| D-031 | Payments (stripe/cash/check/comp) with posted/voided states | prisma/schema.prisma (Payment, PaymentMethod, PaymentRecordStatus) | Unique nullable stripePaymentIntentId = at most one credit per intent |
| D-037 | Key-value settings store with typed registry | prisma/schema.prisma (Setting); src/config/settings.ts; prisma/seed.ts | SETTING_DEFS registry seeded |
| D-040 | Geocode cache with success/failure TTLs | prisma/schema.prisma (GeocodeCache) | 7-day/6-hour TTL in domain code |
| D-044 | Cron/job run log | prisma/schema.prisma (JobRun) | Name, status, count, error |
| D-048 | Idempotent dev/test seed | prisma/seed.ts | Open season, 4 fulfillment methods, samples, settings, dev staff user; all upserts |
| D-052 | Schema-migration guard (every schema change needs a migration) | scripts/check-schema-has-migration.mjs; prisma/migrations/ | 7 migrations + lock |
| D-053 | Migration test harness | scripts/test-migration.mjs | Runs migrations against a test DB |
| D-054 | Data-layer helper libraries (money, normalize, phone, ids, season, dates, result) | src/lib/money/index.ts; src/lib/normalize/index.ts; src/lib/phone/index.ts; src/lib/ids/index.ts; src/lib/season/index.ts; src/lib/dates/index.ts; src/lib/result/ | Integer-cents money, Result type; unit tests alongside |
| D-055 | Legacy→new data migration plan (documented entity map) | DATA-MIGRATION-INVENTORY.md | References scripts/migrate-from-old.ts which does NOT exist in tree — documentation evidence only |

### Integrations & platform

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| INT-003 | Shared Stripe server client (lazy singleton getStripe()) | src/integrations/stripe.ts | Older money paths construct their own client (per file header) |
| INT-009 | Resend email sender (SDK isolated; all sends via dispatchEmail) | src/integrations/resend.ts; src/features/email/server/dispatchEmail.ts | From-address via RESEND_FROM_EMAIL |
| INT-013 | Email log purge cron | src/app/api/cron/purge-email-log/route.ts; vercel.json | Daily purge of old email log rows |
| INT-014 | Shippo shipping SDK wrapper (rate, buy/void label, track, validate address) | src/integrations/shippo.ts | Sole Shippo importer; degrades gracefully without SHIPPO_API_KEY |
| INT-017 | Mapbox server-side geocoding (Geocoding API v5) | src/integrations/mapbox.ts; src/features/shipping/server/geocode.ts; src/features/shipping/server/geocodeRefresh.ts | Clean failure without token; cache under D-040 |
| INT-021 | UPS direct credentials declared, not implemented | .env.example; src/config/env-schema.ts | No UPS API calls in src/ — carrier handled via Shippo; declaration-only caveat |
| INT-024 | Vercel Cron jobs (5) with secret auth | vercel.json; src/server/verifyCronSecret.ts; src/app/api/cron/payment-reminders/route.ts; src/app/api/cron/outbox-sweep/route.ts; src/app/api/cron/pickup-expiry/route.ts | payment-reminders, outbox-sweep, pickup-expiry, purge-email-log, reconcile-stripe; all gated by CRON_SECRET (SEC-020) |
| INT-026 | Nexternal legacy-platform import pipeline (customers, products, historical orders; Excel) + order-number repair | scripts/nexternal/shared/excel.ts; scripts/nexternal/customers/*; scripts/nexternal/products/importProducts.ts; scripts/nexternal/historical/*; scripts/nexternal/fix-order-numbers.ts; package.json | Merged: D-050, D-051 (read → plan/transform/match → commit stages) |
| INT-027 | Health check (DB + env validation, 200/503) | src/app/api/health/route.ts | Checks Prisma connectivity and safeParseEnv() |
| INT-029 | Client-side Stripe packages present but no client mount found | package.json (@stripe/stripe-js, @stripe/react-stripe-js); src/app/api/checkout/route.ts | **CONFLICT** — package.json declares embedded-Stripe client libraries, but the checkout implementation (F-022/INT-004, `src/app/api/checkout/route.ts`) is a hosted-redirect Checkout Session with no loadStripe/Elements usage in src/. Either dead dependencies or an unshipped embedded flow — needs verification |

### Design system / app-wide UI

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-UI-073 | shadcn-style UI kit (button, card, dialog, sheet, tabs, select, table, popover, dropdown, switch, checkbox, badge, avatar, input, textarea, label, separator) | src/components/ui/button.tsx; src/components/ui/dialog.tsx; src/components/ui/tabs.tsx; components.json | Full set under src/components/ui/ |
| F-UI-074 | Custom UI primitives: confirm dialog, empty state, FAB, info hint, page header, pill input, price tag, smart select, callout | src/components/ui/confirm-dialog.tsx; src/components/ui/empty-state.tsx; src/components/ui/fab.tsx; src/components/ui/info-hint.tsx; src/components/ui/page-header.tsx; src/components/ui/pill-input.tsx; src/components/ui/price-tag.tsx; src/components/ui/smart-select.tsx; src/components/ui/callout.tsx | |
| F-UI-075 | Design tokens + global styles + brand constants | src/styles/tokens.css; src/app/globals.css; src/lib/brand.ts | Burgundy/gold brand theme |
| F-UI-076 | Global error page + root layout (client error reporting) | src/app/error.tsx; src/app/layout.tsx; src/app/api/client-error/route.ts | Error reports guarded by SEC-019 |
| F-UI-077 | Marketing imagery assets (hero, mission photos) | public/images/hero.png; public/images/mission-shabbos-table.jpg; public/images/mission-volunteers.jpg | |

## Conflicts

1. **SEC-004 vs D-002 — role count.** `src/config/permissions.ts` (security partial: six roles incl. customer) vs `prisma/schema.prisma` StaffRole enum (data partial: five staff roles, no customer). Probably customer is a permissions-layer pseudo-role rather than a StaffRole value, but the partials state different counts, so tagged CONFLICT.
2. **INT-029 vs F-022/INT-004 — Stripe client packages.** `package.json` declares `@stripe/stripe-js` + `@stripe/react-stripe-js`, but `src/app/api/checkout/route.ts` implements hosted-redirect checkout with no client-side Stripe mount found in `src/`. Tagged CONFLICT (dead deps vs unshipped embedded flow).

## Merged counts

| Partial | Rows | Kept as primary | Folded into other rows |
|---|---|---|---|
| product (F) | 93 | 93 | 0 |
| security (SEC) | 32 | 26 | 6 |
| data (D) | 57 | 26 | 31 |
| ui (F-UI) | 77 | 10 | 67 |
| integrations (INT) | 29 | 10 | 19 |
| **Total** | **288** | **165** | **123** |

## Notes

- `scripts/migrate-from-old.ts` (referenced by D-055's source doc) does not exist in the tree — carried as documentation evidence only, per the data partial.
- Source project's own FEATURE-INVENTORY.md was not used as a source in any partial; all evidence cites code paths directly.
