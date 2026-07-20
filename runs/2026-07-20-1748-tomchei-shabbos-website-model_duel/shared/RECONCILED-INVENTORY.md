# Reconciled inventory — Test 1a

Union of arm-01 (173) + arm-02 (165). Source: `.scratch/sources/tomche-shabbos-website`.
All evidence paths verified against the source tree. Tag: SHARED / UNIQUE-TO-arm-01 / UNIQUE-TO-arm-02.

## Storefront — browsing & marketing

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-001 | Mission-led storefront homepage | `src/app/(storefront)/page.tsx` | SHARED | arm-01 F-001 = arm-02 F-001 |
| R-002 | Store-open-aware homepage CTAs + closure enforcement | `src/app/(storefront)/page.tsx`; `src/app/(storefront)/order/page.tsx`; `src/app/(storefront)/checkout/page.tsx`; `src/features/storefront/server/storeStatus.ts`; `src/app/(storefront)/layout.tsx` | SHARED | arm-01 F-002 + F-006 = arm-02 F-007 (store open/closed gate + banner) |
| R-003 | Current-season package catalog | `src/app/(storefront)/packages/page.tsx`; `src/app/(storefront)/packages/packages-grid.tsx`; `src/app/(storefront)/packages/loading.tsx` | SHARED | arm-01 F-003 = arm-02 F-003 (arm-02 adds loading.tsx) |
| R-004 | Package detail and option pricing | `src/app/(storefront)/packages/[id]/page.tsx` | SHARED | arm-01 F-004 = arm-02 F-004 |
| R-005 | Public past-collections archive | `src/app/(storefront)/past-collections/page.tsx` | SHARED | arm-01 F-005 = arm-02 F-006 |
| R-006 | Product quick-view dialog | `src/components/storefront/product-quick-view.tsx`; `src/app/(storefront)/packages/packages-grid.tsx` | SHARED | arm-01 UI-017 = arm-02 F-005 |
| R-007 | Homepage impact-stats bar | `src/app/(storefront)/page.tsx`; `src/components/storefront/home-impact-bar.tsx` | SHARED | arm-01 UI-007 = arm-02 F-002 |
| R-008 | Homepage How It Works / mission / testimonials / final CTA | `src/app/(storefront)/page.tsx` | SHARED | arm-01 UI-008 + UI-011 + UI-012 + UI-013 (arm-02 folds into F-001) |
| R-009 | Newsletter subscribe + preferences + tokenized unsubscribe | `src/components/storefront/email-subscribe.tsx`; `src/app/api/subscribe/route.ts`; `src/features/email/server/upsertSubscriber.ts`; `src/app/(storefront)/unsubscribe/page.tsx`; `src/app/(storefront)/unsubscribe/unsubscribe-form.tsx`; `src/app/api/unsubscribe/route.ts`; `src/features/email/server/unsubscribeToken.ts` | SHARED | arm-01 F-024 + F-063 = arm-02 F-008 + F-009 |
| R-010 | First-run setup page (empty-staff bootstrap) | `src/app/(storefront)/setup/page.tsx`; `src/app/api/setup/route.ts` | UNIQUE-TO-arm-02 | arm-02 F-010; arm-01 SEC-022 covers only the API half |
| R-011 | Storefront shell: sticky header, desktop nav, mobile menu, user menu, footer | `src/app/(storefront)/layout.tsx`; `src/components/storefront/mobile-menu.tsx`; `src/components/storefront/user-menu.tsx`; `src/lib/brand.ts` | SHARED | arm-01 UI-002 + UI-003 + UI-004 + UI-005 = arm-02 F-011 + F-UI-003 |
| R-012 | Storewide closed-order banner | `src/app/(storefront)/layout.tsx` | SHARED | arm-01 UI-001 (arm-02 folds into F-007) |
| R-013 | Footer email signup | `src/app/(storefront)/layout.tsx`; `src/components/storefront/email-subscribe.tsx` | SHARED | arm-01 UI-005 (arm-02 folds into F-008) |
| R-014 | Test-mode banner on storefront | `src/components/storefront/test-mode-banner.tsx` | UNIQUE-TO-arm-02 | arm-02 F-012 |
| R-015 | Package category filters | `src/app/(storefront)/packages/packages-grid.tsx` | UNIQUE-TO-arm-01 | arm-01 UI-015 |
| R-016 | Package price sorting | `src/app/(storefront)/packages/packages-grid.tsx` | UNIQUE-TO-arm-01 | arm-01 UI-016 |
| R-017 | Catalog sold-out handling | `src/app/(storefront)/packages/packages-grid.tsx` | UNIQUE-TO-arm-01 | arm-01 UI-018 |
| R-018 | Token-verified email preference states + 3 unsubscribe prefs | `src/app/(storefront)/unsubscribe/page.tsx`; `src/app/(storefront)/unsubscribe/unsubscribe-form.tsx` | SHARED | arm-01 UI-057 + UI-058 (arm-02 folds into F-009) |

