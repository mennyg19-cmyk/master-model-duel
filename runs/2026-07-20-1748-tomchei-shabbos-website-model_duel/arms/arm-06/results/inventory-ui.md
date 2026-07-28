# Codebase inventory — arm-06 (ui)

Job slice: **ui** — routes, layouts, navigation, forms, client-only state.
Source root (read-only): `.scratch/sources/tomche-shabbos-website`. Evidence paths below are relative to that root.

## Proof-of-read

- Rules files read: 6 (`arms/arm-06/AGENTS.md` + 5 `.cursor/rules/*.mdc`: workflow, ponytail, codegraph, clean-code, vocabulary)
- Spawn prompt read: `arms/arm-06/.scratch/spawn-contestant-20260728-115320.md`
- Top-level dirs sampled: `src/app` (all 4 route groups + api), `src/components` (admin, feedback, forms, layout, ordering, storefront, ui), `src/features` (tours, order-builder, checkout, storefront), `src/config`, `src/middleware.ts`, `package.json`
- Method: full route map from every `page/layout/loading/error` file under `src/app`; header-summary extraction across all page/client components; full reads of root/storefront/admin/messenger/account layouts, admin shell + sidebar config, order-draft context, checkout client, mobile menus. Codegraph unavailable (source has no `.codegraph/` index and is read-only, so no `codegraph init`) — Read/grep fallback per `codegraph.mdc`.
- Stack observed: Next.js 16 App Router + React 19, Clerk auth, shadcn-style kit on Base UI + Tailwind 4, driver.js tours, Mapbox (map + address autocomplete), sonner toasts. No external state library.

## Features

### A. Route structure & layouts

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | Root layout (fonts, ClerkProvider, sonner Toaster, test-env body flag) | src/app/layout.tsx | Wraps all routes; Inter/Playfair/Geist Mono font variables |
| F-002 | Global error boundary with "Try Again"/"Go Home" + client-error reporting | src/app/error.tsx | Posts to /api/client-error |
| F-003 | Clerk middleware on all routes | src/middleware.ts | Auth context only; pages guard themselves |
| F-004 | Storefront shell: sticky glass header, desktop nav, footer with subscribe form | src/app/(storefront)/layout.tsx | Store-closed amber banner; auto-creates Customer on load; force-dynamic |
| F-005 | Account sub-layout: auth gate + side nav (desktop) / scroll pills (mobile) | src/app/(storefront)/account/layout.tsx | Staff get "Admin Portal" nav item |
| F-006 | Admin layout: staff-role gate, pending-confirmation screen, session audit log | src/app/(admin)/admin/layout.tsx | Redirects messengers to /messenger, non-staff to / |
| F-007 | AdminShell client chrome: sticky sidebar, mobile sheet nav, header actions | src/app/(admin)/admin/admin-shell.tsx | Impersonation bar slot; tour/help links test-env only |
| F-008 | Messenger layout: phone-first minimal shell, driver-permission gate | src/app/(messenger)/messenger/layout.tsx | `routes.viewOwn` gate (messenger, manager+, canDrive) |

