# Codebase inventory — arm-04 (specialist slice: `ui`)

Scope: user-visible interface only — routes/screens, layouts and navigation, shared
components and design tokens, dialogs, print views, responsive/mobile behavior.
Server logic, data model, integrations, and security are other specialists' slices and
appear here only where they change what a user sees.

## Proof-of-read

- Rules files read: **5** — `.cursor/rules/workflow.mdc`, `ponytail.mdc`, `clean-code.mdc`,
  `vocabulary.mdc`, `codegraph.mdc` (plus `AGENTS.md`, `ARM.md`, `CONTESTANT-PROMPT.md`,
  and the test prompt `.scratch/1a-ui-prompt.md`). `grill-protocol.mdc` is load-on-demand
  and does not apply to an inventory pass.
- Source tree file count: **216** files under `src/`, plus `e2e/`, `public/`, and root config.
- Top-level dirs sampled: `src/app` (all route groups: `(storefront)`, `(admin)`, `(messenger)`,
  `(auth)`, `api`), `src/components` (`ui`, `admin`, `storefront`, `ordering`),
  `src/features` (`order-builder`, `checkout`, `tours`), `src/styles`, `e2e`, `public`, repo root.
- Method: `codegraph status` in the source root reports **not initialized**, and the source is
  read-only for this test, so `codegraph init` was not run (it would write `.codegraph/` into
  the source). Structural mapping used directory listing + file reads, which `codegraph.mdc`
  allows as the fallback when no index exists.

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | App shell / root layout | `src/app/layout.tsx` | Clerk provider, Inter + Playfair Display + Geist Mono fonts, Sonner toaster (bottom-right, rich colors), `data-test-env` body attribute. |
| F-002 | Design tokens (burgundy/gold theme) | `src/styles/tokens.css`, `src/app/globals.css` | OKLCH palette (burgundy `#722F37`, gold `#C9A84C`, cream page background), radius scale, sidebar tokens, `--gold-strong` for contrast on light surfaces. Tailwind v4 `@theme inline` mapping. |
| F-003 | Test-environment green theme swap | `src/styles/tokens.css` (`body[data-test-env="true"]`) | Whole brand palette flips green on the sandbox so test can't be mistaken for live. |
| F-004 | Test-mode banner | `src/components/storefront/test-mode-banner.tsx` | Fixed banner at top of every page when `NEXT_PUBLIC_APP_ENV=test`; returns null in production. |
| F-005 | Global error boundary screen | `src/app/error.tsx` | Centered card with "Try Again" + "Go Home"; posts the error to `/api/client-error`. |
| F-006 | Base UI component kit | `src/components/ui/` (button, input, textarea, label, select, checkbox, switch, dialog, sheet, popover, dropdown-menu, tabs, table, card, badge, avatar, separator) | Built on `@base-ui/react` with CVA variants and `cn()`; single styling approach across storefront, admin, and messenger. |
| F-007 | Shared feedback/layout primitives | `src/components/ui/empty-state.tsx`, `callout.tsx`, `confirm-dialog.tsx`, `info-hint.tsx`, `page-header.tsx` | Empty states, tone-based notices, reusable confirm modal, tap-friendly "?" help popovers, admin page title bar with actions slot. |
| F-008 | Responsive table pattern | `src/components/ui/responsive-table.tsx` | Real `<table>` at `md+`, card stack below; includes mobile card rows and mobile empty state. |
| F-009 | Sortable/searchable table header | `src/components/ui/sortable-table.tsx` | Client sort indicators plus a filter input; used by the audit log and other list views. |
| F-010 | Status badge vocabulary | `src/components/admin/status-badges.tsx` | One place decides colors for order, payment, catalog, and delivery-route statuses so a status looks identical on every screen. |
| F-011 | Money and tag display primitives | `src/components/ui/price-tag.tsx`, `pill-input.tsx`, `smart-select.tsx`, `fab.tsx` | Cents-to-dollars price display with gradient variant, removable-token input (ZIP lists), label-stable select, mobile-only floating action button. |
| F-012 | Storefront shell (header + footer) | `src/app/(storefront)/layout.tsx` | Sticky translucent burgundy header with brand initials, desktop nav (Packages / Mission / How It Works), signed-in user menu vs Sign In + Order Now CTAs, 3-column footer with quick links, 501(c)(3) notice, subscribe form. |
| F-013 | Store-closed banner | `src/app/(storefront)/layout.tsx` (store status block) | Amber strip above the header with the season's closed message when ordering is off. |
| F-014 | Home page | `src/app/(storefront)/page.tsx` | Hero with split Purim/Shabbos imagery and dual CTAs, impact bar, How It Works (three gold-connected steps), season package grid, mission rows, testimonials, closing CTA. |
| F-015 | Animated impact stats bar | `src/components/storefront/home-impact-bar.tsx` | Numbers count up once when scrolled into view (IntersectionObserver). |
| F-016 | Package catalog page | `src/app/(storefront)/packages/page.tsx`, `packages-grid.tsx` | Category filter pills with `aria-pressed`, price sort (default / low-high / high-low), sold-out badges, keyboard-accessible card buttons. |
| F-017 | Packages loading skeleton | `src/app/(storefront)/packages/loading.tsx` | Six animated placeholder cards in the same responsive grid. |
| F-018 | Product quick-view modal (storefront) | `src/components/storefront/product-quick-view.tsx` | Render-prop dialog: image, price, description, option badges with price adjustments, send / full-details CTAs. |
| F-019 | Package detail page | `src/app/(storefront)/packages/[id]/page.tsx` | Large image, price, description, option badges, deep-link CTA into the builder, back link to `/packages`. |
| F-020 | Past collections archive | `src/app/(storefront)/past-collections/page.tsx` | Read-only year-by-year gallery of previous catalogs, newest first, no buy buttons. |
| F-021 | Footer email subscribe | `src/components/storefront/email-subscribe.tsx` | Inline form with toast feedback for new / already-subscribed / resubscribed, then a thank-you state. |
| F-022 | Storefront mobile menu | `src/components/storefront/mobile-menu.tsx` | Right-side sheet drawer with all nav plus account links and a staff-only Admin Portal link. |
| F-023 | Storefront user menu | `src/components/storefront/user-menu.tsx` | Clerk `UserButton` extended with My Orders, Saved Addresses, and (staff) Admin Portal. |
| F-024 | Sign-in / sign-up screens | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `sign-up/[[...sign-up]]/page.tsx` | Clerk hosted components centered full-screen. |
| F-025 | First-run setup screen | `src/app/(storefront)/setup/page.tsx` | Bootstrap form to create the first developer account; only reachable on an empty staff table. |
| F-026 | Unsubscribe preference screen | `src/app/(storefront)/unsubscribe/page.tsx`, `unsubscribe-form.tsx` | Token-verified page with three radio choices (unsubscribe with reason, only-if-not-ordered, once-yearly) and an error state for forged links. |
| F-027 | Shared checkout screen | `src/app/(storefront)/checkout/page.tsx`, `src/features/checkout/components/CheckoutClient.tsx` | Per-recipient summary cards, donations, totals, payment choice (card always, cash/check when enabled); the same component serves storefront and POS. |
| F-028 | Checkout success page | `src/app/(storefront)/checkout/success/page.tsx` | Green confirmation with recipient count and total, "Place Another Order" and "Back to Home"; never shows raw ids. |
| F-029 | Account area shell | `src/app/(storefront)/account/layout.tsx`, `account/page.tsx` | Auth gate with side nav on desktop and horizontal scroll pills on mobile; staff get an Admin Portal link; `/account` redirects to orders. |
| F-030 | Customer order history | `src/app/(storefront)/account/orders/page.tsx` | Order cards with number, recipient count, date, total, status badges, first four recipients; drafts get a dashed amber border and "Continue Order". |
| F-031 | Customer order detail + cancel | `src/app/(storefront)/account/orders/[id]/page.tsx`, `cancel-draft-button.tsx` | Status banners, recipient cards, payment info, Edit/Checkout for drafts, confirm-then-cancel with inline failure text. |
| F-032 | Repeat-order review screen | `src/app/(storefront)/account/orders/[id]/repeat/page.tsx`, `src/components/ordering/repeat-review.tsx` | Last season's items beside this season's matches with swap, quantity, greeting, and remove controls before any draft is created; shared with the admin repeat flows. |
| F-033 | Saved addresses page | `src/app/(storefront)/account/addresses/page.tsx` | Address cards with edit and delete actions. |
| F-034 | Profile edit form | `src/app/(storefront)/account/profile/page.tsx`, `profile-form.tsx` | Name/phone/email with change detection — Save only appears once something is edited. |
| F-035 | Order builder page (storefront) | `src/app/(storefront)/order/page.tsx`, `order/order-builder.tsx` | Loads season catalog, add-ons, saved addresses, and any resumable draft; closed-store visitors see the closed message instead of the builder. |
| F-036 | Shared builder shell | `src/features/order-builder/components/OrderBuilderShell.tsx` | Product panel left, cart right on desktop, floating cart on mobile; owns the builder dialogs and the Review & Pay routing for both web and POS. |
| F-037 | Product panel (search + filters + donations) | `src/features/order-builder/components/ProductPanel.tsx`, `../catalog.ts` | Search across name/description/category/price, category pills, donations pulled into their own strip. |
| F-038 | Product tile | `src/features/order-builder/components/ProductCard.tsx` | Image/name as a real button for keyboard users, category badge, price, option names, stock badge (out / low / available), "Donate" CTA for donation items. |
| F-039 | Builder quick view | `src/features/order-builder/components/ProductQuickView.tsx` | Larger preview with options and price adjustments; sold-out products can't be sent. |
| F-040 | Recipient assign dialog | `src/features/order-builder/components/RecipientAssignDialog.tsx` | Option, quantity, greeting, add-ons plus seven ship-to modes (assign later, pickup, new address, saved address, my recipients, existing destination in this order, myself); donations get a reduced form. |
| F-041 | Add-recipient dialog | `src/features/order-builder/components/AddRecipientDialog.tsx` | Two tabs (saved address or new address) that add an empty destination to the recipient book. |
| F-042 | Edit saved address in-place | `src/features/order-builder/components/EditSavedAddressDialog.tsx` | Pre-filled edit dialog that also keeps draft groups pointing at that address in sync. |
| F-043 | Order cart sidebar | `src/features/order-builder/components/OrderSidebar.tsx`, `../orderDraftSelectors.ts` | Destination cards, donations section, unassigned section with three assign paths (drag, inline menu, bulk select); footer shows subtotal + delivery count and disables Review & Pay until every non-donation package has a home. |
| F-044 | Mobile cart FAB + bottom sheet | `src/features/order-builder/components/MobileCartFab.tsx` | Floating button showing delivery count and subtotal, opening the full cart as a sheet on phones. |
| F-045 | Draft autosave and guest resume | `src/features/order-builder/components/AutoSave.tsx`, `ClearGuestDraftOnSuccess.tsx` | Debounced background save; guests get a localStorage resume pointer that is cleared after a successful checkout. |
| F-046 | Address autocomplete + manual fields | `src/components/ordering/address-autocomplete.tsx`, `address-fields.tsx` | ARIA combobox over Mapbox geocoding (arrow keys, Enter, Escape) with hand-typed fields that always work if Mapbox is unavailable; one shared address form for every dialog. |
| F-047 | Admin auth-gated layout | `src/app/(admin)/admin/layout.tsx` | Staff-only gate with a "pending confirmation" screen for unconfirmed staff; resolves impersonated role before rendering. |
| F-048 | Admin shell | `src/app/(admin)/admin/admin-shell.tsx` | Sticky 64-wide sidebar on desktop, sheet nav on mobile, header row with Help, tour, env switch, visit store, and Clerk user button. |
| F-049 | Permission-aware sidebar nav | `src/components/admin/admin-sidebar.tsx`, `src/components/admin/sidebar-config.ts` | Today and Dashboard pinned, then six collapsible groups (Sales, Products, Packing & delivery, Reports, Settings, Developer — the file's own header comment still says five); sections auto-open on the active route and hide entirely when the user can see none of their links; every link carries a plain-English hint. |
| F-050 | Admin mobile nav | `src/components/admin/mobile-nav.tsx` | Hamburger opens the identical sidebar inside a sheet. |
| F-051 | Impersonation bar | `src/components/admin/impersonation-bar.tsx` | Amber bar naming the impersonated user and role with a Stop button. |
| F-052 | Live/test environment switch | `src/components/admin/env-switch-link.tsx`, `src/app/(admin)/admin/env-switch/route.ts` | "Switch to Test" / "Back to Live" link to the sister deployment; only rendered when the sister URL is configured. |
| F-053 | Visit store link | `src/components/admin/visit-store-link.tsx` | Icon or text link opening the storefront in a new tab. |
| F-054 | Guided tours | `src/features/tours/admin-tour.tsx`, `tours.ts`, `run-driver.ts` | Test-env-only driver.js walkthroughs: site tour plus per-page tours, auto-started from `?tour=`, with driver.js lazy-loaded and missing targets skipped. |
| F-055 | Help center | `src/app/(admin)/admin/help/page.tsx`, `help-content.tsx`, `help-articles.ts` | Searchable, category-filtered articles with step lists and "Show me" buttons that launch the matching tour. |
| F-056 | Admin dashboard | `src/app/(admin)/admin/page.tsx` | Stat cards, permission-filtered quick links, and recent activity. |
| F-057 | Today work queue | `src/app/(admin)/admin/today/page.tsx`, `src/features/today/server/workQueue.ts` | "What needs attention now" cards — pickups, labels, calls — with relative dates and deep links. |
| F-058 | Orders list | `src/app/(admin)/admin/orders/page.tsx`, `orders-search-bar.tsx` | Search, filter presets, status/payment dropdowns, alert banners, pagination, CSV export button. |
| F-059 | Order detail | `src/app/(admin)/admin/orders/[id]/page.tsx` | Customer block, status badges, per-recipient fulfillment cards, totals, payment summary, follow-up controls, staff notes. |
| F-060 | Order money and shipment actions | `src/app/(admin)/admin/orders/[id]/order-money-actions.tsx`, `shipment-actions.tsx` | Record payment / refund / cancel dialogs with dollar inputs and toast failures; shipment row shows Buy cheapest label, Check address, Print label, Refresh tracking, and a confirm-guarded Void label, or a "connect Shippo" note when no carrier key is set. |
| F-061 | Packing slip print view | `src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx` | One section per recipient with items, options, add-ons, greeting; print-only layout. |
| F-062 | Admin repeat order (single) | `src/app/(admin)/admin/orders/[id]/repeat/page.tsx` | Staff-side version of the repeat review screen, landing in the POS builder on confirm. |
| F-063 | Bulk repeat | `src/app/(admin)/admin/orders/repeat-bulk/page.tsx`, `bulk-repeat-form.tsx` | Tick several past orders for one customer and consolidate them into one draft; submit stays disabled until something is selected. |
| F-064 | POS order builder | `src/app/(admin)/admin/pos/page.tsx`, `pos-builder.tsx` | The same builder shoppers use, wrapped with a customer bar (search, walk-in, create new, draft reference badge) and a staff-only notes field. |
| F-065 | POS checkout | `src/app/(admin)/admin/pos/checkout/[orderId]/page.tsx` | Shared `CheckoutClient` in POS mode for cash/check/card at the counter. |
| F-066 | Customers list | `src/app/(admin)/admin/customers/page.tsx`, `customer-search.tsx`, `add-customer-dialog.tsx` | Debounced `?q=` search, paginated table with order count and total spent, Add Customer dialog, CSV import. |
| F-067 | Customer detail | `src/app/(admin)/admin/customers/[id]/page.tsx`, `customer-detail-client.tsx` | Contact info, order history, saved addresses, duplicate detection, new-order and delete actions. |
| F-068 | Follow-up calls board | `src/app/(admin)/admin/follow-up/page.tsx`, `follow-up-filters.tsx`, `follow-up-list.tsx` | Pill tabs (unpaid / pickup / lapsed / all) plus a snoozed toggle, all URL-synced; expandable card rows with call and email shortcuts. |
| F-069 | Email hub (5 tabs) | `src/app/(admin)/admin/email/page.tsx`, `email-tabs.tsx` | URL-synced tabs: Campaigns, Triggered, Lists, Subscribers, Templates. |
| F-070 | WYSIWYG email builder | `src/app/(admin)/admin/email/campaign-builder.tsx`, `campaign-blocks.ts`, `new/page.tsx`, `[id]/edit/page.tsx` | Full-screen block editor (heading, paragraph, button, image, divider, spacer) with reordering, per-block styles, live HTML preview, and click-to-insert merge variables. |
| F-071 | Campaign row actions | `src/app/(admin)/admin/email/campaign-actions.tsx`, `campaigns-tab.tsx` | Send with confirmation and recipient count, duplicate, delete. |
| F-072 | Triggered email customization | `src/app/(admin)/admin/email/triggered-tab.tsx`, `triggered/[key]/edit/page.tsx`, `email-editors.tsx` | Per-template rows showing customized state, plus the block editor in triggered mode and a reset-to-default option. |
| F-073 | Email branding templates | `src/app/(admin)/admin/email/templates-tab.tsx`, `email-editors.tsx` | Logo/colors/footer editor with server-rendered preview, set-default, delete. |
| F-074 | Mailing lists | `src/app/(admin)/admin/email/lists-tab.tsx`, `list-editors.tsx` | Create/edit lists and pick members from a searchable checkbox dialog. |
| F-075 | Subscribers tab | `src/app/(admin)/admin/email/subscribers-tab.tsx`, `subscriber-controls.tsx` | Add one, unsubscribe one, or CSV-import many with a downloadable sample. |
| F-076 | Products list with season switch | `src/app/(admin)/admin/products/page.tsx`, `season-select.tsx` | Paginated, searchable catalog with units sold and revenue per season; past seasons are read-only behind a banner. |
| F-077 | Product create/edit form | `src/app/(admin)/admin/products/product-form.tsx`, `new/page.tsx`, `[id]/edit/page.tsx` | Catalog fields, season inventory goal, image picker, "replaces last year's item" link, inline options editor, attachable add-ons. |
| F-078 | Product detail + replacement editor | `src/app/(admin)/admin/products/[id]/page.tsx`, `replacement-editor.tsx` | Read-only detail with options, add-ons, inventory summary, and a cross-season replacement chain that stays editable on old products. |
| F-079 | Product row actions | `src/app/(admin)/admin/products/product-actions.tsx` | Edit link, activate/deactivate toggle, delete with confirmation. |
| F-080 | Add-ons management | `src/app/(admin)/admin/addons/page.tsx`, `addon-actions.tsx` | Add-on table with price, restriction mode, kitchen flag, status, plus create/edit dialog and CSV import. |
| F-081 | Media library | `src/app/(admin)/admin/media/page.tsx`, `media-actions.tsx`, `needs-photos-panel.tsx` | Responsive image grid with size and usage count, multi-file upload with progress, delete confirmation, and a "needs photos" panel that assigns an image to a product in two clicks. |
| F-082 | Media picker for forms | `src/components/admin/media-picker.tsx` | Thumbnail plus dialog to search the library or upload on the spot. |
| F-083 | Shared CSV import dialog | `src/components/admin/csv-import-dialog.tsx` | Sample download, upload, and success/error reporting; reused by customers, products, add-ons, subscribers. |
| F-084 | Inventory dashboard | `src/app/(admin)/admin/inventory/page.tsx`, `inventory-tabs.tsx`, `overview-tab.tsx` | URL-driven Overview/Production tabs; overview shows four summary cards plus product and add-on inventory tables. Production tab hidden for read-only staff. |
| F-085 | Production tab and daily batch | `src/app/(admin)/admin/inventory/production-tab.tsx`, `daily-batch-dialog.tsx`, `inventory-controls.tsx` | Deficit-sorted batch entry (made/received + damaged per row), status table with progress bars, receive-stock flow for purchased add-ons, damage reporting, editable season goal. |
| F-086 | Production history with undo | `src/app/(admin)/admin/inventory/production-history.tsx` | Newest-first rail of batch and damage entries with who logged them and a confirm-then-undo. |
| F-087 | Fulfillment overview | `src/app/(admin)/admin/fulfillment/page.tsx`, `channel-action-button.tsx` | Three channel cards (pickup, delivery, shipment) with status counts and a confirm-guarded bulk "mark done" per channel. |
| F-088 | Route builder with map | `src/app/(admin)/admin/fulfillment/build-route/page.tsx`, `route-builder.tsx`, `src/app/globals.css` (`.route-pin`) | Mapbox map with selectable pins, ordered stop list with reorder controls, messenger assignment and save; degrades to a plain checklist when no Mapbox token is configured. |
| F-089 | Routes list and detail | `src/app/(admin)/admin/routes/page.tsx`, `[id]/page.tsx`, `reassign-button.tsx` | Active/finished route cards, ordered stop rows with recipient and status, multi-stop Google Maps link, reassign-messenger dialog. |
| F-090 | Route delivery sheet (print) | `src/app/(admin)/admin/routes/[id]/print/page.tsx` | Driver's paper sheet: ordered stops with address, phone, neighborhood, items, sign-off box. |
| F-091 | Greeting cards (print) | `src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx` | One printed card per line that has a greeting message. |
| F-092 | Print button | `src/components/admin/print-button.tsx` | Opens the browser print dialog and hides itself when printing (`print:hidden`), shared by all three print views. |
| F-093 | Season reports with drill-downs | `src/app/(admin)/admin/reports/page.tsx` | This year vs. the average of past years, year-by-year table, item-level sales matched through the replacement chain; `?drill=` opens lapsed customers and item winners/losers. |
| F-094 | CSV export page | `src/app/(admin)/admin/export/page.tsx` | Export cards (deliveries, year-end, year metrics, item sales, lapsed customers) plus a history table of who downloaded what. |
| F-095 | Reconciliation page | `src/app/(admin)/admin/reconciliation/page.tsx`, `run-button.tsx` | Recent report-only runs with discrepancy list and an on-demand "Run now". |
| F-096 | Settings tabs | `src/app/(admin)/admin/settings/page.tsx`, `orders-tab.tsx`, `shipping-tab.tsx`, `email-tab.tsx`, `developer-tab.tsx` | Four tabs (Developer gated) covering payment options, follow-up policy, shipping, email, and internal tools. |
| F-097 | Settings cards | `src/app/(admin)/admin/settings/store-status-card.tsx`, `pickup-locations-card.tsx`, `package-types-card.tsx`, `shipping-rates-card.tsx`, `shipping-rules-card.tsx`, `delivery-zips-card.tsx`, `follow-up-settings.tsx` | Store open/closed with custom message, pickup locations, package types, flat rates, ordered rule list with move up/down, delivery ZIP pill input, unpaid/pickup follow-up policies. |
| F-098 | New season wizard | `src/app/(admin)/admin/settings/new-season-wizard.tsx` | Dialog that walks staff through opening the next season. |
| F-099 | Staff accounts page | `src/app/(admin)/admin/users/page.tsx`, `users-client.tsx`, `add-staff-dialog.tsx`, `permission-overrides-dialog.tsx` | Pending-confirmation and active-staff tables with row action menus, staff invite/search dialog, and a per-user permission override dialog. |
| F-100 | Impersonation page | `src/app/(admin)/admin/impersonate/page.tsx`, `impersonate-button.tsx` | Developer-only staff grid with "View as [name]" and loading state. |
| F-101 | Test-mode tools page | `src/app/(admin)/admin/test-mode/page.tsx`, `seed-buttons.tsx`, `reset-button.tsx`, `clear-emails-button.tsx` | Captured-email log, seed demo season, wipe test data, typed-confirmation DB reset, clear emails — all with toast/loading feedback. |
| F-102 | Activity log | `src/app/(admin)/admin/audit-log/page.tsx`, `audit-table.tsx` | Last 200 audit rows with staff names resolved, client-side sort and filter. |
| F-103 | List pagination and page size | `src/components/admin/pagination.tsx`, `page-size-selector.tsx`, `list-params.ts` | "Showing X–Y of Z" with prev/next and a whitelisted page-size dropdown (10/25/50/200) shared by every admin list. |
| F-104 | Shared list search | `src/components/admin/list-search.tsx` | Debounced input bound to `?q=` that resets `?page=`. |
| F-105 | Filter-preserving back navigation | `src/components/admin/back-link.tsx`, `remember-list-url.tsx` | Back uses browser history when available and falls back to an href; list URLs (with filters) are stashed in sessionStorage for detail pages. |
| F-106 | Admin alert banner | `src/components/admin/alert-banner.tsx` | Inline warning/info strip, optionally a link, used on list and detail pages. |
| F-107 | Messenger app shell | `src/app/(messenger)/messenger/layout.tsx` | Phone-first layout with no admin chrome; gated to messenger role, `canDrive`, or manager+. |
| F-108 | Messenger route list | `src/app/(messenger)/messenger/page.tsx` | Assigned and in-progress routes with progress bars plus a "Finished today" section; managers see all routes. |
| F-109 | Messenger route detail | `src/app/(messenger)/messenger/routes/[id]/page.tsx`, `deliver-button.tsx`, `start-route-button.tsx` | Ordered stop cards with tap-to-call, tap-to-map, items, greeting text, office-notes banner, Start Route, and a large Delivered button. |
| F-110 | Storefront imagery assets | `public/images/hero.png`, `mission-shabbos-table.jpg`, `mission-volunteers.jpg` | Photography used by the hero and mission sections. |
| F-111 | UI smoke test | `e2e/smoke.spec.ts`, `playwright.config.ts` | Playwright coverage of the main user-visible paths. |
| F-112 | Performance budget config | `lighthouserc.json` | Lighthouse CI thresholds for the storefront pages. |

**Feature count: 112.**

## Observations (UI slice, reported not fixed)

- **Duplicate navigation source.** `src/features/auth/nav.ts` defines a second admin nav
  structure (`ADMIN_NAV_SECTIONS`, `buildAdminNav`) that no component imports — the shell uses
  `src/components/admin/sidebar-config.ts`. Only `nav.test.ts` references it, and the two copies
  have already drifted (the `sidebar-config.ts` Developer links omit the `settings.view`
  permission the `nav.ts` copy requires). Verified with a full-text search of `src/`.
- **Empty scaffold folders.** `src/components/feedback/`, `src/components/forms/`,
  `src/components/layout/`, `src/features/.gitkeep`, `src/integrations/.gitkeep`, and
  `src/components/ui/.gitkeep` are placeholders with no files.
- **Two product quick-view components.** `src/components/storefront/product-quick-view.tsx`
  (packages grid) and `src/features/order-builder/components/ProductQuickView.tsx` (builder)
  render similar dialogs for different call sites.

## Blocked / not covered

- **No runtime verification.** Nothing here was confirmed in a running app — the source was read
  only, with no install, build, or dev server. Behavior notes come from code and the source's own
  file-header comments.
- **No CodeGraph index.** `codegraph status` reports the source project is not initialized;
  initializing would have written into the read-only source tree, so structural mapping was done
  by directory listing and file reads instead.
- **Slice boundary.** Server actions, Prisma schema, integrations (Stripe, Clerk, Resend, Shippo,
  Mapbox, Vercel Blob), API route internals, permissions, and cron jobs were read only far enough
  to describe what the screens show. Those belong to the data, integrations, security, and
  product specialists.
- **Not inspected in depth.** Email HTML output (`src/features/email/server/*Html*`) is
  user-visible but renders outside the app UI; it is left to the product/integrations slices.