## Storefront — order builder

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-019 | Multi-recipient order builder (shared storefront/POS shell) | `src/app/(storefront)/order/page.tsx`; `src/app/(storefront)/order/order-builder.tsx`; `src/features/order-builder/components/OrderBuilderShell.tsx`; `src/features/order-builder/orderDraftReducer.ts` | SHARED | arm-01 F-007 = arm-02 F-013 |
| R-020 | Inventory-aware / live-stock package selection | `src/app/(storefront)/order/page.tsx`; `src/features/order-builder/catalog.ts`; `src/features/inventory/server/reserve.ts` | SHARED | arm-01 F-008 = arm-02 F-019 |
| R-021 | Product options + restricted add-ons | `src/features/order-builder/catalog.ts`; `src/features/order-builder/orderDraftReducer.ts`; `src/features/products/server/addOnActions.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-009 = arm-02 F-018 |
| R-022 | Save and resume web drafts (autosave + guest clear on success) | `src/app/(storefront)/order/page.tsx`; `src/features/order-builder/components/AutoSave.tsx`; `src/features/order-builder/components/ClearGuestDraftOnSuccess.tsx`; `src/features/orders/server/saveDraft.ts`; `src/features/orders/server/loadDraft.ts` | SHARED | arm-01 F-010 = arm-02 F-014 |
| R-023 | Guest checkout access tokens | `src/app/(storefront)/checkout/page.tsx`; `src/features/checkout/server/checkoutToken.ts`; `src/features/orders/server/orderAccess.ts` | SHARED | arm-01 F-011 (arm-02 folds into F-021) |
| R-024 | Saved-address reuse in ordering | `src/app/(storefront)/order/page.tsx`; `src/features/customers/server/savedAddresses.ts`; `src/features/order-builder/components/EditSavedAddressDialog.tsx` | SHARED | arm-01 F-012 = arm-02 F-016 |
| R-025 | Address autocomplete + server-side validation | `src/components/ordering/address-autocomplete.tsx`; `src/components/ordering/address-fields.tsx`; `src/app/api/addresses/validate/route.ts` | UNIQUE-TO-arm-02 | arm-02 F-017 |
| R-026 | Builder product panel + cards + in-builder quick view | `src/features/order-builder/components/ProductPanel.tsx`; `src/features/order-builder/components/ProductCard.tsx`; `src/features/order-builder/components/ProductQuickView.tsx` | SHARED | arm-01 UI-026 + UI-027 = arm-02 F-UI-012 |
| R-027 | Assign products to recipients | `src/features/order-builder/components/RecipientAssignDialog.tsx` | SHARED | arm-01 UI-028 (arm-02 folds into F-015) |
| R-028 | Add recipient from saved address / new address | `src/features/order-builder/components/AddRecipientDialog.tsx` | SHARED | arm-01 UI-029 + UI-030 (arm-02 folds into F-015) |
| R-029 | Edit saved address while ordering | `src/features/order-builder/components/EditSavedAddressDialog.tsx` | SHARED | arm-01 UI-031 (arm-02 folds into F-016) |
| R-030 | Desktop order sidebar + mobile cart FAB | `src/features/order-builder/components/OrderBuilderShell.tsx`; `src/features/order-builder/components/OrderSidebar.tsx`; `src/features/order-builder/components/MobileCartFab.tsx` | SHARED | arm-01 UI-035 + UI-036 = arm-02 F-020 |
| R-031 | Shared storefront/POS builder shell | `src/features/order-builder/components/OrderBuilderShell.tsx` | SHARED | arm-01 UI-025 (arm-02 folds into F-013) |

## Checkout & payments

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-032 | Fulfillment/shipping selection + rate resolution + rules | `src/features/checkout/server/shipping.ts`; `src/features/checkout/shippingRates.ts`; `src/features/shipping/server/rateResolution.ts`; `src/features/shipping/server/ruleEngine.ts` | SHARED | arm-01 F-013 = arm-02 F-025 + F-062 |
| R-033 | Card + offline checkout | `src/app/(storefront)/checkout/page.tsx`; `src/app/api/checkout/route.ts`; `src/app/api/checkout/offline/route.ts`; `src/features/orders/server/adminPayments.ts` | SHARED | arm-01 F-014 = arm-02 F-022 + F-023 |
| R-034 | Checkout stock + price validation | `src/app/(storefront)/checkout/page.tsx`; `src/features/checkout/server/checkoutValidation.ts`; `src/features/checkout/server/pricing.ts` | SHARED | arm-01 F-015 = arm-02 F-024 |
| R-035 | Checkout success experience | `src/app/(storefront)/checkout/success/page.tsx` | SHARED | arm-01 F-016 = arm-02 F-026 |
| R-036 | Payment recalculation on order changes | `src/features/payments/server/recalcOrderPayment.ts`; `src/features/payments/server/paymentMath.ts` | UNIQUE-TO-arm-02 | arm-02 F-027 |
| R-037 | Checkout recipient/donation summary + per-recipient delivery + bulk + live shipping + guest email + conflict/price UI | `src/features/checkout/components/CheckoutClient.tsx` | SHARED | arm-01 UI-039..UI-047 (arm-02 folds into F-021) |

## Customer account

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-038 | Account dashboard + auth-gated nav | `src/app/(storefront)/account/page.tsx`; `src/app/(storefront)/account/layout.tsx` | SHARED | arm-01 UI-049 = arm-02 F-028 |
| R-039 | Customer order history + detail | `src/app/(storefront)/account/orders/page.tsx`; `src/app/(storefront)/account/orders/[id]/page.tsx` | SHARED | arm-01 F-018 + F-019 = arm-02 F-029 |
| R-040 | Continue/pay/cancel a draft | `src/app/(storefront)/account/orders/[id]/page.tsx`; `src/app/(storefront)/account/orders/[id]/cancel-draft-button.tsx`; `src/features/orders/server/cancelOwnDraft.ts` | SHARED | arm-01 F-020 = arm-02 F-030 |
| R-041 | Repeat a prior customer order | `src/app/(storefront)/account/orders/[id]/repeat/page.tsx`; `src/features/orders/server/repeat/repeatOrder.ts`; `src/features/orders/server/repeat/buildRepeatPlan.ts`; `src/components/ordering/repeat-review.tsx` | SHARED | arm-01 F-021 = arm-02 F-031 |
| R-042 | Customer profile management (ownership-enforced) | `src/app/(storefront)/account/profile/page.tsx`; `src/app/(storefront)/account/profile/profile-form.tsx`; `src/app/api/account/profile/route.ts` | SHARED | arm-01 F-022 = arm-02 F-032 |
| R-043 | Saved-address account view | `src/app/(storefront)/account/addresses/page.tsx` | SHARED | arm-01 F-023 = arm-02 F-033 |

## Order lifecycle (shared business rules)

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-044 | Order status state machine + transitions | `src/features/orders/server/orderStateMachine.ts`; `src/features/orders/server/transitionOrder.ts` | UNIQUE-TO-arm-02 | arm-02 F-034 |
| R-045 | Order finalization (draft → placed, claims number) | `src/features/orders/server/finalizeOrder.ts` | UNIQUE-TO-arm-02 | arm-02 F-035 |
| R-046 | Draft discard | `src/features/orders/server/discardDraft.ts` | UNIQUE-TO-arm-02 | arm-02 F-036 |
| R-047 | Draft reference numbers + wire format | `src/features/orders/draftWire.ts`; `prisma/schema.prisma`; `prisma/migrations/20260611000000_draft_numbers/migration.sql` | UNIQUE-TO-arm-02 | arm-02 F-037 |
| R-048 | Cross-season product replacement chain | `src/app/(admin)/admin/products/[id]/replacement-editor.tsx`; `src/app/(admin)/admin/products/[id]/page.tsx`; `src/features/orders/server/repeat/replacementChain.ts`; `src/features/orders/server/repeat/matcher.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-044 = arm-02 F-038 |