### B. Storefront routes (public / customer)

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-009 | Home marketing page: hero, count-up impact bar, how-it-works, package grid, mission rows, testimonials, final CTA | src/app/(storefront)/page.tsx | CTAs switch text when ordering closed; cards deep-link into builder |
| F-010 | Animated stats strip (IntersectionObserver count-up) | src/components/storefront/home-impact-bar.tsx | Client-only animation on scroll into view |
| F-011 | Package catalog page `/packages` with loading skeleton | src/app/(storefront)/packages/page.tsx, src/app/(storefront)/packages/loading.tsx | Server query, sold-out detection |
| F-012 | PackagesGrid client: category filter pills (aria-pressed), price sort, quick-view modal | src/app/(storefront)/packages/packages-grid.tsx | Keyboard-accessible cards |
| F-013 | Package detail page `/packages/[id]` | src/app/(storefront)/packages/[id]/page.tsx | Option badges w/ price adjustments; CTA deep-link to builder |
| F-014 | Past collections archive `/past-collections` | src/app/(storefront)/past-collections/page.tsx | Read-only year-by-year gallery; dedupes repeat items |
| F-015 | Order builder page `/order` (draft resume via ?draft= or latest web draft; ?product= preselect; closed-store gate) | src/app/(storefront)/order/page.tsx, src/app/(storefront)/order/order-builder.tsx | Wraps shared builder in OrderProvider source="web" |
| F-016 | Checkout page `/checkout` (order open + draft + ownership/guest-token gates) | src/app/(storefront)/checkout/page.tsx | Cash/check only when store enables them |
| F-017 | Shared checkout client: per-recipient shipping quotes, payment method picker (card/check/cash), price-change ack, guest email | src/features/checkout/components/CheckoutClient.tsx | mode web|pos; Stripe for card, /api/checkout/offline for the rest |
| F-018 | Checkout success page | src/app/(storefront)/checkout/success/page.tsx | No raw CUIDs in user text |
| F-019 | Unsubscribe page + form (HMAC-token verified, 3 preference options) | src/app/(storefront)/unsubscribe/page.tsx, src/app/(storefront)/unsubscribe/unsubscribe-form.tsx | Forged links rejected with error state |
| F-020 | First-run developer setup page `/setup` | src/app/(storefront)/setup/page.tsx | Only accessible when zero StaffUser rows |
| F-021 | Footer email subscribe form with toast states | src/components/storefront/email-subscribe.tsx | Success/already-subscribed/resubscribed feedback |
| F-022 | Account index redirect to /account/orders | src/app/(storefront)/account/page.tsx | No standalone overview |
| F-023 | My Orders list: status badges, draft "Continue Order" dashed cards | src/app/(storefront)/account/orders/page.tsx | |
| F-024 | Customer order detail (ownership-enforced) + cancel-draft button | src/app/(storefront)/account/orders/[id]/page.tsx, src/app/(storefront)/account/orders/[id]/cancel-draft-button.tsx | Edit/Checkout actions for drafts |
| F-025 | Customer repeat-order flow (substitution preview → review → new draft) | src/app/(storefront)/account/orders/[id]/repeat/page.tsx, src/components/ordering/repeat-review.tsx | Review screen shared with admin repeats |
| F-026 | Saved addresses page (cards, edit/delete, add dialog slot) | src/app/(storefront)/account/addresses/page.tsx | |
| F-027 | Profile edit form with change detection (Save only when dirty) | src/app/(storefront)/account/profile/page.tsx, src/app/(storefront)/account/profile/profile-form.tsx | name/phone/email via server action |

### C. Auth routes

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-028 | Clerk hosted sign-in `/sign-in/[[...sign-in]]` | src/app/(auth)/sign-in/[[...sign-in]]/page.tsx | Catch-all Clerk routing |
| F-029 | Clerk hosted sign-up `/sign-up/[[...sign-up]]` | src/app/(auth)/sign-up/[[...sign-up]]/page.tsx | |

