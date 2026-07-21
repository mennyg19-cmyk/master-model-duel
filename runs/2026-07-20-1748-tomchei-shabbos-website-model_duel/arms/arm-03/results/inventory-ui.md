# Codebase inventory — arm-03 (job: ui)

Focused slice: routes, layouts, navigation, forms, client-only state.

## Proof-of-read
- Rules files read: 5 (ponytail, clean-code, workflow, vocabulary, codegraph via arm `rules/` + AGENTS.md)
- Top-level dirs sampled: `src/app`, `src/components`, `src/features/order-builder`, `src/features/checkout`, `src/features/tours`, `src/middleware.ts`

## Features
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | Root app layout (fonts, Clerk, toaster, test banner) | `src/app/layout.tsx`, `src/components/storefront/test-mode-banner.tsx`, `src/app/globals.css` | Wraps all route groups; sets metadata + `data-test-env`. |
| F-002 | Global error UI | `src/app/error.tsx` | Client error boundary for the app tree. |
| F-003 | Clerk middleware (auth context for all pages) | `src/middleware.ts` | Does not protect routes by default; pages gate themselves. |
| F-004 | Storefront layout (header, footer, closed banner) | `src/app/(storefront)/layout.tsx` | Sticky header, 3-col footer, season-closed amber banner. |
| F-005 | Storefront desktop nav links | `src/app/(storefront)/layout.tsx` | Packages / Mission / How It Works + Sign In / Order Now CTAs. |
| F-006 | Storefront mobile sheet nav | `src/components/storefront/mobile-menu.tsx` | Hamburger + Sheet; router.push after close. |
| F-007 | Storefront signed-in user menu | `src/components/storefront/user-menu.tsx` | Clerk UserButton links: orders, addresses, admin (staff). |
| F-008 | Footer email subscribe form | `src/components/storefront/email-subscribe.tsx` | Client form → `/api/subscribe`; toast + done state. |
| F-009 | Marketing home page | `src/app/(storefront)/page.tsx`, `src/components/storefront/home-impact-bar.tsx` | Hero, impact bar, how-it-works, packages, mission, CTAs. |
| F-010 | Packages catalog page | `src/app/(storefront)/packages/page.tsx`, `src/app/(storefront)/packages/packages-grid.tsx`, `src/app/(storefront)/packages/loading.tsx` | Season products grid + loading UI. |
| F-011 | Package detail page | `src/app/(storefront)/packages/[id]/page.tsx` | Single-package storefront route. |
| F-012 | Product quick view (storefront) | `src/components/storefront/product-quick-view.tsx` | Client overlay for package peek. |
| F-013 | Order builder route (storefront) | `src/app/(storefront)/order/page.tsx`, `src/app/(storefront)/order/order-builder.tsx` | Loads catalog and mounts builder shell. |
| F-014 | Order builder shell UI | `src/features/order-builder/components/OrderBuilderShell.tsx`, `ProductPanel.tsx`, `ProductCard.tsx`, `OrderSidebar.tsx`, `MobileCartFab.tsx` | Product panel + sidebar + mobile cart FAB. |
| F-015 | Order draft client state (useReducer context) | `src/features/order-builder/orderDraftContext.tsx`, `orderDraftReducer.ts`, `types.ts` | Single client owner for draft lines/groups/book. |
| F-016 | Guest draft resume via localStorage | `src/features/order-builder/components/AutoSave.tsx`, `ClearGuestDraftOnSuccess.tsx` | Debounced save; `tomchei:{web\|pos}-draft` keys. |
| F-017 | Recipient / address dialogs in builder | `src/features/order-builder/components/AddRecipientDialog.tsx`, `EditSavedAddressDialog.tsx`, `RecipientAssignDialog.tsx`, `src/components/ordering/address-fields.tsx`, `address-autocomplete.tsx` | Shared address form + Mapbox autocomplete. |
| F-018 | Checkout page + shared checkout form | `src/app/(storefront)/checkout/page.tsx`, `src/features/checkout/components/CheckoutClient.tsx` | Client payment/shipping UI (web + POS modes). |
| F-019 | Checkout success page | `src/app/(storefront)/checkout/success/page.tsx` | Confirmation + place-another / home CTAs. |
| F-020 | Past collections archive page | `src/app/(storefront)/past-collections/page.tsx` | Prior seasons’ packages. |
| F-021 | Unsubscribe preferences form | `src/app/(storefront)/unsubscribe/page.tsx`, `unsubscribe-form.tsx` | HMAC-gated preference options. |
| F-022 | First-developer setup page | `src/app/(storefront)/setup/page.tsx` | Bootstrap UI when no StaffUser rows exist. |
| F-023 | Account layout + side/pill nav | `src/app/(storefront)/account/layout.tsx` | Auth gate; My Orders / Addresses / Profile (+ Admin). |
| F-024 | Account index redirect | `src/app/(storefront)/account/page.tsx` | Redirects to `/account/orders`. |
| F-025 | Account orders list + detail + cancel draft | `src/app/(storefront)/account/orders/page.tsx`, `orders/[id]/page.tsx`, `cancel-draft-button.tsx` | History cards + draft cancel control. |
| F-026 | Account repeat-order review UI | `src/app/(storefront)/account/orders/[id]/repeat/page.tsx`, `src/components/ordering/repeat-review.tsx` | Customer-facing repeat flow UI. |
| F-027 | Saved addresses page | `src/app/(storefront)/account/addresses/page.tsx` | Address cards with edit/delete affordances. |
| F-028 | Profile edit form | `src/app/(storefront)/account/profile/page.tsx`, `profile-form.tsx` | Name/phone/email with dirty-state save. |
| F-029 | Sign-in route (Clerk) | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` | Hosted Clerk SignIn. |
| F-030 | Sign-up route (Clerk) | `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Hosted Clerk SignUp. |
| F-031 | Admin layout (staff gate + pending confirmation) | `src/app/(admin)/admin/layout.tsx` | Redirects non-staff; pending-confirmation screen. |
| F-032 | Admin shell (sidebar / mobile / header chrome) | `src/app/(admin)/admin/admin-shell.tsx`, `src/components/admin/admin-sidebar.tsx`, `mobile-nav.tsx`, `impersonation-bar.tsx`, `env-switch-link.tsx`, `visit-store-link.tsx` | Desktop sticky sidebar + mobile sheet + header tools. |
| F-033 | Admin sidebar nav config (permission-gated) | `src/components/admin/sidebar-config.ts` | Today/Dashboard + Sales/Products/Fulfillment/Reports/Settings/Developer sections. |
| F-034 | Admin guided tour controls | `src/features/tours/admin-tour.tsx` | TourButton + `?tour=` auto-start (test env). |
| F-035 | Admin dashboard home | `src/app/(admin)/admin/page.tsx` | `/admin` landing. |
| F-036 | Admin Today page | `src/app/(admin)/admin/today/page.tsx` | Attention queue surface. |
| F-037 | Admin orders list + search/filters | `src/app/(admin)/admin/orders/page.tsx`, `orders-search-bar.tsx`, `src/components/admin/list-search.tsx`, `page-size-selector.tsx`, `pagination.tsx` | Searchable/paginated orders UI. |
| F-038 | Admin list URL memory (sessionStorage) | `src/components/admin/remember-list-url.tsx`, `back-link.tsx` | Preserves filtered list URL for back navigation. |
| F-039 | Admin order detail + money/shipment actions | `src/app/(admin)/admin/orders/[id]/page.tsx`, `order-money-actions.tsx`, `shipment-actions.tsx` | Per-order staff actions UI. |
| F-040 | Packing slip print route | `src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx`, `src/components/admin/print-button.tsx` | Printable slip + print control. |
| F-041 | Admin single-order repeat + bulk repeat form | `src/app/(admin)/admin/orders/[id]/repeat/page.tsx`, `orders/repeat-bulk/page.tsx`, `bulk-repeat-form.tsx` | Repeat flows including bulk form. |
| F-042 | POS order builder + POS checkout | `src/app/(admin)/admin/pos/page.tsx`, `pos-builder.tsx`, `pos/checkout/[orderId]/page.tsx` | Counter builder reuses draft context; checkout via CheckoutClient. |
| F-043 | Customers list + add dialog + detail client | `src/app/(admin)/admin/customers/page.tsx`, `add-customer-dialog.tsx`, `customer-search.tsx`, `customers/[id]/page.tsx`, `customer-detail-client.tsx` | Searchable list + detail client UI. |
| F-044 | Follow-up calls UI | `src/app/(admin)/admin/follow-up/page.tsx`, `follow-up-filters.tsx`, `follow-up-list.tsx` | Filterable follow-up cards. |
| F-045 | Email hub tabs + builders/editors | `src/app/(admin)/admin/email/page.tsx`, `email-tabs.tsx`, `campaigns-tab.tsx`, `campaign-builder.tsx`, `email-editors.tsx`, `lists-tab.tsx`, `list-editors.tsx`, `subscribers-tab.tsx`, `subscriber-controls.tsx`, `templates-tab.tsx`, `triggered-tab.tsx`, `email/new/page.tsx`, `email/[id]/edit/page.tsx`, `email/triggered/[key]/edit/page.tsx` | Multi-tab email management + WYSIWYG campaign routes. |
| F-046 | Products list/new/edit + product form | `src/app/(admin)/admin/products/page.tsx`, `products/new/page.tsx`, `products/[id]/page.tsx`, `products/[id]/edit/page.tsx`, `product-form.tsx`, `product-actions.tsx`, `season-select.tsx`, `replacement-editor.tsx` | Full product CRUD form surface. |
| F-047 | Add-ons admin UI | `src/app/(admin)/admin/addons/page.tsx`, `addon-actions.tsx` | List + CRUD dialog actions. |
| F-048 | Media library UI | `src/app/(admin)/admin/media/page.tsx`, `media-actions.tsx`, `needs-photos-panel.tsx`, `src/components/admin/media-picker.tsx` | Grid + upload/assign picker. |
| F-049 | Inventory & production tabs/dialogs | `src/app/(admin)/admin/inventory/page.tsx`, `inventory-tabs.tsx`, `inventory-controls.tsx`, `daily-batch-dialog.tsx`, `production-history.tsx` | URL-driven tabs + batch entry dialog. |
| F-050 | Fulfillment overview + channel actions | `src/app/(admin)/admin/fulfillment/page.tsx`, `channel-action-button.tsx` | Packing/labels overview UI. |
| F-051 | Build-route map UI | `src/app/(admin)/admin/fulfillment/build-route/page.tsx`, `route-builder.tsx` | Client route builder. |
| F-052 | Active routes list + detail/print/greeting cards | `src/app/(admin)/admin/routes/page.tsx`, `routes/[id]/page.tsx`, `routes/[id]/print/page.tsx`, `routes/[id]/greeting-cards/page.tsx`, `reassign-button.tsx` | Route management surfaces. |
| F-053 | Reports page | `src/app/(admin)/admin/reports/page.tsx` | Season comparison reports UI. |
| F-054 | CSV export page | `src/app/(admin)/admin/export/page.tsx` | Download controls for deliveries/accounting/reports. |
| F-055 | Payment reconciliation UI | `src/app/(admin)/admin/reconciliation/page.tsx`, `run-button.tsx` | Run-reconcile client control. |
| F-056 | Settings tabs (orders/shipping/email/developer) | `src/app/(admin)/admin/settings/page.tsx`, `orders-tab.tsx`, `shipping-tab.tsx`, `email-tab.tsx`, `developer-tab.tsx`, `store-status-card.tsx`, `delivery-zips-card.tsx`, `package-types-card.tsx`, `pickup-locations-card.tsx`, `shipping-rates-card.tsx`, `shipping-rules-card.tsx`, `follow-up-settings.tsx`, `new-season-wizard.tsx` | Tabbed settings forms/cards + season wizard. |
| F-057 | Staff users management UI | `src/app/(admin)/admin/users/page.tsx`, `users-client.tsx`, `add-staff-dialog.tsx`, `permission-overrides-dialog.tsx` | Pending/confirmed tables + dialogs. |
| F-058 | Impersonate page | `src/app/(admin)/admin/impersonate/page.tsx`, `impersonate-button.tsx` | Developer impersonation UI. |
| F-059 | Test-mode controls | `src/app/(admin)/admin/test-mode/page.tsx`, `seed-buttons.tsx`, `reset-button.tsx`, `clear-emails-button.tsx` | Sandbox seed/reset/email controls. |
| F-060 | Audit log table | `src/app/(admin)/admin/audit-log/page.tsx`, `audit-table.tsx` | Activity log client table. |
| F-061 | Admin help center | `src/app/(admin)/admin/help/page.tsx`, `help-content.tsx` | Searchable help articles UI. |
| F-062 | CSV import dialog (admin shared) | `src/components/admin/csv-import-dialog.tsx` | Shared client import dialog. |
| F-063 | Messenger layout (phone-first shell) | `src/app/(messenger)/messenger/layout.tsx` | Logo header + UserButton; role-gated. |
| F-064 | Messenger home + route detail actions | `src/app/(messenger)/messenger/page.tsx`, `routes/[id]/page.tsx`, `start-route-button.tsx`, `deliver-button.tsx` | Assigned routes + start/deliver controls. |
| F-065 | Shared UI kit primitives (forms/nav chrome) | `src/components/ui/` (`button.tsx`, `input.tsx`, `dialog.tsx`, `sheet.tsx`, `tabs.tsx`, `select.tsx`, `checkbox.tsx`, `switch.tsx`, `sortable-table.tsx`, …) | Design-system building blocks used by layouts/forms. |
