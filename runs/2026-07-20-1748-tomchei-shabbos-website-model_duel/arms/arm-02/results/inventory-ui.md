# Codebase inventory — arm-02 (job: UI)

Source root: `D:\Projects\Personal\Tools\agent-duel-harness\.scratch\sources\tomche-shabbos-website`
All evidence paths below are relative to that root.

## Proof-of-read
- Rules files read: 7 (arm `AGENTS.md`, `rules/workflow.md`, `rules/vocabulary.md`, `rules/grill-protocol.md`, `rules/ponytail.md`, `rules/clean-code.md`, `rules/codegraph.md`)
- Codegraph: no `.codegraph/` index in source and source is read-only — used file reads only.
- Top-level dirs sampled: `src/app` (storefront, admin, messenger, auth route groups), `src/components` (admin, storefront, ordering, ui), `src/features` (order-builder, checkout, tours), `src/styles`, `public/images`.
- Scope: user-visible UI (pages, screens, dialogs, controls, layout, design system). Server logic, data model, and integrations left to the other job slices.

## Features

### Storefront (customer-facing)

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-UI-001 | Marketing home page: hero, how-it-works steps, package grid, mission section, testimonials, final CTA | `src/app/(storefront)/page.tsx` | Server component; loads season's products; sections documented in file header |
| F-UI-002 | Animated impact-stats bar on home page | `src/components/storefront/home-impact-bar.tsx` | Count-up numbers, client component |
| F-UI-003 | Storefront shell: sticky glass header, logo/brand initials, desktop nav, auth CTAs, 3-column footer | `src/app/(storefront)/layout.tsx` | Uses `src/lib/brand.ts` for brand name/initials |
| F-UI-004 | Store-closed banner when ordering is off-season | `src/app/(storefront)/layout.tsx` (storeOpen block) | Message from store status settings |
| F-UI-005 | Mobile sheet menu | `src/components/storefront/mobile-menu.tsx` | Header hamburger menu |
| F-UI-006 | Signed-in user menu (with staff link when staff) | `src/components/storefront/user-menu.tsx` | Rendered in header via Clerk `Show` |
| F-UI-007 | Footer email-subscribe form | `src/components/storefront/email-subscribe.tsx` | Posts to subscribe API |
| F-UI-008 | Packages catalog page with grid + loading skeleton | `src/app/(storefront)/packages/page.tsx`, `src/app/(storefront)/packages/packages-grid.tsx`, `src/app/(storefront)/packages/loading.tsx` | |
| F-UI-009 | Package detail page | `src/app/(storefront)/packages/[id]/page.tsx` | |
| F-UI-010 | Product quick-view modal (storefront) | `src/components/storefront/product-quick-view.tsx` | |
| F-UI-011 | Multi-recipient order builder (shared storefront/POS shell) | `src/app/(storefront)/order/order-builder.tsx`, `src/features/order-builder/components/OrderBuilderShell.tsx` | Provider + shared shell, source "web" |
| F-UI-012 | Order builder product panel + product cards + quick view | `src/features/order-builder/components/ProductPanel.tsx`, `src/features/order-builder/components/ProductCard.tsx`, `src/features/order-builder/components/ProductQuickView.tsx` | |
| F-UI-013 | Order sidebar (cart) + mobile cart FAB | `src/features/order-builder/components/OrderSidebar.tsx`, `src/features/order-builder/components/MobileCartFab.tsx` | |
| F-UI-014 | Add-recipient dialog and recipient-assign dialog | `src/features/order-builder/components/AddRecipientDialog.tsx`, `src/features/order-builder/components/RecipientAssignDialog.tsx` | |
| F-UI-015 | Saved-address editing in builder | `src/features/order-builder/components/EditSavedAddressDialog.tsx` | |
| F-UI-016 | Draft autosave + guest-draft clear on success | `src/features/order-builder/components/AutoSave.tsx`, `src/features/order-builder/components/ClearGuestDraftOnSuccess.tsx` | |
| F-UI-017 | Address autocomplete + structured address fields | `src/components/ordering/address-autocomplete.tsx`, `src/components/ordering/address-fields.tsx` | Mapbox-backed autocomplete |
| F-UI-018 | Checkout page: per-recipient summary, shipping quotes, payment choice (card/check/cash) | `src/app/(storefront)/checkout/page.tsx`, `src/features/checkout/components/CheckoutClient.tsx` | Shared by web and POS modes |
| F-UI-019 | Checkout success page | `src/app/(storefront)/checkout/success/page.tsx` | |
| F-UI-020 | Account area: dashboard + sub-nav layout | `src/app/(storefront)/account/page.tsx`, `src/app/(storefront)/account/layout.tsx` | |
| F-UI-021 | Account order history list + order detail | `src/app/(storefront)/account/orders/page.tsx`, `src/app/(storefront)/account/orders/[id]/page.tsx` | |
| F-UI-022 | Customer cancel-own-draft button | `src/app/(storefront)/account/orders/[id]/cancel-draft-button.tsx` | |
| F-UI-023 | Customer "repeat last year's order" flow with review screen | `src/app/(storefront)/account/orders/[id]/repeat/page.tsx`, `src/components/ordering/repeat-review.tsx` | |
| F-UI-024 | Profile edit form | `src/app/(storefront)/account/profile/page.tsx`, `src/app/(storefront)/account/profile/profile-form.tsx` | |
| F-UI-025 | Saved addresses management page | `src/app/(storefront)/account/addresses/page.tsx` | |
| F-UI-026 | Past collections gallery page | `src/app/(storefront)/past-collections/page.tsx` | |
| F-UI-027 | Email unsubscribe page + form | `src/app/(storefront)/unsubscribe/page.tsx`, `src/app/(storefront)/unsubscribe/unsubscribe-form.tsx` | |
| F-UI-028 | First-run setup page | `src/app/(storefront)/setup/page.tsx` | |
| F-UI-029 | Test-mode banner on storefront | `src/components/storefront/test-mode-banner.tsx` | |
| F-UI-030 | Sign-in / sign-up pages (Clerk catch-all) | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | |

