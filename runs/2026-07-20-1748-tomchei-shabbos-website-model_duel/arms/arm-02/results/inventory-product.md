# Codebase inventory — arm-02 (job: product)

Source root: `D:\Projects\Personal\Tools\agent-duel-harness\.scratch\sources\tomche-shabbos-website`
All evidence paths below are relative to that source root.

## Proof-of-read
- Rules files read: 7 (`AGENTS.md` + `rules/clean-code.md`, `rules/codegraph.md`, `rules/grill-protocol.md`, `rules/ponytail.md`, `rules/vocabulary.md`, `rules/workflow.md`)
- Top-level dirs sampled: `src/app` (storefront, admin, messenger, auth, api route groups), `src/features` (23 feature folders), `src/components`, `src/lib`, `src/config`, `src/integrations`, `prisma`, `scripts`, `e2e`
- Files opened to verify behavior (header comments + code): storefront home, order builder page, checkout page, admin today page + workQueue, order state machine, POS builder, fulfillment overview, season reports, export page, settings page, messenger home, email hub, follow-up page

## Slice boundary (job = product)
This inventory covers user-visible product behavior and business workflows: storefront shopping and ordering, checkout, the order lifecycle, and admin/staff operational features. Left to sibling jobs: data schema (`data`), external service wiring (`integrations` — Stripe/Shippo/Mapbox/Resend/Clerk plumbing), auth/permissions internals (`security`), and shared UI primitives (`ui`). Where a product feature sits on top of one of those (e.g. card checkout uses Stripe), it is listed here as behavior, not as integration plumbing.

## Features

### Storefront — browsing & marketing
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | Marketing home page (hero, how-it-works, packages grid, mission, testimonials, CTAs) | src/app/(storefront)/page.tsx | Server component; loads current season's packages into product grid |
| F-002 | Animated impact-stats bar on home page | src/components/storefront/home-impact-bar.tsx | Count-up numbers, burgundy strip |
| F-003 | Packages catalog page | src/app/(storefront)/packages/page.tsx; src/app/(storefront)/packages/packages-grid.tsx | Season's products with loading state (loading.tsx) |
| F-004 | Package detail page | src/app/(storefront)/packages/[id]/page.tsx | Per-product page linking into order builder |
| F-005 | Product quick-view dialog | src/components/storefront/product-quick-view.tsx; src/features/order-builder/components/ProductQuickView.tsx | Exists both on storefront and inside builder |
| F-006 | Past collections page | src/app/(storefront)/past-collections/page.tsx | Prior seasons' offerings |
| F-007 | Store open/closed gate with configurable closed message | src/features/storefront/server/storeStatus.ts; src/app/(storefront)/order/page.tsx | Order builder and checkout refuse when ordering closed |
| F-008 | Email newsletter subscribe | src/components/storefront/email-subscribe.tsx; src/app/api/subscribe/route.ts; src/features/email/server/upsertSubscriber.ts | |
| F-009 | One-click unsubscribe page (tokenized) | src/app/(storefront)/unsubscribe/page.tsx; src/app/(storefront)/unsubscribe/unsubscribe-form.tsx; src/app/api/unsubscribe/route.ts; src/features/email/server/unsubscribeToken.ts | |
| F-010 | First-run setup page | src/app/(storefront)/setup/page.tsx; src/app/api/setup/route.ts | Bootstraps initial data |
| F-011 | Mobile menu + signed-in user menu | src/components/storefront/mobile-menu.tsx; src/components/storefront/user-menu.tsx | Storefront chrome behavior |
| F-012 | Test-mode banner on storefront | src/components/storefront/test-mode-banner.tsx | Visible flag when running against test data |