### D. Admin routes (staff)

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-030 | Dashboard: stat cards, permission-gated action tiles, recent orders | src/app/(admin)/admin/page.tsx | InfoHint explanations on cards |
| F-031 | Today work queue (8 permission-gated work cards) | src/app/(admin)/admin/today/page.tsx | Confirm orders, pickups, labels, dispatch, routes, production, follow-ups, alerts |
| F-032 | Orders list: search, filter presets, status/payment dropdowns, pagination, CSV button | src/app/(admin)/admin/orders/page.tsx, src/app/(admin)/admin/orders/orders-search-bar.tsx | URL-param driven |
| F-033 | Admin order detail: fulfillment groups, totals, payment summary, staff notes | src/app/(admin)/admin/orders/[id]/page.tsx | |
| F-034 | Staff money dialogs: record payment, refund, cancel | src/app/(admin)/admin/orders/[id]/order-money-actions.tsx | Dollar inputs → cents; Result toasts |
| F-035 | Packing slip print view | src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx | Per-recipient sections; print-hides button |
| F-036 | Admin single-order repeat | src/app/(admin)/admin/orders/[id]/repeat/page.tsx | Lands staffer in POS builder |
| F-037 | Bulk repeat (multi-past-orders → one consolidated draft) | src/app/(admin)/admin/orders/repeat-bulk/page.tsx, src/app/(admin)/admin/orders/repeat-bulk/bulk-repeat-form.tsx | ?customer= scoped; merges repeat recipients |
| F-038 | POS order builder (shared builder + customer bar, walk-in, staff notes, draft badge) | src/app/(admin)/admin/pos/page.tsx, src/app/(admin)/admin/pos/pos-builder.tsx | ?draftId= resume; on-demand customer search |
| F-039 | POS checkout (shared CheckoutClient in pos mode) | src/app/(admin)/admin/pos/checkout/[orderId]/page.tsx | Cash/check always on for staff |
| F-040 | Customers list: debounced search, pagination, add-customer dialog, CSV import | src/app/(admin)/admin/customers/page.tsx, src/app/(admin)/admin/customers/customer-search.tsx, src/app/(admin)/admin/customers/add-customer-dialog.tsx | |
| F-041 | Customer detail: editable contact, order history, address book, merge-duplicates dialog | src/app/(admin)/admin/customers/[id]/page.tsx, src/app/(admin)/admin/customers/[id]/customer-detail-client.tsx | |
| F-042 | Follow-up calls page: unpaid/pickup/lapsed tab pills, snoozed toggle, expandable cards | src/app/(admin)/admin/follow-up/page.tsx, src/app/(admin)/admin/follow-up/follow-up-filters.tsx, src/app/(admin)/admin/follow-up/follow-up-list.tsx | URL-synced filters |
| F-043 | Email hub with 5 URL-synced tabs (Campaigns, Subscribers, Lists, Templates, Triggered) | src/app/(admin)/admin/email/page.tsx, src/app/(admin)/admin/email/email-tabs.tsx | ?tab= survives refresh |
| F-044 | Campaign cards with send/duplicate/delete confirms | src/app/(admin)/admin/email/campaigns-tab.tsx, src/app/(admin)/admin/email/campaign-actions.tsx | Send reports recipient count |
| F-045 | WYSIWYG block email builder (new + edit, campaign + triggered modes) | src/app/(admin)/admin/email/new/page.tsx, src/app/(admin)/admin/email/[id]/edit/page.tsx, src/app/(admin)/admin/email/campaign-builder.tsx, src/app/(admin)/admin/email/campaign-blocks.ts | Live HTML preview; merge-variable insertion bar |
| F-046 | Triggered (transactional) email override editor | src/app/(admin)/admin/email/triggered/[key]/edit/page.tsx, src/app/(admin)/admin/email/triggered-tab.tsx | Reset-to-default option |
| F-047 | Subscriber controls: add, remove, CSV import | src/app/(admin)/admin/email/subscriber-controls.tsx, src/app/(admin)/admin/email/subscribers-tab.tsx | |
| F-048 | Mailing-list editors + member picker dialog | src/app/(admin)/admin/email/list-editors.tsx, src/app/(admin)/admin/email/lists-tab.tsx | Delete keeps subscribers |
| F-049 | Email branding template editor with server-rendered live preview | src/app/(admin)/admin/email/email-editors.tsx, src/app/(admin)/admin/email/templates-tab.tsx | Set-default/delete actions |
| F-050 | Products list: season dropdown, search, sold/revenue columns, past-season read-only banner | src/app/(admin)/admin/products/page.tsx, src/app/(admin)/admin/products/season-select.tsx, src/app/(admin)/admin/products/product-actions.tsx | ?season= URL param |
| F-051 | Product create/edit form (options editor, add-on attach, image pick, inventory goal, replacement link) | src/app/(admin)/admin/products/new/page.tsx, src/app/(admin)/admin/products/[id]/edit/page.tsx, src/app/(admin)/admin/products/product-form.tsx | Past seasons redirect to read-only detail |
| F-052 | Product detail + "replaced by" chain editor (auto-save) | src/app/(admin)/admin/products/[id]/page.tsx, src/app/(admin)/admin/products/[id]/replacement-editor.tsx | Chain editable even on read-only past products |
| F-053 | Add-ons management (CRUD dialog + CSV import) | src/app/(admin)/admin/addons/page.tsx, src/app/(admin)/admin/addons/addon-actions.tsx | Restriction mode, kitchen flag |
| F-054 | Media library: grid, upload w/ progress, delete confirm, usage counts | src/app/(admin)/admin/media/page.tsx, src/app/(admin)/admin/media/media-actions.tsx | |
| F-055 | "Needs photos" panel + image-assign picker | src/app/(admin)/admin/media/needs-photos-panel.tsx | CSV-bulk workflow support |
| F-056 | Inventory & production page: Overview/Production URL tabs, summary cards, damage/goal dialogs | src/app/(admin)/admin/inventory/page.tsx, src/app/(admin)/admin/inventory/inventory-tabs.tsx, src/app/(admin)/admin/inventory/overview-tab.tsx, src/app/(admin)/admin/inventory/inventory-controls.tsx | Production tab manager+ only |
| F-057 | Daily batch / receive stock dialog + production history rail with undo | src/app/(admin)/admin/inventory/daily-batch-dialog.tsx, src/app/(admin)/admin/inventory/production-tab.tsx, src/app/(admin)/admin/inventory/production-history.tsx | Deficit-sorted rows; undo confirms |
| F-058 | Fulfillment overview: 3 channel cards (pickup/delivery/shipment) + bulk-advance button | src/app/(admin)/admin/fulfillment/page.tsx, src/app/(admin)/admin/fulfillment/channel-action-button.tsx | |
| F-059 | Interactive route builder: ZIP filter, checklist + Mapbox pin picking, ordering, messenger assign | src/app/(admin)/admin/fulfillment/build-route/page.tsx, src/app/(admin)/admin/fulfillment/build-route/route-builder.tsx | Works as plain checklist without Mapbox token |
| F-060 | Routes list (active/finished sections) | src/app/(admin)/admin/routes/page.tsx | |
| F-061 | Route detail: ordered stops, messenger reassign dialog, Google Maps directions link | src/app/(admin)/admin/routes/[id]/page.tsx, src/app/(admin)/admin/routes/[id]/reassign-button.tsx | |
| F-062 | Printable route delivery sheet | src/app/(admin)/admin/routes/[id]/print/page.tsx | Sign-off boxes |
| F-063 | Printable greeting cards for a route | src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx | Only lines with greetings |
| F-064 | Season reports: year-vs-average cards, year table, item movers drill (?drill=) | src/app/(admin)/admin/reports/page.tsx | Replacement-chain item matching |
| F-065 | CSV export hub + export history table | src/app/(admin)/admin/export/page.tsx | 5 export types |
| F-066 | Stripe reconciliation page + "Run now" | src/app/(admin)/admin/reconciliation/page.tsx, src/app/(admin)/admin/reconciliation/run-button.tsx | Report-only, never changes money |
| F-067 | Settings hub: Orders/Shipping/Email/Developer tabs | src/app/(admin)/admin/settings/page.tsx, src/app/(admin)/admin/settings/orders-tab.tsx, src/app/(admin)/admin/settings/shipping-tab.tsx | Developer tab role-gated |
| F-068 | Store open/closed switch + closed-message editor | src/app/(admin)/admin/settings/store-status-card.tsx | Toggle flips back on save failure |
| F-069 | Shipping settings forms: flat rates, conditional rules (optimistic reorder), delivery ZIP pill input, package types, pickup locations | src/app/(admin)/admin/settings/shipping-rates-card.tsx, src/app/(admin)/admin/settings/shipping-rules-card.tsx, src/app/(admin)/admin/settings/delivery-zips-card.tsx, src/app/(admin)/admin/settings/package-types-card.tsx, src/app/(admin)/admin/settings/pickup-locations-card.tsx | First-match-wins rules; in-dialog errors |
| F-070 | Follow-up policy forms (unpaid auto-cancel/reminders; pickup expiry) | src/app/(admin)/admin/settings/follow-up-settings.tsx | |
| F-071 | Email settings tab (from address, Resend status, test send) | src/app/(admin)/admin/settings/email-tab.tsx | |
| F-072 | Developer settings tab (env var statuses, Shippo config, import/archive/reset tools) | src/app/(admin)/admin/settings/developer-tab.tsx | |
| F-073 | New Season wizard placeholder dialog | src/app/(admin)/admin/settings/new-season-wizard.tsx | Coming-soon shell (5-step plan noted) |
| F-074 | Staff users page: pending-confirm table, active table, action menus | src/app/(admin)/admin/users/page.tsx, src/app/(admin)/admin/users/users-client.tsx | |
| F-075 | Multi-step Add Staff dialog (email check → details) | src/app/(admin)/admin/users/add-staff-dialog.tsx | |
| F-076 | Per-user permission overrides dialog (inherit/grant/deny tri-state) | src/app/(admin)/admin/users/permission-overrides-dialog.tsx | |
| F-077 | Impersonation picker page + "View as" button | src/app/(admin)/admin/impersonate/page.tsx, src/app/(admin)/admin/impersonate/impersonate-button.tsx | Developer-only |
| F-078 | Audit log: sortable/filterable table + JSON detail dialog | src/app/(admin)/admin/audit-log/page.tsx, src/app/(admin)/admin/audit-log/audit-table.tsx | Last 200 rows |
| F-079 | Test-mode page: captured emails w/ preview, seed/wipe/reset/clear buttons | src/app/(admin)/admin/test-mode/page.tsx, src/app/(admin)/admin/test-mode/seed-buttons.tsx, src/app/(admin)/admin/test-mode/reset-button.tsx, src/app/(admin)/admin/test-mode/clear-emails-button.tsx | Test env only; RESET requires typing "RESET" |
| F-080 | Help center: searchable, category-filtered article browser with tour links | src/app/(admin)/admin/help/page.tsx, src/app/(admin)/admin/help/help-content.tsx | Test env only entry points |
| F-081 | Env-switch route (sets envOverride cookie, redirects) | src/app/(admin)/admin/env-switch/route.ts | Live↔Test sister deployments |