### Admin

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-UI-031 | Admin shell: collapsible permission-gated sidebar (Today/Dashboard pinned, 6 sections), mobile nav | `src/app/(admin)/admin/admin-shell.tsx`, `src/components/admin/admin-sidebar.tsx`, `src/components/admin/sidebar-config.ts`, `src/components/admin/mobile-nav.tsx` | Nav hints + permission/role/test-env gating |
| F-UI-032 | Admin dashboard (big-picture stats) | `src/app/(admin)/admin/page.tsx` | |
| F-UI-033 | "Today" prioritized work-queue console | `src/app/(admin)/admin/today/page.tsx` | Cards for pickups, labels, calls, batches, routes |
| F-UI-034 | Orders list with search bar | `src/app/(admin)/admin/orders/page.tsx`, `src/app/(admin)/admin/orders/orders-search-bar.tsx` | |
| F-UI-035 | Order detail with payment actions (record payment/refund) and shipment actions | `src/app/(admin)/admin/orders/[id]/page.tsx`, `src/app/(admin)/admin/orders/[id]/order-money-actions.tsx`, `src/app/(admin)/admin/orders/[id]/shipment-actions.tsx` | |
| F-UI-036 | Printable packing slip page | `src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx`, `src/components/admin/print-button.tsx` | |
| F-UI-037 | Admin repeat single order + bulk repeat form | `src/app/(admin)/admin/orders/[id]/repeat/page.tsx`, `src/app/(admin)/admin/orders/repeat-bulk/bulk-repeat-form.tsx` | |
| F-UI-038 | POS: staff order builder with customer search/walk-in bar and staff notes | `src/app/(admin)/admin/pos/pos-builder.tsx`, `src/app/(admin)/admin/pos/page.tsx` | Same shared builder shell, source "pos" |
| F-UI-039 | POS checkout screen | `src/app/(admin)/admin/pos/checkout/[orderId]/page.tsx` | Reuses CheckoutClient in pos mode |
| F-UI-040 | Follow-up calls list with filters | `src/app/(admin)/admin/follow-up/page.tsx`, `src/app/(admin)/admin/follow-up/follow-up-list.tsx`, `src/app/(admin)/admin/follow-up/follow-up-filters.tsx` | Unpaid-order call queue |
| F-UI-041 | Customers list with search + add-customer dialog | `src/app/(admin)/admin/customers/page.tsx`, `src/app/(admin)/admin/customers/customer-search.tsx`, `src/app/(admin)/admin/customers/add-customer-dialog.tsx` | |
| F-UI-042 | Customer detail (edit, history) | `src/app/(admin)/admin/customers/[id]/customer-detail-client.tsx` | |
| F-UI-043 | Email center tabs: campaigns, lists, subscribers, templates, triggered emails | `src/app/(admin)/admin/email/email-tabs.tsx`, `src/app/(admin)/admin/email/campaigns-tab.tsx`, `src/app/(admin)/admin/email/lists-tab.tsx`, `src/app/(admin)/admin/email/subscribers-tab.tsx`, `src/app/(admin)/admin/email/templates-tab.tsx`, `src/app/(admin)/admin/email/triggered-tab.tsx` | |
| F-UI-044 | Block-based campaign builder (new/edit) | `src/app/(admin)/admin/email/campaign-builder.tsx`, `src/app/(admin)/admin/email/campaign-blocks.ts`, `src/app/(admin)/admin/email/new/page.tsx`, `src/app/(admin)/admin/email/[id]/edit/page.tsx` | |
| F-UI-045 | Triggered-email template editor | `src/app/(admin)/admin/email/triggered/[key]/edit/page.tsx`, `src/app/(admin)/admin/email/email-editors.tsx` | |
| F-UI-046 | Subscriber controls (add/remove/list management) | `src/app/(admin)/admin/email/subscriber-controls.tsx`, `src/app/(admin)/admin/email/list-editors.tsx` | |
| F-UI-047 | Products list + actions, new/edit form with season select | `src/app/(admin)/admin/products/page.tsx`, `src/app/(admin)/admin/products/product-form.tsx`, `src/app/(admin)/admin/products/product-actions.tsx`, `src/app/(admin)/admin/products/season-select.tsx` | |
| F-UI-048 | Product detail with replacement-chain editor | `src/app/(admin)/admin/products/[id]/page.tsx`, `src/app/(admin)/admin/products/[id]/replacement-editor.tsx` | For repeat-order substitutions |
| F-UI-049 | Add-ons management page | `src/app/(admin)/admin/addons/page.tsx`, `src/app/(admin)/admin/addons/addon-actions.tsx` | Greeting cards, extra gifts, donations |
| F-UI-050 | Media library: upload/manage images, "needs photos" panel, media picker | `src/app/(admin)/admin/media/page.tsx`, `src/app/(admin)/admin/media/needs-photos-panel.tsx`, `src/components/admin/media-picker.tsx` | |
| F-UI-051 | Inventory & production: overview/production tabs, daily batch dialog, production history | `src/app/(admin)/admin/inventory/inventory-tabs.tsx`, `src/app/(admin)/admin/inventory/daily-batch-dialog.tsx`, `src/app/(admin)/admin/inventory/production-history.tsx` | |
| F-UI-052 | Fulfillment overview: pickup/delivery/shipment channel cards with status counts and actions | `src/app/(admin)/admin/fulfillment/page.tsx`, `src/app/(admin)/admin/fulfillment/channel-action-button.tsx` | |
| F-UI-053 | Route builder (map, group deliveries into driver routes) | `src/app/(admin)/admin/fulfillment/build-route/route-builder.tsx` | |
| F-UI-054 | Routes list + route detail with messenger reassign | `src/app/(admin)/admin/routes/page.tsx`, `src/app/(admin)/admin/routes/[id]/page.tsx`, `src/app/(admin)/admin/routes/[id]/reassign-button.tsx` | |
| F-UI-055 | Route print sheet + greeting-cards print page | `src/app/(admin)/admin/routes/[id]/print/page.tsx`, `src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx` | |
| F-UI-056 | Season reports page | `src/app/(admin)/admin/reports/page.tsx` | Year-over-year comparisons |
| F-UI-057 | CSV exports page | `src/app/(admin)/admin/export/page.tsx` | Deliveries, year-end, item sales, lapsed customers |
| F-UI-058 | Stripe reconciliation page with run button | `src/app/(admin)/admin/reconciliation/page.tsx`, `src/app/(admin)/admin/reconciliation/run-button.tsx` | |
| F-UI-059 | Settings hub with tabs: orders, shipping, email, developer | `src/app/(admin)/admin/settings/page.tsx`, `src/app/(admin)/admin/settings/orders-tab.tsx`, `src/app/(admin)/admin/settings/shipping-tab.tsx`, `src/app/(admin)/admin/settings/email-tab.tsx`, `src/app/(admin)/admin/settings/developer-tab.tsx` | |
| F-UI-060 | Settings cards: store status, delivery ZIPs, package types, pickup locations, shipping rates, shipping rules, follow-up settings | `src/app/(admin)/admin/settings/store-status-card.tsx`, `src/app/(admin)/admin/settings/delivery-zips-card.tsx`, `src/app/(admin)/admin/settings/package-types-card.tsx`, `src/app/(admin)/admin/settings/pickup-locations-card.tsx`, `src/app/(admin)/admin/settings/shipping-rates-card.tsx`, `src/app/(admin)/admin/settings/shipping-rules-card.tsx`, `src/app/(admin)/admin/settings/follow-up-settings.tsx` | |
| F-UI-061 | New-season wizard | `src/app/(admin)/admin/settings/new-season-wizard.tsx` | |
| F-UI-062 | Staff accounts: list, add-staff dialog, per-user permission overrides dialog | `src/app/(admin)/admin/users/users-client.tsx`, `src/app/(admin)/admin/users/add-staff-dialog.tsx`, `src/app/(admin)/admin/users/permission-overrides-dialog.tsx` | |
| F-UI-063 | Impersonation: pick-a-user page + persistent impersonation bar | `src/app/(admin)/admin/impersonate/page.tsx`, `src/app/(admin)/admin/impersonate/impersonate-button.tsx`, `src/components/admin/impersonation-bar.tsx` | Developer role only |
| F-UI-064 | Test-mode console: seed test season, reset DB, clear captured emails | `src/app/(admin)/admin/test-mode/page.tsx`, `src/app/(admin)/admin/test-mode/seed-buttons.tsx`, `src/app/(admin)/admin/test-mode/reset-button.tsx`, `src/app/(admin)/admin/test-mode/clear-emails-button.tsx` | Test env only (sidebar `testOnly`) |
| F-UI-065 | Audit/activity log table | `src/app/(admin)/admin/audit-log/page.tsx`, `src/app/(admin)/admin/audit-log/audit-table.tsx` | |
| F-UI-066 | In-app help center articles | `src/app/(admin)/admin/help/page.tsx`, `src/app/(admin)/admin/help/help-articles.ts`, `src/app/(admin)/admin/help/help-content.tsx` | |
| F-UI-067 | Guided admin tour (driver.js style) | `src/features/tours/admin-tour.tsx`, `src/features/tours/tours.ts`, `src/features/tours/run-driver.ts` | |
| F-UI-068 | CSV import dialog (shared admin) | `src/components/admin/csv-import-dialog.tsx` | |
| F-UI-069 | Shared admin list controls: search, pagination, page-size selector, remembered list URLs, sortable/responsive tables, status badges | `src/components/admin/list-search.tsx`, `src/components/admin/pagination.tsx`, `src/components/admin/page-size-selector.tsx`, `src/components/admin/remember-list-url.tsx`, `src/components/ui/sortable-table.tsx`, `src/components/ui/responsive-table.tsx`, `src/components/admin/status-badges.tsx` | |
| F-UI-070 | Env-switch link (prod/test) + visit-store link + alert banner + back link | `src/components/admin/env-switch-link.tsx`, `src/app/(admin)/admin/env-switch/route.ts`, `src/components/admin/visit-store-link.tsx`, `src/components/admin/alert-banner.tsx`, `src/components/admin/back-link.tsx` | |