## Admin — operations hub

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-049 | Permission-aware admin dashboard + KPIs + recent orders | `src/app/(admin)/admin/page.tsx`; `src/features/orders/server/dashboardStats.ts` | SHARED | arm-01 F-025 + UI-063 + UI-065 = arm-02 F-039 |
| R-050 | Daily operations "Today" work queue | `src/app/(admin)/admin/today/page.tsx`; `src/features/today/server/workQueue.ts` | SHARED | arm-01 F-026 = arm-02 F-040 |
| R-051 | Role + per-user permission enforcement | `src/config/permissions.ts`; `src/features/auth/server/requirePermission.ts`; `src/app/(admin)/admin/layout.tsx` | SHARED | arm-01 F-027 (arm-02 folds into SEC-005/SEC-006/SEC-011) |
| R-052 | Searchable filterable order list | `src/app/(admin)/admin/orders/page.tsx`; `src/app/(admin)/admin/orders/orders-search-bar.tsx` | SHARED | arm-01 F-028 + UI-068 = arm-02 F-041 |
| R-053 | Full admin order detail + money actions | `src/app/(admin)/admin/orders/[id]/page.tsx`; `src/app/(admin)/admin/orders/[id]/order-money-actions.tsx`; `src/features/orders/server/adminPayments.ts` | SHARED | arm-01 F-029 + F-030 = arm-02 F-042 |
| R-054 | Refunds (incl. Stripe refund path) | `src/features/refunds/server/createRefund.ts`; `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 F-043 |
| R-055 | Carrier label creation + voiding | `src/app/(admin)/admin/orders/[id]/shipment-actions.tsx`; `src/features/fulfillment/server/shipmentActions.ts`; `src/integrations/shippo.ts`; `src/features/shipping/server/shipmentPlanning.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-031 = arm-02 F-060 |
| R-056 | Printable order packing slips | `src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx`; `src/components/admin/print-button.tsx` | SHARED | arm-01 F-032 = arm-02 F-044 |
| R-057 | Staff single-order repeat workflow | `src/app/(admin)/admin/orders/[id]/repeat/page.tsx`; `src/features/orders/server/repeat/buildRepeatPlan.ts` | SHARED | arm-01 F-033 = arm-02 F-045 |
| R-058 | Bulk repeat of customer history | `src/app/(admin)/admin/orders/repeat-bulk/page.tsx`; `src/app/(admin)/admin/orders/repeat-bulk/bulk-repeat-form.tsx` | SHARED | arm-01 F-034 = arm-02 F-046 |
| R-059 | Staff point of sale | `src/app/(admin)/admin/pos/page.tsx`; `src/app/(admin)/admin/pos/pos-builder.tsx` | SHARED | arm-01 F-035 = arm-02 F-047 |
| R-060 | POS customer lookup + preselection + find-or-create | `src/app/(admin)/admin/pos/page.tsx`; `src/app/api/customers/search/route.ts`; `src/app/api/customers/find-or-create/route.ts` | SHARED | arm-01 F-036 (arm-02 folds into F-047 + F-049) |
| R-061 | POS checkout | `src/app/(admin)/admin/pos/checkout/[orderId]/page.tsx` | SHARED | arm-01 F-037 = arm-02 F-048 |
| R-062 | Customer directory + search + add | `src/app/(admin)/admin/customers/page.tsx`; `src/app/(admin)/admin/customers/customer-search.tsx`; `src/app/(admin)/admin/customers/add-customer-dialog.tsx`; `src/app/api/customers/search/route.ts`; `src/app/api/customers/find-or-create/route.ts` | SHARED | arm-01 F-038 + F-039 = arm-02 F-049 |
| R-063 | CSV customer/product import (staged atomic) | `src/components/admin/csv-import-dialog.tsx`; `src/features/imports/server/actions.ts`; `src/features/imports/server/batchEngine.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-039 + F-042 = arm-02 F-051 |
| R-064 | Customer detail + history | `src/app/(admin)/admin/customers/[id]/page.tsx`; `src/app/(admin)/admin/customers/[id]/customer-detail-client.tsx`; `src/features/customers/server/customerActions.ts` | SHARED | arm-01 F-040 = arm-02 F-050 |

## Admin — catalog & inventory

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-065 | Product catalog management (list/create/edit/detail/season) | `src/app/(admin)/admin/products/page.tsx`; `src/app/(admin)/admin/products/product-form.tsx`; `src/app/(admin)/admin/products/product-actions.tsx`; `src/app/(admin)/admin/products/new/page.tsx`; `src/app/(admin)/admin/products/[id]/edit/page.tsx`; `src/app/(admin)/admin/products/season-select.tsx`; `src/app/(admin)/admin/products/[id]/page.tsx`; `src/features/products/server/productActions.ts` | SHARED | arm-01 F-041 + F-042 + F-043 = arm-02 F-052 |
| R-066 | Add-on catalog management | `src/app/(admin)/admin/addons/page.tsx`; `src/app/(admin)/admin/addons/addon-actions.tsx`; `src/features/imports/server/actions.ts` | SHARED | arm-01 F-045 = arm-02 F-053 |
| R-067 | Media library + photo assignment (Vercel Blob) | `src/app/(admin)/admin/media/page.tsx`; `src/app/(admin)/admin/media/media-actions.tsx`; `src/app/(admin)/admin/media/needs-photos-panel.tsx`; `src/components/admin/media-picker.tsx`; `src/app/api/media/route.ts`; `src/app/api/media/[id]/route.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-046 = arm-02 F-054 |
| R-068 | Inventory overview dashboard | `src/app/(admin)/admin/inventory/page.tsx`; `src/app/(admin)/admin/inventory/overview-tab.tsx`; `src/app/(admin)/admin/inventory/inventory-tabs.tsx`; `src/features/inventory/server/dashboard.ts` | SHARED | arm-01 F-047 = arm-02 F-055 |
| R-069 | Production batch planning + history | `src/app/(admin)/admin/inventory/production-tab.tsx`; `src/app/(admin)/admin/inventory/daily-batch-dialog.tsx`; `src/app/(admin)/admin/inventory/production-history.tsx`; `src/features/inventory/server/production.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-048 = arm-02 F-056 |
| R-070 | Inventory adjustments + write-offs + shortfall | `src/app/(admin)/admin/inventory/inventory-controls.tsx`; `src/features/inventory/server/actions.ts`; `src/features/inventory/server/writeoff.ts`; `src/features/inventory/server/shortfall.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-049 = arm-02 F-058 |
| R-071 | Stock reserve/allocate/release engine | `src/features/inventory/server/reserve.ts`; `src/features/inventory/server/allocate.ts`; `src/features/inventory/server/release.ts`; `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 F-057 |

## Admin — fulfillment & delivery

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-072 | Fulfillment channel dashboard + bulk status actions | `src/app/(admin)/admin/fulfillment/page.tsx`; `src/features/fulfillment/server/fulfillmentPool.ts`; `src/app/(admin)/admin/fulfillment/channel-action-button.tsx`; `src/features/fulfillment/server/fulfillmentActions.ts` | SHARED | arm-01 F-050 + F-051 = arm-02 F-059 |
| R-073 | Fulfillment production + savings summaries | `src/app/(admin)/admin/fulfillment/page.tsx` | SHARED | arm-01 UI-088 (arm-02 folds into F-059) |
| R-074 | Delivery route builder (Mapbox) | `src/app/(admin)/admin/fulfillment/build-route/page.tsx`; `src/app/(admin)/admin/fulfillment/build-route/route-builder.tsx`; `src/app/api/route-builder/refresh-coords/route.ts`; `src/features/shipping/server/geocode.ts` | SHARED | arm-01 F-052 = arm-02 F-063 |
| R-075 | Route administration (list/detail/reassign/print) | `src/app/(admin)/admin/routes/page.tsx`; `src/app/(admin)/admin/routes/[id]/page.tsx`; `src/app/(admin)/admin/routes/[id]/reassign-button.tsx`; `src/app/(admin)/admin/routes/[id]/print/page.tsx`; `src/features/fulfillment/server/routeActions.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-053 + F-054 = arm-02 F-064 |
| R-076 | Greeting cards print view per route | `src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx` | SHARED | arm-01 F-054 (arm-02 splits to F-065) |
| R-077 | Driver route list (messenger portal) | `src/app/(messenger)/messenger/page.tsx`; `src/app/(messenger)/messenger/layout.tsx` | SHARED | arm-01 F-055 = arm-02 F-066 |
| R-078 | Driver stop cards + route start/delivery completion | `src/app/(messenger)/messenger/routes/[id]/page.tsx`; `src/app/(messenger)/messenger/routes/[id]/start-route-button.tsx`; `src/app/(messenger)/messenger/routes/[id]/deliver-button.tsx`; `src/features/fulfillment/server/markDelivered.ts` | SHARED | arm-01 F-056 + F-057 = arm-02 F-067 |
| R-079 | Follow-up call center | `src/app/(admin)/admin/follow-up/page.tsx`; `src/app/(admin)/admin/follow-up/follow-up-list.tsx`; `src/app/(admin)/admin/follow-up/follow-up-filters.tsx` | SHARED | arm-01 F-058 = arm-02 F-068 |
| R-080 | Automated payment + pickup follow-up (cron) | `src/app/api/cron/payment-reminders/route.ts`; `src/app/api/cron/pickup-expiry/route.ts` | SHARED | arm-01 F-059 = arm-02 F-075 + F-076 |
| R-081 | Shipment planning + bin packing | `src/features/shipping/server/binPacking.ts`; `src/features/shipping/server/shipmentPlanning.ts`; `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 F-061 |

## Admin — email & marketing

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-082 | Email hub (5-tab management) | `src/app/(admin)/admin/email/page.tsx`; `src/app/(admin)/admin/email/email-tabs.tsx`; `src/app/(admin)/admin/email/campaigns-tab.tsx` | SHARED | arm-01 F-060 + F-061 + F-062 (arm-02 folds into F-069) |
| R-083 | Campaign builder + send | `src/app/(admin)/admin/email/campaign-builder.tsx`; `src/app/(admin)/admin/email/campaign-blocks.ts`; `src/app/(admin)/admin/email/new/page.tsx`; `src/app/(admin)/admin/email/[id]/edit/page.tsx`; `src/features/email/server/campaignSend.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-060 = arm-02 F-070 |
| R-084 | Subscriber + mailing-list management | `src/app/(admin)/admin/email/subscribers-tab.tsx`; `src/app/(admin)/admin/email/lists-tab.tsx`; `src/features/email/server/marketingActions.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-061 = arm-02 F-071 |
| R-085 | Email templates + branding | `src/app/(admin)/admin/email/templates-tab.tsx`; `src/features/email/server/templateActions.ts`; `src/features/email/server/templateRender.ts` | SHARED | arm-01 F-062 (arm-02 splits to F-072) |
| R-086 | Triggered/transactional emails + overrides + idempotency | `src/app/(admin)/admin/email/triggered-tab.tsx`; `src/app/(admin)/admin/email/triggered/[key]/edit/page.tsx`; `src/features/email/server/triggeredEmailDefaults.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-062 (arm-02 splits to F-073) |
| R-087 | Order lifecycle emails (confirmation/payment link/refund) | `src/features/email/server/orderEmails.ts`; `src/features/email/server/orderSummaryHtml.ts`; `src/features/email/server/dispatchEmail.ts`; `src/server/outbox.ts` | UNIQUE-TO-arm-02 | arm-02 F-074 |
| R-088 | Transactional outbox + retrying sweeper | `src/server/outbox.ts`; `src/app/api/cron/outbox-sweep/route.ts`; `prisma/schema.prisma` | SHARED | arm-01 INT-019 = arm-02 F-077 |
| R-089 | Email campaign lifecycle UI (draft/sent lists) | `src/app/(admin)/admin/email/campaigns-tab.tsx` | SHARED | arm-01 UI-090 (arm-02 folds into F-069) |
| R-090 | Email test sender | `src/app/(admin)/admin/settings/email-tab.tsx` | SHARED | arm-01 UI-097 (arm-02 folds into F-085) |