### Storefront — order builder
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-013 | Multi-recipient order builder (products, recipients, sidebar cart) | src/app/(storefront)/order/page.tsx; src/app/(storefront)/order/order-builder.tsx; src/features/order-builder/components/OrderBuilderShell.tsx | Same shell reused by POS |
| F-014 | Draft autosave + resume (`?draft=ID` or latest web draft) | src/features/order-builder/components/AutoSave.tsx; src/features/orders/server/saveDraft.ts; src/features/orders/server/loadDraft.ts | Guest drafts cleared on success (ClearGuestDraftOnSuccess.tsx) |
| F-015 | Add / manage recipients, assign packages to recipients | src/features/order-builder/components/AddRecipientDialog.tsx; src/features/order-builder/components/RecipientAssignDialog.tsx; src/features/order-builder/orderDraftReducer.ts | Draft state machine + selectors |
| F-016 | Saved addresses inside builder ("myself" default, edit dialog) | src/features/customers/server/savedAddresses.ts; src/features/order-builder/components/EditSavedAddressDialog.tsx | |
| F-017 | Address autocomplete + server-side address validation | src/components/ordering/address-autocomplete.tsx; src/components/ordering/address-fields.tsx; src/app/api/addresses/validate/route.ts | |
| F-018 | Add-ons with per-product restrictions | src/features/order-builder/catalog.ts; src/features/products/server/addOnActions.ts | Loaded with restrictions in order page |
| F-019 | Live stock awareness in builder (product kind + stock) | src/app/(storefront)/order/page.tsx; src/features/inventory/server/reserve.ts | Products loaded "with live stock + kind" |
| F-020 | Mobile cart FAB | src/features/order-builder/components/MobileCartFab.tsx | |

### Checkout & payments (customer-facing behavior)
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-021 | Checkout page with ownership guard (signed-in match or guest token) | src/app/(storefront)/checkout/page.tsx; src/features/orders/server/orderAccess.ts; src/features/checkout/server/checkoutToken.ts | |
| F-022 | Card payment checkout (Stripe) | src/app/api/checkout/route.ts; src/features/checkout/components/CheckoutClient.tsx | Card always available |
| F-023 | Offline payment checkout (cash/check) when enabled in settings | src/app/api/checkout/offline/route.ts; src/app/(storefront)/checkout/page.tsx | Toggled via store settings |
| F-024 | Price snapshot + checkout validation (issues surfaced before pay) | src/features/checkout/server/checkoutValidation.ts; src/features/checkout/server/pricing.ts | |
| F-025 | Shipping rate calculation at checkout | src/features/checkout/shippingRates.ts; src/features/checkout/server/shipping.ts | |
| F-026 | Checkout success page | src/app/(storefront)/checkout/success/page.tsx | |
| F-027 | Payment recalculation on order changes | src/features/payments/server/recalcOrderPayment.ts; src/features/payments/server/paymentMath.ts | Keeps paid/due amounts consistent |

### Customer account
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-028 | Account dashboard | src/app/(storefront)/account/page.tsx; src/app/(storefront)/account/layout.tsx | |
| F-029 | Order history + order detail | src/app/(storefront)/account/orders/page.tsx; src/app/(storefront)/account/orders/[id]/page.tsx | |
| F-030 | Cancel own draft order | src/app/(storefront)/account/orders/[id]/cancel-draft-button.tsx; src/features/orders/server/cancelOwnDraft.ts | |
| F-031 | Repeat a past order (customer self-serve) | src/app/(storefront)/account/orders/[id]/repeat/page.tsx; src/features/orders/server/repeat/repeatOrder.ts; src/features/orders/server/repeat/buildRepeatPlan.ts; src/components/ordering/repeat-review.tsx | Uses product matcher + replacement chains |
| F-032 | Profile editing | src/app/(storefront)/account/profile/profile-form.tsx; src/app/api/account/profile/route.ts | |
| F-033 | Saved addresses management page | src/app/(storefront)/account/addresses/page.tsx | |

### Order lifecycle (shared business rules)
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-034 | Order status state machine (draft → confirmed → fulfilled; cancellable) | src/features/orders/server/orderStateMachine.ts; src/features/orders/server/transitionOrder.ts | PLACED_ORDER_STATUSES drives inventory/reports/repeat |
| F-035 | Order finalization (draft becomes placed order) | src/features/orders/server/finalizeOrder.ts | |
| F-036 | Draft discard | src/features/orders/server/discardDraft.ts | |
| F-037 | Draft/order number scheme on the wire | src/features/orders/draftWire.ts; prisma/migrations/20260611000000_draft_numbers/migration.sql | |
| F-038 | Product replacement chains (this year's item = last year's item) | src/app/(admin)/admin/products/[id]/replacement-editor.tsx; src/features/orders/server/repeat/replacementChain.ts; src/features/orders/server/repeat/matcher.ts | Feeds repeat orders and season reports |

