# UI inventory — arm-01

## Proof-of-read
- Model: `gpt-5.6-sol-medium`
- Rules files read: 22 (`.cursor/rules/*.mdc`) plus `AGENTS.md` and `README.md`.
- Top-level areas sampled: `src/app/(storefront)`, `src/app/(admin)`, `src/app/(messenger)`, `src/components`, `src/features`.
- Structural-index note: `codegraph status` reported “Not initialized.” The source is read-only, so no index was created; evidence was collected by direct reads of known source paths.

## Features
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| UI-001 | Storewide closed-order banner | `src/app/(storefront)/layout.tsx` | Shows the configured closure message above every storefront page. |
| UI-002 | Responsive storefront navigation | `src/app/(storefront)/layout.tsx`; `src/components/storefront/mobile-menu.tsx` | Desktop links, mobile menu, auth-aware actions, and staff portal access. |
| UI-003 | Storefront account menu | `src/app/(storefront)/layout.tsx`; `src/components/storefront/user-menu.tsx` | Signed-in user menu replaces sign-in/order CTAs. |
| UI-004 | Storefront footer navigation | `src/app/(storefront)/layout.tsx` | Package, order, mission, past-collection, and sign-in links. |
| UI-005 | Footer email signup | `src/app/(storefront)/layout.tsx`; `src/components/storefront/email-subscribe.tsx` | Subscriber form is available on every storefront page. |
| UI-006 | Marketing homepage hero | `src/app/(storefront)/page.tsx` | Campaign year, mission copy, order/browse CTA, and mission CTA. |
| UI-007 | Homepage impact statistics | `src/app/(storefront)/page.tsx`; `src/components/storefront/home-impact-bar.tsx` | Dedicated impact strip below the hero. |
| UI-008 | Homepage “How It Works” | `src/app/(storefront)/page.tsx` | Three-step choose, pack/deliver, and proceeds explanation. |
| UI-009 | Homepage seasonal package cards | `src/app/(storefront)/page.tsx` | Live products, images, categories, prices, sold-out state, and deep links. |
| UI-010 | Homepage closed-store CTA adaptation | `src/app/(storefront)/page.tsx` | Order buttons become browse-collection buttons when ordering is closed. |
| UI-011 | Homepage mission storytelling | `src/app/(storefront)/page.tsx` | Two image/text sections explain volunteers and Shabbos support. |
| UI-012 | Homepage testimonials | `src/app/(storefront)/page.tsx` | Three supporter quote cards. |
| UI-013 | Homepage final campaign CTA | `src/app/(storefront)/page.tsx` | Closing order/browse action with donation/tax language. |
| UI-014 | Seasonal package catalog | `src/app/(storefront)/packages/page.tsx` | Active current-season catalog with closed-store and no-products states. |
| UI-015 | Package category filters | `src/app/(storefront)/packages/packages-grid.tsx` | Toggle pills filter the catalog by category. |
| UI-016 | Package price sorting | `src/app/(storefront)/packages/packages-grid.tsx` | Default, low-to-high, and high-to-low sorting. |
| UI-017 | Package quick view | `src/app/(storefront)/packages/packages-grid.tsx`; `src/components/storefront/product-quick-view.tsx` | Keyboard-clickable cards open a product modal. |
| UI-018 | Catalog sold-out handling | `src/app/(storefront)/packages/packages-grid.tsx` | Sold-out products receive a prominent status. |
| UI-019 | Package detail page | `src/app/(storefront)/packages/[id]/page.tsx` | Image, description, price, and back navigation. |
| UI-020 | Product option pricing display | `src/app/(storefront)/packages/[id]/page.tsx` | Option badges show positive or negative price adjustments. |
| UI-021 | Product-to-order deep link | `src/app/(storefront)/packages/[id]/page.tsx`; `src/app/(storefront)/order/page.tsx` | “Send This Package” opens the builder with that product selected. |
| UI-022 | Closed-store product detail state | `src/app/(storefront)/packages/[id]/page.tsx` | Replaces ordering action with a closure notice. |
| UI-023 | Closed-store order-builder gate | `src/app/(storefront)/order/page.tsx` | Builder is replaced with closure copy and a catalog link. |
| UI-024 | Resume latest or named web draft | `src/app/(storefront)/order/page.tsx` | Supports `?draft=` and automatic latest-draft resume. |
| UI-025 | Shared storefront/POS order-builder shell | `src/features/order-builder/components/OrderBuilderShell.tsx` | Same responsive builder powers web and staff POS. |
| UI-026 | Product browsing inside order builder | `src/features/order-builder/components/OrderBuilderShell.tsx`; `src/features/order-builder/components/ProductPanel.tsx` | Product panel supports choosing and quick viewing products. |
| UI-027 | Product quick view in builder | `src/features/order-builder/components/OrderBuilderShell.tsx`; `src/features/order-builder/components/ProductQuickView.tsx` | Product detail can be inspected before assignment. |
| UI-028 | Assign product to recipients | `src/features/order-builder/components/OrderBuilderShell.tsx`; `src/features/order-builder/components/RecipientAssignDialog.tsx` | Assignment dialog connects products, options, add-ons, and destinations. |
| UI-029 | Add recipient from saved address | `src/features/order-builder/components/AddRecipientDialog.tsx` | Saved-address tab adds an empty recipient destination to the draft. |
| UI-030 | Add recipient with new address | `src/features/order-builder/components/AddRecipientDialog.tsx` | Validated new-address form requires phone and destination fields. |
| UI-031 | Edit saved address while ordering | `src/features/order-builder/components/OrderBuilderShell.tsx`; `src/features/order-builder/components/EditSavedAddressDialog.tsx` | Address edits update the builder’s local address list. |
| UI-032 | Live stock-aware ordering | `src/app/(storefront)/order/page.tsx`; `src/features/order-builder/components/ProductPanel.tsx` | Builder receives each product’s currently available quantity. |
| UI-033 | Product-specific add-on restrictions | `src/app/(storefront)/order/page.tsx`; `src/features/order-builder/components/RecipientAssignDialog.tsx` | Add-ons include restriction mode and allowed product IDs. |
| UI-034 | Draft autosave | `src/app/(storefront)/order/order-builder.tsx`; `src/features/order-builder/components/AutoSave.tsx` | Web draft changes are watched and persisted. |
| UI-035 | Desktop order sidebar | `src/features/order-builder/components/OrderBuilderShell.tsx`; `src/features/order-builder/components/OrderSidebar.tsx` | Desktop review panel exposes recipients, totals, and checkout. |
| UI-036 | Mobile cart sheet | `src/features/order-builder/components/OrderBuilderShell.tsx`; `src/features/order-builder/components/MobileCartFab.tsx` | Floating mobile cart opens the responsive order summary. |
| UI-037 | Save-and-review checkout transition | `src/features/order-builder/components/OrderBuilderShell.tsx` | Saves the draft, preserves guest token, and routes to web or POS checkout. |
| UI-038 | Checkout ownership and draft gating | `src/app/(storefront)/checkout/page.tsx` | Only an owner or guest-token holder can view an open draft checkout. |
| UI-039 | Checkout recipient summary | `src/features/checkout/components/CheckoutClient.tsx` | Shows every recipient, destination, item, option, add-on, and greeting. |
| UI-040 | Checkout donation summary | `src/features/checkout/components/CheckoutClient.tsx` | Donations appear separately from recipient merchandise. |
| UI-041 | Per-recipient delivery selection | `src/features/checkout/components/CheckoutClient.tsx` | Displays available pickup, local-delivery, and carrier choices with prices. |
| UI-042 | Apply delivery mode to all recipients | `src/features/checkout/components/CheckoutClient.tsx` | “Deliver all” and “Pickup all” bulk controls. |
| UI-043 | Live shipping-total refresh | `src/features/checkout/components/CheckoutClient.tsx` | Shipping choices update server-derived totals. |
| UI-044 | Card, check, and cash checkout | `src/features/checkout/components/CheckoutClient.tsx`; `src/app/(storefront)/checkout/page.tsx` | Offline methods are setting-gated; card is always offered. |
| UI-045 | Guest confirmation-email capture | `src/features/checkout/components/CheckoutClient.tsx` | Guests must supply an email before payment. |
| UI-046 | Checkout availability conflict UI | `src/features/checkout/components/CheckoutClient.tsx` | Out-of-stock/unavailable items block payment and link back to editing. |
| UI-047 | Checkout price-change acknowledgement | `src/features/checkout/components/CheckoutClient.tsx` | Shows old/new prices and requires explicit confirmation. |
| UI-048 | Order confirmation page | `src/app/(storefront)/checkout/success/page.tsx` | Shows order number, recipient count, total, and next actions. |
| UI-049 | Auth-gated account navigation | `src/app/(storefront)/account/layout.tsx` | Responsive orders, addresses, profile, and conditional admin navigation. |
| UI-050 | Customer order history | `src/app/(storefront)/account/orders/page.tsx` | Order cards show date, recipients, statuses, total, and recipient names. |
| UI-051 | Continue draft from order history | `src/app/(storefront)/account/orders/page.tsx` | Draft cards link back to the builder. |
| UI-052 | Customer order detail | `src/app/(storefront)/account/orders/[id]/page.tsx` | Ownership-gated recipients, items, totals, payments, and tracking. |
| UI-053 | Customer draft actions | `src/app/(storefront)/account/orders/[id]/page.tsx` | Cancel, continue editing, or pay a draft. |
| UI-054 | Repeat a completed order | `src/app/(storefront)/account/orders/[id]/page.tsx` | Completed non-cancelled orders link to repeat flow. |
| UI-055 | Customer profile editing | `src/app/(storefront)/account/profile/page.tsx`; `src/app/(storefront)/account/profile/profile-form.tsx` | Name, phone, and email can be updated. |
| UI-056 | Saved-address list | `src/app/(storefront)/account/addresses/page.tsx` | Displays destination cards and a no-address state. |
| UI-057 | Token-verified email preferences | `src/app/(storefront)/unsubscribe/page.tsx` | Invalid/missing tokens receive explicit error states. |
| UI-058 | Three unsubscribe preferences | `src/app/(storefront)/unsubscribe/unsubscribe-form.tsx` | Unsubscribe-all with reason, only-if-not-ordered, or once-yearly. |
| UI-059 | Permission-aware responsive admin shell | `src/app/(admin)/admin/layout.tsx`; `src/app/(admin)/admin/admin-shell.tsx`; `src/components/admin/admin-sidebar.tsx` | Desktop sidebar, mobile nav, role checks, and pending-account screen. |
| UI-060 | Test/live environment switch and store link | `src/app/(admin)/admin/admin-shell.tsx` | Header provides sister-environment and storefront navigation. |
| UI-061 | Guided tours and Help Center | `src/app/(admin)/admin/admin-shell.tsx` | Test environment exposes tours and help on desktop/mobile. |
| UI-062 | Developer impersonation indicator | `src/app/(admin)/admin/layout.tsx`; `src/app/(admin)/admin/admin-shell.tsx` | Active role impersonation is shown above the admin shell. |
| UI-063 | Admin KPI dashboard | `src/app/(admin)/admin/page.tsx` | Orders today, packing backlog, season revenue, and unpaid counts. |
| UI-064 | Permission-gated dashboard shortcuts | `src/app/(admin)/admin/page.tsx` | POS, fulfillment, follow-up, route, customer, email, and export tiles. |
| UI-065 | Recent-orders dashboard list | `src/app/(admin)/admin/page.tsx` | Last five orders show customer, recipients, date, total, and statuses. |
| UI-066 | Daily prioritized work queue | `src/app/(admin)/admin/today/page.tsx` | Eight permission-aware operational cards link to outstanding work. |
| UI-067 | Admin order search and filters | `src/app/(admin)/admin/orders/page.tsx`; `src/app/(admin)/admin/orders/orders-search-bar.tsx` | Searches IDs/customer contact and filters status, payment, and presets. |
| UI-068 | Paginated responsive order list | `src/app/(admin)/admin/orders/page.tsx` | Desktop table and mobile cards with alert banners. |
| UI-069 | Full admin order detail | `src/app/(admin)/admin/orders/[id]/page.tsx` | Customer, source, totals, payments, recipients, fulfillment, and notes. |
| UI-070 | Manual payments, refunds, and cancellation | `src/app/(admin)/admin/orders/[id]/page.tsx`; `src/app/(admin)/admin/orders/[id]/order-money-actions.tsx` | Permission-aware money actions use balance/refundable amounts. |
| UI-071 | Shipment label actions | `src/app/(admin)/admin/orders/[id]/page.tsx`; `src/app/(admin)/admin/orders/[id]/shipment-actions.tsx` | Carrier groups can buy/open/void labels when configured and permitted. |
| UI-072 | Packing-slip view | `src/app/(admin)/admin/orders/[id]/page.tsx`; `src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx` | Placed orders link to printable packing slips. |
| UI-073 | Searchable customer directory | `src/app/(admin)/admin/customers/page.tsx` | Name/email/phone search, pagination, counts, and spend totals. |
| UI-074 | Add and CSV-import customers | `src/app/(admin)/admin/customers/page.tsx`; `src/app/(admin)/admin/customers/add-customer-dialog.tsx` | Manual and bulk customer creation. |
| UI-075 | Admin customer detail | `src/app/(admin)/admin/customers/[id]/page.tsx`; `src/app/(admin)/admin/customers/[id]/customer-detail-client.tsx` | Contact info, notes, addresses, order history, and customer actions. |
| UI-076 | Bulk repeat past customer orders | `src/app/(admin)/admin/customers/[id]/page.tsx` | Available when a customer has multiple placed orders. |
| UI-077 | Staff POS ordering | `src/app/(admin)/admin/pos/page.tsx`; `src/app/(admin)/admin/pos/pos-builder.tsx` | Customer lookup/preselection, draft resume, shared builder, and POS checkout. |
| UI-078 | Season-switchable product catalog | `src/app/(admin)/admin/products/page.tsx` | Search, pagination, season selector, sales, revenue, inventory, and status. |
| UI-079 | Read-only historical catalogs | `src/app/(admin)/admin/products/page.tsx` | Past seasons suppress mutation controls and show a read-only banner. |
| UI-080 | Product creation and CSV import | `src/app/(admin)/admin/products/page.tsx`; `src/app/(admin)/admin/products/new/page.tsx` | Current-season catalog supports manual and bulk additions. |
| UI-081 | Inventory overview | `src/app/(admin)/admin/inventory/page.tsx`; `src/app/(admin)/admin/inventory/overview-tab.tsx` | Goal, sold, needed, remaining, products, and add-on inventory. |
| UI-082 | Inventory target and damage controls | `src/app/(admin)/admin/inventory/overview-tab.tsx`; `src/app/(admin)/admin/inventory/inventory-controls.tsx` | Authorized users edit goals and report write-offs. |
| UI-083 | Production batch entry | `src/app/(admin)/admin/inventory/production-tab.tsx`; `src/app/(admin)/admin/inventory/daily-batch-dialog.tsx` | Deficit-sorted daily production logging. |
| UI-084 | Purchased-stock receiving | `src/app/(admin)/admin/inventory/production-tab.tsx` | Separates received purchased add-ons from kitchen production. |
| UI-085 | Production history and undo | `src/app/(admin)/admin/inventory/production-tab.tsx`; `src/app/(admin)/admin/inventory/production-history.tsx` | Season-wide batch history rail with undo. |
| UI-086 | Fulfillment channel dashboard | `src/app/(admin)/admin/fulfillment/page.tsx` | Pickups, local deliveries, and shipments with ready/waiting/done counts. |
| UI-087 | Bulk fulfillment status actions | `src/app/(admin)/admin/fulfillment/page.tsx`; `src/app/(admin)/admin/fulfillment/channel-action-button.tsx` | Marks channel groups picked up, delivered, or shipped. |
| UI-088 | Fulfillment production and savings summaries | `src/app/(admin)/admin/fulfillment/page.tsx` | Shows groups waiting on production and rate-shopping savings. |
| UI-089 | Visual route builder | `src/app/(admin)/admin/fulfillment/build-route/page.tsx`; `src/app/(admin)/admin/fulfillment/build-route/route-builder.tsx` | ZIP filter, optional Mapbox pins, stop selection/reordering, driver/date assignment, save. |
| UI-090 | Email campaign lifecycle | `src/app/(admin)/admin/email/campaigns-tab.tsx` | Draft/sent lists with create, edit, duplicate, send, and delete actions. |
| UI-091 | Triggered-email visual editing | `src/app/(admin)/admin/email/triggered-tab.tsx` | Lists automatic messages and links each to its editor. |
| UI-092 | Mailing-list management | `src/app/(admin)/admin/email/lists-tab.tsx` | Create, edit, manage members, and delete lists. |
| UI-093 | Subscriber management | `src/app/(admin)/admin/email/subscribers-tab.tsx` | Search, add, CSV import, preference badges, and remove. |
| UI-094 | Email branding templates | `src/app/(admin)/admin/email/templates-tab.tsx` | Create/edit templates, color preview, default selection, and delete. |
| UI-095 | Order and payment settings | `src/app/(admin)/admin/settings/page.tsx`; `src/app/(admin)/admin/settings/orders-tab.tsx` | Store status, cash/check toggles, pickup locations, and follow-up policies. |
| UI-096 | Shipping configuration | `src/app/(admin)/admin/settings/page.tsx`; `src/app/(admin)/admin/settings/shipping-tab.tsx` | Rates, delivery ZIPs, package types, merge toggle, Shippo status, and rule editor. |
| UI-097 | Email configuration and test sender | `src/app/(admin)/admin/settings/email-tab.tsx` | Shows Resend status/from identity and sends a real test email with feedback. |
| UI-098 | New-season wizard | `src/app/(admin)/admin/settings/page.tsx`; `src/app/(admin)/admin/settings/new-season-wizard.tsx` | Admin action starts a new seasonal configuration flow. |
| UI-099 | Staff-account management | `src/app/(admin)/admin/users/page.tsx`; `src/app/(admin)/admin/users/users-client.tsx` | Confirm pending users; change roles, overrides, access, or delete active users. |
| UI-100 | Follow-up call center | `src/app/(admin)/admin/follow-up/page.tsx`; `src/app/(admin)/admin/follow-up/follow-up-list.tsx` | Unpaid, overdue-pickup, lapsed, all, and snoozed views with expandable actions. |
| UI-101 | Multi-year season reports | `src/app/(admin)/admin/reports/page.tsx` | KPI comparisons, year table, lapsed-customer drill-down, and item winners/losers. |
| UI-102 | CSV export center and history | `src/app/(admin)/admin/export/page.tsx` | Five report exports plus recent download audit history. |
| UI-103 | Test-environment operations | `src/app/(admin)/admin/test-mode/page.tsx` | Captured email preview/clear, seed demo data, wipe test data, and live-to-test reset. |
| UI-104 | Driver route list and delivery workflow | `src/app/(messenger)/messenger/page.tsx`; `src/app/(messenger)/messenger/routes/[id]/page.tsx` | Assigned/completed routes, progress, start route, call/map links, item/greeting details, and deliver buttons. |

## Blocked or intentionally excluded
- CodeGraph could not be used because the corrected read-only source has no index.
- Dedicated glob/search tools ignore the harness `.scratch` source tree; direct known-path reads were used.
- Disabled “coming soon” controls and explicit placeholder handlers were not counted as features (for example order CSV export/delete, order-detail follow-up edits, and developer import/archive/reset placeholders).
- A few linked secondary pages/components were evidenced through their parent route and direct import path but were not exhaustively decomposed into every field-level control.