### Messenger (driver)

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-UI-071 | Messenger home: assigned/in-progress routes with progress bars, finished-today section; managers see all | `src/app/(messenger)/messenger/page.tsx`, `src/app/(messenger)/messenger/layout.tsx` | |
| F-UI-072 | Route run screen: start route + per-stop deliver buttons | `src/app/(messenger)/messenger/routes/[id]/page.tsx`, `src/app/(messenger)/messenger/routes/[id]/start-route-button.tsx`, `src/app/(messenger)/messenger/routes/[id]/deliver-button.tsx` | |

### Design system / app-wide

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-UI-073 | shadcn-style UI kit (button, card, dialog, sheet, tabs, select, table, popover, dropdown, switch, checkbox, badge, avatar, input, textarea, label, separator) | `src/components/ui/button.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/tabs.tsx`, `components.json` | Full set under `src/components/ui/` |
| F-UI-074 | Custom UI primitives: confirm dialog, empty state, FAB, info hint tooltip, page header, pill input, price tag, smart select, callout | `src/components/ui/confirm-dialog.tsx`, `src/components/ui/empty-state.tsx`, `src/components/ui/fab.tsx`, `src/components/ui/info-hint.tsx`, `src/components/ui/page-header.tsx`, `src/components/ui/pill-input.tsx`, `src/components/ui/price-tag.tsx`, `src/components/ui/smart-select.tsx`, `src/components/ui/callout.tsx` | |
| F-UI-075 | Design tokens + global styles, brand constants | `src/styles/tokens.css`, `src/app/globals.css`, `src/lib/brand.ts` | Burgundy/gold brand theme |
| F-UI-076 | Global error page + root layout | `src/app/error.tsx`, `src/app/layout.tsx` | Error reports post to `src/app/api/client-error/route.ts` |
| F-UI-077 | Marketing imagery assets (hero, mission photos) | `public/images/hero.png`, `public/images/mission-shabbos-table.jpg`, `public/images/mission-volunteers.jpg` | |

## Blocked / notes

- None blocking. Source read fine after the corrected path.
- `src/components/forms/`, `src/components/feedback/`, `src/components/layout/` contain only `.gitkeep` — empty placeholders, no features.
- Permission gating, checkout math, emails, and integrations are behavior behind these screens — left to the data/security/integrations job slices.