### Admin — operations hub
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-039 | Admin dashboard with stats | src/app/(admin)/admin/page.tsx; src/features/orders/server/dashboardStats.ts | |
| F-040 | "Today" work queue — 8 permission-gated action cards | src/app/(admin)/admin/today/page.tsx; src/features/today/server/workQueue.ts | Orders to confirm, pickups, labels, dispatch, active routes, production shortfall, follow-up calls, staff alerts |
| F-041 | Orders list with search | src/app/(admin)/admin/orders/page.tsx; src/app/(admin)/admin/orders/orders-search-bar.tsx | |
| F-042 | Order detail with money actions (record payment, remove payment) | src/app/(admin)/admin/orders/[id]/page.tsx; src/app/(admin)/admin/orders/[id]/order-money-actions.tsx; src/features/orders/server/adminPayments.ts | |
| F-043 | Refunds (incl. Stripe refund path) | src/features/refunds/server/createRefund.ts | Integration-tested (createRefund.integration.test.ts) |
| F-044 | Packing slip print view | src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx; src/components/admin/print-button.tsx | |
| F-045 | Admin repeat of a single order | src/app/(admin)/admin/orders/[id]/repeat/page.tsx | |
| F-046 | Bulk repeat of last season's orders | src/app/(admin)/admin/orders/repeat-bulk/page.tsx; src/app/(admin)/admin/orders/repeat-bulk/bulk-repeat-form.tsx | |
| F-047 | POS: staff order builder with customer search / walk-in / new customer + staff notes | src/app/(admin)/admin/pos/page.tsx; src/app/(admin)/admin/pos/pos-builder.tsx | Reuses shopper builder shell with source "pos" |
| F-048 | POS checkout | src/app/(admin)/admin/pos/checkout/[orderId]/page.tsx | |
| F-049 | Customer directory (search, add customer) | src/app/(admin)/admin/customers/page.tsx; src/app/(admin)/admin/customers/customer-search.tsx; src/app/(admin)/admin/customers/add-customer-dialog.tsx; src/app/api/customers/search/route.ts | Also find-or-create API for POS (src/app/api/customers/find-or-create/route.ts) |
| F-050 | Customer detail page | src/app/(admin)/admin/customers/[id]/page.tsx; src/app/(admin)/admin/customers/[id]/customer-detail-client.tsx; src/features/customers/server/customerActions.ts | |
| F-051 | CSV customer import with batch engine | src/components/admin/csv-import-dialog.tsx; src/features/imports/server/batchEngine.ts; src/features/imports/server/actions.ts | |

### Admin — catalog & inventory
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-052 | Product management (list, create, edit, detail, season assignment) | src/app/(admin)/admin/products/page.tsx; src/app/(admin)/admin/products/product-form.tsx; src/app/(admin)/admin/products/new/page.tsx; src/app/(admin)/admin/products/[id]/edit/page.tsx; src/features/products/server/productActions.ts | Season selector (season-select.tsx) |
| F-053 | Add-on management | src/app/(admin)/admin/addons/page.tsx; src/app/(admin)/admin/addons/addon-actions.tsx | |
| F-054 | Media library with "needs photos" panel | src/app/(admin)/admin/media/page.tsx; src/app/(admin)/admin/media/needs-photos-panel.tsx; src/app/api/media/route.ts; src/components/admin/media-picker.tsx | |
| F-055 | Inventory dashboard (overview + production tabs) | src/app/(admin)/admin/inventory/page.tsx; src/app/(admin)/admin/inventory/inventory-tabs.tsx; src/features/inventory/server/dashboard.ts | |
| F-056 | Production batch recording + history (daily batch dialog) | src/app/(admin)/admin/inventory/daily-batch-dialog.tsx; src/app/(admin)/admin/inventory/production-history.tsx; src/features/inventory/server/production.ts | |
| F-057 | Stock reserve / allocate / release engine | src/features/inventory/server/reserve.ts; src/features/inventory/server/allocate.ts; src/features/inventory/server/release.ts | Integration-tested (reserve.integration.test.ts) |
| F-058 | Shortfall detection and write-offs | src/features/inventory/server/shortfall.ts; src/features/inventory/server/writeoff.ts | Shortfall feeds Today page production card |