### E. Messenger routes (drivers)

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-082 | Messenger home: assigned/in-progress routes with progress bars, finished-today section | src/app/(messenger)/messenger/page.tsx | Managers see all routes |
| F-083 | Route detail: ordered stop cards, tap-to-call/map, office notes, Start Route + Mark Delivered buttons | src/app/(messenger)/messenger/routes/[id]/page.tsx, src/app/(messenger)/messenger/routes/[id]/start-route-button.tsx, src/app/(messenger)/messenger/routes/[id]/deliver-button.tsx | Own routes only unless manager |

### F. Navigation components & patterns

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-084 | Permission-aware admin sidebar config: 5 collapsible sections + pinned Today/Dashboard, hint tooltips | src/components/admin/sidebar-config.ts, src/components/admin/admin-sidebar.tsx | Auto-opens active section; hides gated items; developer section role-locked |
| F-085 | Admin mobile nav (hamburger → Sheet with same sidebar) | src/components/admin/mobile-nav.tsx | |
| F-086 | Storefront mobile menu (right Sheet; router.push navigation workaround) | src/components/storefront/mobile-menu.tsx | Staff get Admin Portal link |
| F-087 | Storefront user menu: Clerk UserButton + custom links | src/components/storefront/user-menu.tsx | My Orders, Saved Addresses, Admin Portal (staff) |
| F-088 | Impersonation amber bar with stop button | src/components/admin/impersonation-bar.tsx | Rendered by AdminShell when active |
| F-089 | Env-switch + visit-store header links | src/components/admin/env-switch-link.tsx, src/components/admin/visit-store-link.tsx | Env link needs NEXT_PUBLIC_SISTER_URL |
| F-090 | Test-mode banner (fixed top, impossible to miss) | src/components/storefront/test-mode-banner.tsx | Null in prod |
| F-091 | BackLink: history-first back navigation with href fallback | src/components/admin/back-link.tsx | Matches clean-code back-nav rule |
| F-092 | Consistent status badge system (order/payment/catalog/route) | src/components/admin/status-badges.tsx | One color source app-wide |
| F-093 | Alert banner strip (warning/info variants) | src/components/admin/alert-banner.tsx | |