## Admin — reporting, money & exports

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-091 | Multi-season performance reports + drill-downs | `src/app/(admin)/admin/reports/page.tsx`; `src/features/reports/server/seasonReports.ts` | SHARED | arm-01 F-068 = arm-02 F-078 + F-079 |
| R-092 | CSV export center + audit history | `src/app/(admin)/admin/export/page.tsx`; `src/app/api/export/deliveries/route.ts`; `src/app/api/export/year-end/route.ts`; `src/app/api/export/year-metrics/route.ts`; `src/app/api/export/item-sales/route.ts`; `src/app/api/export/lapsed-customers/route.ts`; `src/features/exports/server/exportResponse.ts`; `src/lib/csv.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-069 = arm-02 F-080 + F-081 |
| R-093 | Stripe payment reconciliation | `src/app/(admin)/admin/reconciliation/page.tsx`; `src/app/(admin)/admin/reconciliation/run-button.tsx`; `src/features/reconciliation/server/runReconciliation.ts`; `src/features/reconciliation/server/matcher.ts`; `src/app/api/cron/reconcile-stripe/route.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-070 = arm-02 F-082 |

## Admin — configuration & staff tooling

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-094 | Settings hub + Orders tab (store status, package types, pickup, follow-up) | `src/app/(admin)/admin/settings/page.tsx`; `src/app/(admin)/admin/settings/orders-tab.tsx`; `src/app/(admin)/admin/settings/store-status-card.tsx`; `src/app/(admin)/admin/settings/package-types-card.tsx`; `src/app/(admin)/admin/settings/pickup-locations-card.tsx`; `src/app/(admin)/admin/settings/follow-up-settings.tsx` | SHARED | arm-01 F-064 = arm-02 F-083 |
| R-095 | Settings Shipping tab (rates, rules, delivery ZIPs) | `src/app/(admin)/admin/settings/shipping-tab.tsx`; `src/app/(admin)/admin/settings/delivery-zips-card.tsx`; `src/app/(admin)/admin/settings/shipping-rates-card.tsx`; `src/app/(admin)/admin/settings/shipping-rules-card.tsx` | SHARED | arm-01 F-065 = arm-02 F-084 |
| R-096 | Settings Email + Developer tabs | `src/app/(admin)/admin/settings/email-tab.tsx`; `src/app/(admin)/admin/settings/developer-tab.tsx`; `src/app/(admin)/admin/settings/page.tsx` | SHARED | arm-01 F-067 = arm-02 F-085 |
| R-097 | New-season setup wizard | `src/app/(admin)/admin/settings/new-season-wizard.tsx`; `src/features/settings/server/actions.ts` | SHARED | arm-01 F-066 = arm-02 F-086 |
| R-098 | Staff account + permission management | `src/app/(admin)/admin/users/page.tsx`; `src/app/(admin)/admin/users/users-client.tsx`; `src/app/(admin)/admin/users/add-staff-dialog.tsx`; `src/app/(admin)/admin/users/permission-overrides-dialog.tsx`; `src/features/users/server/actions.ts` | SHARED | arm-01 F-071 = arm-02 F-087 |
| R-099 | Staff impersonation | `src/app/(admin)/admin/impersonate/page.tsx`; `src/app/(admin)/admin/impersonate/impersonate-button.tsx`; `src/app/api/impersonate/route.ts`; `src/features/auth/server/impersonation.ts`; `src/components/admin/impersonation-bar.tsx` | SHARED | arm-01 F-072 = arm-02 F-088 |
| R-100 | Administrative activity log | `src/app/(admin)/admin/audit-log/page.tsx`; `src/app/(admin)/admin/audit-log/audit-table.tsx`; `src/features/auth/server/audit.ts` | SHARED | arm-01 F-073 = arm-02 F-089 |
| R-101 | Test-environment operations console | `src/app/(admin)/admin/test-mode/page.tsx`; `src/app/(admin)/admin/test-mode/seed-buttons.tsx`; `src/app/(admin)/admin/test-mode/reset-button.tsx`; `src/app/(admin)/admin/test-mode/clear-emails-button.tsx`; `src/features/testdata/server/testModeActions.ts`; `src/features/testdata/server/seedTestSeason.ts`; `src/features/testdata/server/wipeTestData.ts`; `scripts/reset-test-db.ts`; `scripts/seed-test-season.ts` | SHARED | arm-01 F-074 = arm-02 F-092 |
| R-102 | Staff help center + guided tours | `src/app/(admin)/admin/help/page.tsx`; `src/app/(admin)/admin/help/help-articles.ts`; `src/app/(admin)/admin/help/help-content.tsx`; `src/features/tours/tours.ts`; `src/features/tours/admin-tour.tsx`; `src/features/tours/run-driver.ts` | SHARED | arm-01 F-075 = arm-02 F-090 + F-091 |
| R-103 | Test/live environment switch | `src/app/(admin)/admin/env-switch/route.ts`; `src/components/admin/env-switch-link.tsx`; `src/app/(admin)/admin/admin-shell.tsx` | SHARED | arm-01 F-076 = arm-02 F-093 |
| R-104 | Admin shell + permission-gated sidebar + mobile nav | `src/app/(admin)/admin/admin-shell.tsx`; `src/components/admin/admin-sidebar.tsx`; `src/components/admin/sidebar-config.ts`; `src/components/admin/mobile-nav.tsx` | UNIQUE-TO-arm-02 | arm-02 F-UI-031 |
| R-105 | Shared admin list controls (search/pagination/sort/badges) | `src/components/admin/list-search.tsx`; `src/components/admin/pagination.tsx`; `src/components/admin/page-size-selector.tsx`; `src/components/admin/remember-list-url.tsx`; `src/components/ui/sortable-table.tsx`; `src/components/ui/responsive-table.tsx`; `src/components/admin/status-badges.tsx` | UNIQUE-TO-arm-02 | arm-02 F-UI-069 |
| R-106 | Admin chrome links (visit-store, alert banner, back link) | `src/components/admin/visit-store-link.tsx`; `src/components/admin/alert-banner.tsx`; `src/components/admin/back-link.tsx` | UNIQUE-TO-arm-02 | arm-02 F-UI-070 |