### Admin — fulfillment & delivery
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-059 | Fulfillment overview by channel (pickups / local deliveries / shipments) | src/app/(admin)/admin/fulfillment/page.tsx; src/features/fulfillment/server/fulfillmentPool.ts; src/app/(admin)/admin/fulfillment/channel-action-button.tsx | Status counts + channel actions ("Packing & Labels") |
| F-060 | Carrier shipment labels + label fields | src/features/fulfillment/server/shipmentActions.ts; src/app/(admin)/admin/orders/[id]/shipment-actions.tsx; prisma/migrations/20260607000000_shipment_label_fields/migration.sql | |
| F-061 | Shipment planning with bin packing into package types | src/features/shipping/server/binPacking.ts; src/features/shipping/server/shipmentPlanning.ts | |
| F-062 | Shipping rules engine + rate resolution | src/features/shipping/server/ruleEngine.ts; src/features/shipping/server/rateResolution.ts | Config from settings shipping tab |
| F-063 | Delivery route builder (geocoded stops, coordinate refresh) | src/app/(admin)/admin/fulfillment/build-route/route-builder.tsx; src/app/api/route-builder/refresh-coords/route.ts; src/features/shipping/server/geocode.ts | |
| F-064 | Route management: detail, reassign driver, print manifest | src/app/(admin)/admin/routes/page.tsx; src/app/(admin)/admin/routes/[id]/page.tsx; src/app/(admin)/admin/routes/[id]/reassign-button.tsx; src/app/(admin)/admin/routes/[id]/print/page.tsx; src/features/fulfillment/server/routeActions.ts | |
| F-065 | Greeting cards print view per route | src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx | |
| F-066 | Messenger (driver) portal: my routes with progress, manager sees all | src/app/(messenger)/messenger/page.tsx; src/app/(messenger)/messenger/layout.tsx | |
| F-067 | Driver route execution: start route, mark stop delivered | src/app/(messenger)/messenger/routes/[id]/page.tsx; src/app/(messenger)/messenger/routes/[id]/start-route-button.tsx; src/app/(messenger)/messenger/routes/[id]/deliver-button.tsx; src/features/fulfillment/server/markDelivered.ts | |
| F-068 | Follow-up calls queue (unpaid / pickup-overdue / lapsed, filterable) | src/app/(admin)/admin/follow-up/page.tsx; src/app/(admin)/admin/follow-up/follow-up-list.tsx; src/app/(admin)/admin/follow-up/follow-up-filters.tsx | Cutoffs from follow-up policy settings |

### Admin — email & marketing
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-069 | Email hub: 5-tab management (campaigns, subscribers, lists, templates, triggered) | src/app/(admin)/admin/email/page.tsx; src/app/(admin)/admin/email/email-tabs.tsx | |
| F-070 | Campaign builder (block-based) + create/edit/send | src/app/(admin)/admin/email/campaign-builder.tsx; src/app/(admin)/admin/email/campaign-blocks.ts; src/app/(admin)/admin/email/new/page.tsx; src/app/(admin)/admin/email/[id]/edit/page.tsx; src/features/email/server/campaignSend.ts | Integration-tested send |
| F-071 | Subscriber + mailing list management | src/app/(admin)/admin/email/subscribers-tab.tsx; src/app/(admin)/admin/email/lists-tab.tsx; src/app/(admin)/admin/email/subscriber-controls.tsx; src/features/email/server/marketingActions.ts | |
| F-072 | Email template management + rendering | src/app/(admin)/admin/email/templates-tab.tsx; src/features/email/server/templateActions.ts; src/features/email/server/templateRender.ts | |
| F-073 | Triggered (transactional) emails with editable overrides per key | src/app/(admin)/admin/email/triggered-tab.tsx; src/app/(admin)/admin/email/triggered/[key]/edit/page.tsx; src/features/email/server/triggeredEmailDefaults.ts | |
| F-074 | Order lifecycle emails with order summary HTML | src/features/email/server/orderEmails.ts; src/features/email/server/orderSummaryHtml.ts; src/features/email/server/dispatchEmail.ts | |
| F-075 | Payment reminder emails (scheduled) | src/app/api/cron/payment-reminders/route.ts | |
| F-076 | Pickup expiry sweep (scheduled) | src/app/api/cron/pickup-expiry/route.ts | |
| F-077 | Outbox sweep for reliable email delivery (scheduled) | src/app/api/cron/outbox-sweep/route.ts; src/server/outbox.ts | |