### G. Forms & input patterns

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-094 | RecipientAssignDialog: option/qty/greeting/add-ons + 7 ship-to modes | src/features/order-builder/components/RecipientAssignDialog.tsx | Most complex control in builder; donation stripped-down mode |
| F-095 | AddRecipientDialog (saved address tab or new address tab → recipient book) | src/features/order-builder/components/AddRecipientDialog.tsx | |
| F-096 | EditSavedAddressDialog (syncs draft groups pointing at the address) | src/features/order-builder/components/EditSavedAddressDialog.tsx | |
| F-097 | Shared address form (AddressFields) + Mapbox ARIA combobox autocomplete with manual fallback | src/components/ordering/address-fields.tsx, src/components/ordering/address-autocomplete.tsx | One address form everywhere; US only |
| F-098 | Reusable CSV import dialog (parse → batched import → results) | src/components/admin/csv-import-dialog.tsx | Used by customers, add-ons, subscribers |
| F-099 | MediaPicker (library grid + on-the-spot upload) for admin forms | src/components/admin/media-picker.tsx | |
| F-100 | PillInput tag entry (ZIP lists etc.) | src/components/ui/pill-input.tsx | Enter/comma commits |
| F-101 | Shared UI kit (button, card, dialog, sheet, select, smart-select, tabs w/ URL sync, table, sortable-table hook, responsive table, popover, switch, badge, callout, empty-state, confirm-dialog, info-hint, price-tag, fab, page-header…) | src/components/ui/*.tsx, components.json | shadcn-style on Base UI primitives; no product code |
| F-102 | Server-driven pagination + page-size selector (URL params) | src/components/admin/pagination.tsx, src/components/admin/page-size-selector.tsx | |

### H. Client-only state

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-103 | Order draft store: single React context + useReducer (OrderProvider/useOrderDraft) shared by web + POS | src/features/order-builder/orderDraftContext.tsx, src/features/order-builder/orderDraftReducer.ts, src/features/order-builder/orderDraftSelectors.ts | Only reducer in app per README convention; typed action helpers |
| F-104 | AutoSave: debounced background draft save + guest resume pointer in localStorage | src/features/order-builder/components/AutoSave.tsx | Renders nothing |
| F-105 | ClearGuestDraftOnSuccess (wipes guest resume pointer after payment) | src/features/order-builder/components/ClearGuestDraftOnSuccess.tsx | |
| F-106 | URL-as-state pattern for lists/filters: debounced ?q=, ?season=, ?tab=, ?drill=, filter presets | src/components/admin/list-search.tsx, src/app/(admin)/admin/orders/orders-search-bar.tsx, src/app/(admin)/admin/products/season-select.tsx, src/components/ui/tabs.tsx | Server re-queries on param change |
| F-107 | RememberListUrl: sessionStorage list-URL memory so detail pages link back with filters | src/components/admin/remember-list-url.tsx | |
| F-108 | Guided tours: driver.js lazy-loaded, ?tour=site|page auto-start, per-page tour resolution | src/features/tours/admin-tour.tsx, src/features/tours/tours.ts, src/features/tours/run-driver.ts | Test env only |
| F-109 | Client table sort/filter hook + sortable headers | src/components/ui/sortable-table.tsx | |
| F-110 | Order builder shell dialog state + mobile cart FAB/bottom-sheet | src/features/order-builder/components/OrderBuilderShell.tsx, src/features/order-builder/components/MobileCartFab.tsx | ?product= deep link opens assign dialog on first render |
| F-111 | OrderSidebar cart: drag-to-assign, inline assign menu, bulk-assign, unassigned section | src/features/order-builder/components/OrderSidebar.tsx | Review & Pay blocked until all non-donation lines assigned |
| F-112 | Product panel search + category pills + donations strip | src/features/order-builder/components/ProductPanel.tsx, src/features/order-builder/components/ProductCard.tsx, src/features/order-builder/components/ProductQuickView.tsx | Stock badges (out/low/available) |

## Blocked / partial areas

- None blocking. `src/components/forms/` and `src/components/layout/` contain only `.gitkeep` (forms live beside their pages/features instead).
- `src/components/feedback/` not separately inventoried — no files surfaced in route/component scans beyond the toast setup in F-001.
- API routes (`src/app/api/**`) and server logic (shipping/pricing/permissions) are outside the ui slice — left for the merge union.