## Auth, permissions & security controls

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-107 | Clerk identity integration + middleware | `src/middleware.ts`; `src/integrations/clerk.ts` | SHARED | arm-01 SEC-001 = arm-02 SEC-001 + SEC-002 |
| R-108 | Sign-in / sign-up pages | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`; `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`; `src/config/env-schema.ts` | SHARED | arm-01 F-017 = arm-02 SEC-003 |
| R-109 | Role model: RBAC + linear rank + allow-list carve-outs | `src/config/permissions.ts`; `prisma/schema.prisma` | SHARED | arm-01 F-027 + SEC-003 (arm-02 SEC-004, CONFLICT — see Conflicts) |
| R-110 | Per-user permission grants/denies + override editor | `src/config/permissions.ts`; `src/features/auth/server/requirePermission.ts`; `src/features/auth/server/resolveUser.ts`; `src/features/users/server/actions.ts`; `prisma/schema.prisma` | SHARED | arm-01 SEC-003 = arm-02 SEC-005 + SEC-018 |
| R-111 | Server-side authorization gate (requirePermission) | `src/features/auth/server/requirePermission.ts` | SHARED | arm-01 SEC-003 (arm-02 splits to SEC-006) |
| R-112 | Staff confirmation + revocation gate | `src/features/auth/server/resolveUser.ts`; `src/app/(admin)/admin/layout.tsx`; `src/features/users/server/actions.ts` | SHARED | arm-01 SEC-004 = arm-02 SEC-007 + SEC-011 + SEC-017 |
| R-113 | Staff invitation identity linking | `src/features/auth/server/resolveUser.ts` | SHARED | arm-01 SEC-005 = arm-02 SEC-008 |
| R-114 | Customer identity linking + owned profile updates | `src/features/auth/server/customer.ts`; `src/features/auth/server/ensureCustomer.ts`; `src/app/api/account/profile/route.ts` | UNIQUE-TO-arm-01 | arm-01 SEC-006; arm-02 has no dedicated row (folded into F-032) |
| R-115 | Admin + messenger application gates | `src/app/(admin)/admin/layout.tsx`; `src/app/(messenger)/messenger/layout.tsx` | SHARED | arm-01 SEC-007 = arm-02 SEC-011 + SEC-012 |
| R-116 | Driver route ownership scoping | `src/app/(messenger)/messenger/routes/[id]/page.tsx` | SHARED | arm-01 SEC-008 (arm-02 folds into SEC-012) |
| R-117 | "Must be staff" hard guard + storefront staff check | `src/features/auth/server/staff.ts` | UNIQUE-TO-arm-02 | arm-02 SEC-009 |
| R-118 | canDrive carve-out for driver-route permissions | `src/config/permissions.ts`; `src/features/auth/server/requirePermission.ts` | UNIQUE-TO-arm-02 | arm-02 SEC-010 |
| R-119 | Staff-management mutation hardening (self-target blocks) | `src/features/users/server/actions.ts` | SHARED | arm-01 SEC-009 = arm-02 SEC-016 |
| R-120 | Security-relevant audit trail + session login stamp | `src/features/auth/server/audit.ts`; `src/features/auth/server/staff.ts`; `prisma/schema.prisma` | SHARED | arm-01 SEC-011 = arm-02 SEC-014 + SEC-029 |
| R-121 | Draft-order ownership + anti-enumeration gate | `src/features/orders/server/orderAccess.ts`; `src/features/checkout/server/checkoutToken.ts` | SHARED | arm-01 SEC-012 (arm-02 folds into F-021) |
| R-122 | Guarded public JSON endpoints (same-origin + IP rate limit + Zod) | `src/server/withPublicGuard.ts`; `src/app/api/subscribe/route.ts`; `src/app/api/checkout/route.ts`; `prisma/schema.prisma` | SHARED | arm-01 SEC-013 = arm-02 SEC-019 |
| R-123 | Signed email-preference changes (HMAC, timing-safe) | `src/features/email/server/unsubscribeToken.ts`; `src/app/api/unsubscribe/route.ts` | SHARED | arm-01 SEC-014 (arm-02 folds into F-009) |
| R-124 | Cron endpoint authentication (bearer secret) | `src/server/verifyCronSecret.ts`; `src/app/api/cron/outbox-sweep/route.ts` | SHARED | arm-01 SEC-015 = arm-02 SEC-020 |
| R-125 | Stripe webhook authenticity + idempotency | `src/app/api/webhooks/stripe/route.ts`; `src/features/payments/server/webhookIdempotency.ts`; `prisma/schema.prisma` | SHARED | arm-01 SEC-016 + SEC-017 = arm-02 SEC-021 |
| R-126 | Charged-amount + fulfillment safety checks (auto-refund stale/failed) | `src/app/api/webhooks/stripe/route.ts`; `src/features/checkout/server/checkoutValidation.ts` | SHARED | arm-01 SEC-018 (arm-02 folds into F-043/INT-006) |
| R-127 | Server-enforced offline payment policy | `src/app/api/checkout/offline/route.ts` | SHARED | arm-01 SEC-019 (arm-02 folds into F-023) |
| R-128 | Restricted + validated media uploads | `src/app/api/media/route.ts`; `src/app/api/media/[id]/route.ts` | SHARED | arm-01 SEC-020 (arm-02 folds into F-054/SEC-026) |
| R-129 | Test-only destructive operations (reset/wipe/seed) | `src/app/api/admin/reset-test-db/route.ts`; `src/app/api/admin/wipe-test-data/route.ts`; `src/app/api/admin/seed-test-season/route.ts` | SHARED | arm-01 SEC-021 = arm-02 SEC-025 |
| R-130 | Empty-database bootstrap lockout | `src/app/api/setup/route.ts` | SHARED | arm-01 SEC-022 (arm-02 folds into F-010) |
| R-131 | Startup secret + environment validation | `src/config/env-schema.ts`; `src/config/env.ts`; `scripts/gen-env-example.ts`; `.env.example` | SHARED | arm-01 SEC-023 = arm-02 SEC-028 |
| R-132 | Bounded, redacted client error ingestion | `src/app/api/client-error/route.ts`; `src/server/withPublicGuard.ts` | SHARED | arm-01 SEC-024 (arm-02 folds into F-UI-076) |
| R-133 | Automated repository security guardrails (CI) | `.github/workflows/agent-guardrails.yml` | SHARED | arm-01 SEC-026 = arm-02 SEC-032 |
| R-134 | Guarded staff-only API routes (media/exports/route-builder) | `src/app/api/media/route.ts`; `src/app/api/export/deliveries/route.ts`; `src/app/api/route-builder/refresh-coords/route.ts` | UNIQUE-TO-arm-02 | arm-02 SEC-026 |
| R-135 | Permission unit tests | `src/config/permissions.test.ts`; `src/features/auth/server/requirePermission.test.ts` | UNIQUE-TO-arm-02 | arm-02 SEC-030 |
| R-136 | Production error masking for server actions | `src/lib/result/index.ts` | UNIQUE-TO-arm-02 | arm-02 SEC-031 |

## Data model & data infrastructure

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-137 | Normalized relational app schema (Postgres/Prisma) | `prisma/schema.prisma`; `src/server/db.ts`; `.env.example` | SHARED | arm-01 DATA-001 = arm-02 D-001 |
| R-138 | DB-enforced lifecycle + category enums | `prisma/schema.prisma`; `prisma/migrations/20260603000000_init/migration.sql` | SHARED | arm-01 DATA-002 (arm-02 folds into D-001 + D-002) |
| R-139 | Inventory-target integrity (XOR CHECK) constraints | `prisma/migrations/20260603000000_init/migration.sql`; `scripts/test-migration.mjs` | SHARED | arm-01 DATA-003 (arm-02 folds into D-026) |
| R-140 | Ordered migrations + schema-change guard (CI) | `prisma/migrations/`; `scripts/check-schema-has-migration.mjs`; `.github/workflows/ci.yml` | SHARED | arm-01 DATA-004 = arm-02 D-052 |
| R-141 | Disposable migration verification harness | `scripts/test-migration.mjs` | SHARED | arm-01 DATA-005 = arm-02 D-053 |
| R-142 | Repeatable baseline seed | `prisma/seed.ts` | SHARED | arm-01 DATA-006 = arm-02 D-048 |
| R-143 | Auditable staged import pipeline + atomic commits | `src/features/imports/server/batchEngine.ts`; `prisma/schema.prisma` | SHARED | arm-01 DATA-007 + DATA-008 (arm-02 folds into F-051) |
| R-144 | Customer records (normalized phone/email + dedupe) | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-004 |
| R-145 | Saved addresses with geocoding fields | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-005 |
| R-146 | Season model gating catalog per year | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-007 |
| R-147 | Product catalog schema (dims, inventory flags, kinds) | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-008 |
| R-148 | Product options with price adjustments | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-009 |
| R-149 | Normalized order tree (Order → OrderLine → add-ons) | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-013 |
| R-150 | Price snapshots on order lines | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-014 |
| R-151 | Sequential order numbers per season | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-015 |
| R-152 | Cached derived payment status on orders | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-017 |
| R-153 | Fulfillment groups (multi-destination) + snapshots | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-018 |
| R-154 | Data-driven fulfillment methods | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-019 |
| R-155 | Shipping quotes with selectable expiring options | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-020 |
| R-156 | Pickup locations | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-022 |
| R-157 | Package types + shipment boxes | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-023 |
| R-158 | Unified inventory (products + add-ons, versioned) | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-026 |
| R-159 | Stripe PaymentIntent modeling | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-030 |
| R-160 | Payments (stripe/cash/check/comp) with posted/voided states | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-031 |
| R-161 | Key-value settings store with typed registry | `prisma/schema.prisma`; `src/config/settings.ts`; `prisma/seed.ts` | UNIQUE-TO-arm-02 | arm-02 D-037 |
| R-162 | Geocode cache with success/failure TTLs | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-040 |
| R-163 | Cron/job run log | `prisma/schema.prisma` | UNIQUE-TO-arm-02 | arm-02 D-044 |
| R-164 | Data-layer helper libraries (money/normalize/phone/ids/season/dates/result) | `src/lib/money/index.ts`; `src/lib/normalize/index.ts`; `src/lib/phone/index.ts`; `src/lib/ids/index.ts`; `src/lib/season/index.ts`; `src/lib/dates/index.ts`; `src/lib/result/index.ts` | UNIQUE-TO-arm-02 | arm-02 D-054 |
| R-165 | Legacy→new data migration plan (documented entity map) | `DATA-MIGRATION-INVENTORY.md` | UNIQUE-TO-arm-02 | arm-02 D-055; FLAGGED — referenced `scripts/migrate-from-old.ts` does NOT exist in tree; retained as doc-only evidence |

## Integrations & platform

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-166 | Stripe hosted checkout session | `src/app/api/checkout/route.ts`; `src/features/checkout/components/CheckoutClient.tsx` | SHARED | arm-01 INT-003 = arm-02 F-022 (CONFLICT — see Conflicts re: client Stripe packages) |
| R-167 | Stripe payment webhook processing | `src/app/api/webhooks/stripe/route.ts` | SHARED | arm-01 INT-004 = arm-02 F-022/SEC-021 |
| R-168 | Stripe refund synchronization | `src/app/api/webhooks/stripe/route.ts` | SHARED | arm-01 INT-005 (arm-02 folds into F-043) |
| R-169 | Stripe automatic safety refunds | `src/app/api/webhooks/stripe/route.ts` | SHARED | arm-01 INT-006 (arm-02 folds into F-043) |
| R-170 | Shared Stripe server client (lazy singleton) | `src/integrations/stripe.ts` | UNIQUE-TO-arm-02 | arm-02 INT-003 |
| R-171 | Resend email sender (SDK isolated) | `src/integrations/resend.ts`; `src/features/email/server/dispatchEmail.ts` | UNIQUE-TO-arm-02 | arm-02 INT-009 |
| R-172 | Email log purge cron | `src/app/api/cron/purge-email-log/route.ts`; `vercel.json` | SHARED | arm-01 INT-021 = arm-02 INT-013 |
| R-173 | Shippo SDK wrapper (rate/buy/void/track/validate) | `src/integrations/shippo.ts` | SHARED | arm-01 INT-008..INT-012 (arm-02 consolidates to INT-014) |
| R-174 | Shippo rate lookup + cheapest-rate selection | `src/integrations/shippo.ts`; `src/features/fulfillment/server/shipmentActions.ts`; `src/features/shipping/server/shipmentPlanning.ts` | SHARED | arm-01 INT-008 (arm-02 folds into F-060) |
| R-175 | Shippo label failure compensation | `src/features/fulfillment/server/shipmentActions.ts`; `src/integrations/shippo.ts` | SHARED | arm-01 INT-010 (arm-02 folds into F-060) |
| R-176 | Shippo tracking refresh | `src/features/fulfillment/server/shipmentActions.ts`; `src/integrations/shippo.ts` | SHARED | arm-01 INT-011 (arm-02 folds into F-060) |
| R-177 | Shippo address validation | `src/features/fulfillment/server/shipmentActions.ts`; `src/integrations/shippo.ts` | SHARED | arm-01 INT-012 (arm-02 folds into F-060) |
| R-178 | Idempotent email sending + test capture | `src/features/email/server/dispatchEmail.ts` | SHARED | arm-01 INT-016 (arm-02 folds into F-073/F-074) |
| R-179 | Mapbox geocoding with cache | `src/integrations/mapbox.ts`; `src/features/shipping/server/geocode.ts`; `src/features/shipping/server/geocodeRefresh.ts` | SHARED | arm-01 INT-017 = arm-02 INT-017 |
| R-180 | Vercel Blob media storage | `src/app/api/media/route.ts`; `src/app/api/media/[id]/route.ts`; `next.config.ts` | SHARED | arm-01 INT-018 (arm-02 folds into F-054) |
| R-181 | Secured outbox integration sweep | `src/app/api/cron/outbox-sweep/route.ts`; `src/server/verifyCronSecret.ts` | SHARED | arm-01 INT-019 = arm-02 F-077 |
| R-182 | Secured pickup-expiry operation | `src/app/api/cron/pickup-expiry/route.ts`; `src/server/verifyCronSecret.ts` | SHARED | arm-01 INT-020 = arm-02 F-076 |
| R-183 | Typed optional-provider handling (Shippo/Mapbox) | `.env.example`; `src/config/env.ts`; `src/integrations/shippo.ts`; `src/integrations/mapbox.ts` | SHARED | arm-01 INT-022 (arm-02 folds into INT-014/INT-017) |
| R-184 | UPS direct credentials declared, not implemented | `.env.example`; `src/config/env-schema.ts` | UNIQUE-TO-arm-02 | arm-02 INT-021; declaration-only caveat |
| R-185 | Vercel Cron jobs (5) with secret auth | `vercel.json`; `src/server/verifyCronSecret.ts` | UNIQUE-TO-arm-02 | arm-02 INT-024 |
| R-186 | Nexternal legacy import pipeline + order-number repair | `scripts/nexternal/shared/excel.ts`; `scripts/nexternal/customers/*`; `scripts/nexternal/products/importProducts.ts`; `scripts/nexternal/historical/*`; `scripts/nexternal/fix-order-numbers.ts`; `package.json` | SHARED | arm-01 DATA-012..DATA-018 = arm-02 INT-026 |
| R-187 | Health check (DB + env validation) | `src/app/api/health/route.ts` | UNIQUE-TO-arm-02 | arm-02 INT-027 |

## Design system / app-wide UI

| ID | Name | Evidence path(s) | Tag | Notes |
|---|---|---|---|---|
| R-188 | shadcn-style UI kit | `src/components/ui/button.tsx`; `src/components/ui/dialog.tsx`; `src/components/ui/tabs.tsx`; `components.json` | UNIQUE-TO-arm-02 | arm-02 F-UI-073 |
| R-189 | Custom UI primitives (confirm/empty/FAB/info-hint/page-header/pill/price-tag/smart-select/callout) | `src/components/ui/confirm-dialog.tsx`; `src/components/ui/empty-state.tsx`; `src/components/ui/fab.tsx`; `src/components/ui/info-hint.tsx`; `src/components/ui/page-header.tsx`; `src/components/ui/pill-input.tsx`; `src/components/ui/price-tag.tsx`; `src/components/ui/smart-select.tsx`; `src/components/ui/callout.tsx` | UNIQUE-TO-arm-02 | arm-02 F-UI-074 |
| R-190 | Design tokens + global styles + brand constants | `src/styles/tokens.css`; `src/app/globals.css`; `src/lib/brand.ts` | UNIQUE-TO-arm-02 | arm-02 F-UI-075 |
| R-191 | Global error page + root layout (client error reporting) | `src/app/error.tsx`; `src/app/layout.tsx`; `src/app/api/client-error/route.ts` | UNIQUE-TO-arm-02 | arm-02 F-UI-076 |
| R-192 | Marketing imagery assets | `public/images/hero.png`; `public/images/mission-shabbos-table.jpg`; `public/images/mission-volunteers.jpg` | UNIQUE-TO-arm-02 | arm-02 F-UI-077 |

## Conflicts (inherited from arm-02)

1. **Role count — arm-02 SEC-004 vs D-002.** `src/config/permissions.ts` (six roles incl. customer) vs `prisma/schema.prisma` StaffRole enum (five staff roles). Likely customer is a permissions-layer pseudo-role. Carried forward as R-109; needs source verification before Test 2.
2. **Stripe client packages — arm-02 INT-029 vs F-022/INT-004.** `package.json` declares `@stripe/stripe-js` + `@stripe/react-stripe-js`, but `src/app/api/checkout/route.ts` is hosted-redirect Checkout with no client mount in `src/`. Dead deps or unshipped embedded flow. Carried forward as R-166; needs verification.

## Hallucinations dropped / flagged

- **FLAGGED (not dropped):** R-165 (arm-02 D-055) cites `scripts/migrate-from-old.ts`, which does NOT exist in the source tree. Primary evidence `DATA-MIGRATION-INVENTORY.md` does exist. Retained as documentation-only evidence; arm-02 self-flagged this.
- **No other hallucinations detected.** Every other evidence path cited by either arm resolves to a real file in the source tree. No invented features were introduced; all reconciled rows trace to at least one arm's inventory.

## Counts

- **Total reconciled features:** 192
- **SHARED:** 136
- **UNIQUE-TO-arm-01:** 4 (R-015, R-016, R-017 — package category filters / price sorting / sold-out handling; R-114 — customer identity linking)
- **UNIQUE-TO-arm-02:** 52
- **Conflicts carried forward:** 2
- **Hallucinations dropped:** 0 (1 flagged doc-only path retained with caveat)

### Method notes
- Union only; no new features invented. Each row maps to one or both arm inventories.
- Deduplication by meaning + evidence path: arm-01's coarser rows (e.g. F-014 card+offline, F-069 export center+endpoints) were merged with arm-02's split rows; arm-02's finer data-schema rows (D-004..D-044) with no arm-01 counterpart are retained as UNIQUE-TO-arm-02.
- arm-01 produced many UI-tagged rows (UI-*) absent from arm-02; those with no arm-02 counterpart are UNIQUE-TO-arm-01 only where arm-02 lacks any row for the same evidence — but in nearly all cases arm-02 folded the same evidence into a product-slice row, so they are SHARED. The single genuinely arm-01-only behavior is R-114.
- Reviewer did not see contestant model names; only arm ids were used.