### Admin — reporting, money & exports
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-078 | Season reports: year-vs-average comparison, year table, item-level sales | src/app/(admin)/admin/reports/page.tsx; src/features/reports/server/seasonReports.ts | Items lined up via replacement chain + name matching |
| F-079 | Report drill-downs: lapsed customers and item winners/losers (`?drill=`) | src/app/(admin)/admin/reports/page.tsx | |
| F-080 | CSV export center + export history log | src/app/(admin)/admin/export/page.tsx; prisma/migrations/20260611120000_export_log/migration.sql | Shows who downloaded what and when |
| F-081 | CSV exports: deliveries, year-end accounting, year metrics, item sales, lapsed customers | src/app/api/export/deliveries/route.ts; src/app/api/export/year-end/route.ts; src/app/api/export/year-metrics/route.ts; src/app/api/export/item-sales/route.ts; src/app/api/export/lapsed-customers/route.ts; src/features/exports/server/exportResponse.ts | |
| F-082 | Stripe reconciliation: run report + view, scheduled reconcile | src/app/(admin)/admin/reconciliation/page.tsx; src/app/(admin)/admin/reconciliation/run-button.tsx; src/features/reconciliation/server/runReconciliation.ts; src/app/api/cron/reconcile-stripe/route.ts | Matcher tested (matcher.test.ts) |

### Admin — configuration & staff tooling
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-083 | Settings, Orders tab: store open/close, package types, pickup locations, follow-up policy | src/app/(admin)/admin/settings/orders-tab.tsx; src/app/(admin)/admin/settings/store-status-card.tsx; src/app/(admin)/admin/settings/package-types-card.tsx; src/app/(admin)/admin/settings/pickup-locations-card.tsx; src/app/(admin)/admin/settings/follow-up-settings.tsx | |
| F-084 | Settings, Shipping tab: rates, rules, delivery ZIP allowlist | src/app/(admin)/admin/settings/shipping-tab.tsx; src/app/(admin)/admin/settings/shipping-rates-card.tsx; src/app/(admin)/admin/settings/shipping-rules-card.tsx; src/app/(admin)/admin/settings/delivery-zips-card.tsx | |
| F-085 | Settings, Email + Developer tabs | src/app/(admin)/admin/settings/email-tab.tsx; src/app/(admin)/admin/settings/developer-tab.tsx | Developer tab role-gated |
| F-086 | New season wizard | src/app/(admin)/admin/settings/new-season-wizard.tsx | |
| F-087 | Staff user management with per-user permission overrides | src/app/(admin)/admin/users/page.tsx; src/app/(admin)/admin/users/users-client.tsx; src/app/(admin)/admin/users/add-staff-dialog.tsx; src/app/(admin)/admin/users/permission-overrides-dialog.tsx; src/features/users/server/actions.ts | |
| F-088 | Customer impersonation ("view as") with visible bar | src/app/(admin)/admin/impersonate/page.tsx; src/app/api/impersonate/route.ts; src/components/admin/impersonation-bar.tsx | Auth mechanics belong to security slice; listed as staff-facing feature |
| F-089 | Audit log viewer | src/app/(admin)/admin/audit-log/page.tsx; src/app/(admin)/admin/audit-log/audit-table.tsx | Also feeds Today page staff alerts |
| F-090 | In-app help articles | src/app/(admin)/admin/help/page.tsx; src/app/(admin)/admin/help/help-articles.ts | |
| F-091 | Guided admin tours | src/features/tours/tours.ts; src/features/tours/admin-tour.tsx; src/features/tours/run-driver.ts | |
| F-092 | Test mode console: seed test season, reset DB, wipe test data, clear test emails | src/app/(admin)/admin/test-mode/page.tsx; src/app/(admin)/admin/test-mode/seed-buttons.tsx; src/features/testdata/server/seedTestSeason.ts; src/features/testdata/server/wipeTestData.ts | Backed by src/app/api/admin/* routes |
| F-093 | Test/live environment switch | src/app/(admin)/admin/env-switch/route.ts; src/components/admin/env-switch-link.tsx | |

## Blocked / out-of-slice notes
- No blocked areas; source tree was fully readable.
- Sign-in / sign-up pages (src/app/(auth)/**), permission model internals (src/config/permissions.ts), Prisma schema, and third-party client wiring (src/integrations/*) observed but deferred to the security / data / integrations job slices.
- Source project's own FEATURE-INVENTORY.md was NOT used as a source; all rows above cite code paths directly.
