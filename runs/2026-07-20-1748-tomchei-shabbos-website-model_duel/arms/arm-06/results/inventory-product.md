# Codebase inventory — arm-06 (product)

Scope: user-facing features, flows, screens, and permissions as product behavior. Source: `tomche-shabbos-website` (Next.js 16 App Router, read-only). Evidence paths are relative to the source root.

## Proof-of-read
- Rules files read: 5 (`clean-code.mdc`, `codegraph.mdc`, `ponytail.mdc`, `vocabulary.mdc`, `workflow.mdc`) + arm `AGENTS.md`
- Top-level dirs sampled: `src/app` (all 4 route groups + `api/`), `src/features` (22 feature folders), `src/config`, `src/components`, `prisma` (schema enums/models), `docs`, `scripts`, `e2e`; root docs `README.md`, `FEATURE-INVENTORY.md`, `ROUND2-INVENTORY.md`
- Note: `FEATURE-INVENTORY.md` in the source covers only the data-migration scripts; screen-level evidence below comes from route files, feature modules, and the Prisma schema. Codegraph index absent in source and source is read-only, so Read/grep fallback was used (per `codegraph.mdc` fallback clause).

## Features

### Storefront — shopping and checkout

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | Marketing homepage with live package grid | `src/app/(storefront)/page.tsx` | Hero, impact stats bar, how-it-works, mission, testimonials; product cards deep-link into the order builder pre-filled |
| F-002 | Package catalog with sold-out state | `src/app/(storefront)/packages/page.tsx` | Current-season products only; sold-out derived from inventory onHand − reserved |
| F-003 | Package detail page | `src/app/(storefront)/packages/[id]/page.tsx` | Large image, option badges with price adjustments, CTA deep-link to builder |
| F-004 | Past collections archive | `src/app/(storefront)/past-collections/page.tsx` | Read-only prior-season gallery; items still offered are hidden, newest year first |
| F-005 | Store open/closed season gate | `src/features/storefront/server/storeStatus.ts` | One shared gate; browsing stays on when closed, ordering CTAs turn off, custom closed message |
| F-006 | Multi-recipient order builder | `src/features/order-builder/components/OrderBuilderShell.tsx` | One shared shell for storefront + POS; product panel, order sidebar, mobile cart sheet, quick view / assign / add-recipient dialogs |
| F-007 | Per-recipient fulfillment choice | `prisma/schema.prisma` (`FulfillmentCategory`, `FulfillmentMethod`) | pickup / customer_pickup / local_delivery / carrier; methods are staff-editable data, not code |
| F-008 | Add-ons with product restrictions | `src/app/(storefront)/order/page.tsx`; `prisma/schema.prisma` (`AddOnRestrictionMode`) | include / exclude / none restriction modes per add-on |
| F-009 | Greeting card message per gift line | `prisma/schema.prisma` (`OrderLine.greetingMessage`); `src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx` | Free-text greeting per line; printed cards for packing |
| F-010 | Live stock awareness in builder | `src/app/(storefront)/order/page.tsx` | `quantityAvailable = onHand − reserved` shown/enforced per product |
| F-011 | Draft save / resume with autosave | `src/features/order-builder/components/AutoSave.tsx`; `src/app/(storefront)/order/page.tsx` | `?draft=ID` or latest web draft auto-resumed |
| F-012 | Guest checkout via order token | `src/app/(storefront)/checkout/page.tsx`; `src/features/order-builder/components/ClearGuestDraftOnSuccess.tsx` | Token-scoped access without an account; owner-or-token authorization |
| F-013 | Shipping rate selection at checkout | `src/features/shipping/server/ruleEngine.ts`; `src/features/shipping/server/rateResolution.ts` | Admin-configured rules evaluated first (subtotal match), live carrier rates as fallback; customer picks a rate |
| F-014 | Card payment via Stripe Checkout | `src/app/api/checkout/route.ts`; `src/app/api/webhooks/stripe/route.ts` | Order finalizes only in the webhook after payment succeeds; idempotent webhook processing |
| F-015 | Offline payment (cash/check) at checkout | `src/app/api/checkout/offline/route.ts`; `src/app/(storefront)/checkout/page.tsx` | Offered publicly only when the store enables them; finalize then record payment |
| F-016 | Checkout price snapshot + drift detection | `src/features/checkout/server/checkoutValidation.ts` | Prices frozen as baseline at checkout view; drift + stock issues surfaced at Pay |
| F-017 | Checkout success page | `src/app/(storefront)/checkout/success/page.tsx` | Recipient count, total, place-another CTA; no raw CUIDs shown |

### Storefront — account and email preferences

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-018 | Clerk sign-in / sign-up | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`; `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Clerk hosted UI; identity in Clerk, authorization in DB |
| F-019 | Customer order history | `src/app/(storefront)/account/orders/page.tsx` | Status badges, recipient preview; drafts highlighted with "Continue Order" |
| F-020 | Customer order detail (ownership-gated) | `src/app/(storefront)/account/orders/[id]/page.tsx` | Own orders only; edit/checkout drafts, cancel unpaid orders |
| F-021 | Repeat a past order (substitution review) | `src/app/(storefront)/account/orders/[id]/repeat/page.tsx` | Last time's items mapped to current catalog; swap/qty/greeting/remove before draft creation |
| F-022 | Saved addresses management | `src/app/(storefront)/account/addresses/page.tsx`; `prisma/schema.prisma` (`SavedAddress`) | Labeled addresses with default ("myself"); reused by builder |
| F-023 | Profile editing | `src/app/(storefront)/account/profile/page.tsx`; `src/app/api/account/profile/route.ts` | Name, phone, email with change detection |
| F-024 | Address validation endpoint | `src/app/api/addresses/validate/route.ts` | USPS validation stub: format checks only, real API not wired |
| F-025 | Email subscribe | `src/app/api/subscribe/route.ts`; `src/components/storefront/` | Public subscribe with new / already-subscribed / resubscribe handling; rate-limited |
| F-026 | Unsubscribe + email preferences via HMAC token | `src/app/(storefront)/unsubscribe/page.tsx`; `prisma/schema.prisma` (`EmailPreference`) | Three options: unsubscribe entirely, only-if-haven't-ordered, once-yearly; forged links rejected |

### Admin — daily operations

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-027 | Admin dashboard | `src/app/(admin)/admin/page.tsx` | Season stats, alert banners, quick links |
| F-028 | Today work queue | `src/app/(admin)/admin/today/page.tsx`; `src/features/today/server/workQueue.ts` | Counts + previews of everything needing action today (unpaid, pickups, routes) |
| F-029 | Orders list with search / filters | `src/app/(admin)/admin/orders/page.tsx` | Filter presets, status/payment dropdowns, pagination, CSV export button |
| F-030 | Admin order detail | `src/app/(admin)/admin/orders/[id]/page.tsx` | Customer, fulfillment groups, totals, payment summary, staff notes, follow-up controls, admin actions |
| F-031 | Printable packing slip | `src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx` | One section per recipient with items, options, add-ons, greeting |
| F-032 | Admin repeat order → POS draft | `src/app/(admin)/admin/orders/[id]/repeat/page.tsx` | Shared substitution review, then staff finish in POS builder |
| F-033 | Bulk repeat for one customer | `src/app/(admin)/admin/orders/repeat-bulk/page.tsx` | Tick several past orders, merge recipients, consolidate into one new draft |
| F-034 | Follow-up queue | `src/app/(admin)/admin/follow-up/page.tsx` | Unpaid invoices, overdue pickups, lapsed customers as phone-call cards with filter tabs |
| F-035 | POS order builder | `src/app/(admin)/admin/pos/page.tsx` | Full-viewport staff order entry; same builder shell as storefront; resume via `?draftId=` |
| F-036 | POS customer search / find-or-create | `src/app/api/customers/search/route.ts`; `src/app/api/customers/find-or-create/route.ts` | On-demand search (no full list shipped); find-or-create auto-subscribes email |
| F-037 | POS checkout | `src/app/(admin)/admin/pos/checkout/[orderId]/page.tsx` | Same CheckoutClient in "pos" mode; cash/check always available to staff regardless of store settings |
| F-038 | Payment operations (mark cash/check/comp, send link, charge card) | `src/config/permissions.ts` (`payments.*`); `src/features/payments/` | Comp is manager-level; payment links for remote collection |
| F-039 | Refunds | `src/features/refunds/`; `prisma/schema.prisma` (`Refund`, `RefundReason`, `RefundMethod`) | Manager-level; cash/check/card refund methods with reasons |
| F-040 | Unpaid-order escape hatches | `src/config/permissions.ts` (`orders.reserveUnpaid`, `orders.followUp`) | Manager can exempt an order from auto-cancel and extend follow-up snooze |

### Admin — catalog and inventory

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-041 | Customers list + add + CSV import | `src/app/(admin)/admin/customers/page.tsx` | Searchable, paginated; order count + total spent per customer |
| F-042 | Customer detail with duplicate detection | `src/app/(admin)/admin/customers/[id]/page.tsx` | Contact info, order history, saved addresses, new-order / delete / dedupe actions |
| F-043 | Products list with season switcher | `src/app/(admin)/admin/products/page.tsx` | Per-item units sold + revenue per season; past seasons read-only with banner |
| F-044 | Product create / edit | `src/app/(admin)/admin/products/new/page.tsx`; `src/app/(admin)/admin/products/[id]/edit/page.tsx` | Options, linked add-ons, image, dimensions/weight, inventory goal |
| F-045 | Product detail with replacement chain | `src/app/(admin)/admin/products/[id]/page.tsx`; `prisma/schema.prisma` (`ProductReplacement`) | Chain links this season's item to last year's for cross-year reporting; chain editable even on read-only past seasons |
| F-046 | Add-ons management + CSV import | `src/app/(admin)/admin/addons/page.tsx` | Price, restriction mode, kitchen flag, status, CRUD dialog |
| F-047 | Media library with needs-photos panel | `src/app/(admin)/admin/media/page.tsx`; `src/app/api/media/route.ts` | Upload to Vercel Blob (max 2MB), usage counts, quick-assign to imageless products |
| F-048 | Inventory and production dashboard | `src/app/(admin)/admin/inventory/page.tsx` | Goal / sold / need-to-produce cards; daily batches (deficit-sorted), receive-stock for purchased add-ons, batch history with undo; Production tab is managers+ |
| F-049 | Batch CSV import engine (stage/validate/commit) | `src/features/imports/server/batchEngine.ts`; `prisma/schema.prisma` (`ImportBatch`, `ImportBatchRow`) | Powers the customers / products / add-ons import buttons |

### Admin — fulfillment and delivery

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-050 | Fulfillment overview | `src/app/(admin)/admin/fulfillment/page.tsx` | Three channel cards (pickup, local delivery, shipment) with status counts |
| F-051 | Shippo shipping labels | `src/features/fulfillment/server/shipmentActions.ts`; `src/config/permissions.ts` (`fulfillment.printLabels`, `fulfillment.markShipped`, `fulfillment.cancelShipment`) | Print labels (clerk+), mark shipped (clerk+), cancel/void shipment (owner-level) |
| F-052 | Bin packing into boxes | `src/features/shipping/server/binPacking.ts`; `prisma/schema.prisma` (`ShipmentBox`, `PackageType`) | Items packed into typed boxes before rating/labeling |
| F-053 | Route builder with map | `src/app/(admin)/admin/fulfillment/build-route/page.tsx`; `src/app/api/route-builder/refresh-coords/route.ts` | Pick undelivered stops, assign messenger; Mapbox map with checklist fallback; geocode refresh is a placeholder |
| F-054 | Routes list | `src/app/(admin)/admin/routes/page.tsx` | Active and finished routes with messenger, stop count, scheduled date |
| F-055 | Route detail + Google Maps directions | `src/app/(admin)/admin/routes/[id]/page.tsx` | Ordered stops, messenger assignment, status actions, multi-stop directions link |
| F-056 | Printable delivery sheet | `src/app/(admin)/admin/routes/[id]/print/page.tsx` | Paper sheet for the driver: stops, phones, items, sign-off box |
| F-057 | Printable greeting cards per route | `src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx` | One card per line that has a greeting message |

### Admin — email and marketing

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-058 | Email hub (5 tabs) | `src/app/(admin)/admin/email/page.tsx` | Campaigns, subscribers, mailing lists, templates, triggered emails |
| F-059 | WYSIWYG block campaign builder | `src/app/(admin)/admin/email/campaign-builder.tsx`; `src/app/(admin)/admin/email/new/page.tsx`; `src/app/(admin)/admin/email/[id]/edit/page.tsx` | Block-based editor with variables; blocks stored as JSON, rendered to HTML on send |
| F-060 | Triggered (transactional) email overrides | `src/app/(admin)/admin/email/triggered/[key]/edit/page.tsx`; `src/features/email/server/triggeredEmailDefaults.ts` | Staff override subject/body per template key; reset-to-default supported |
| F-061 | Campaign send to mailing lists | `src/features/email/server/campaignSend.ts`; `prisma/schema.prisma` (`EmailCampaign`, `MailingList`) | Audience = mailing lists; manager-level send permission |
| F-062 | Automated order emails | `src/features/email/server/orderEmails.ts` | Order confirmations, payment reminders, refund notices with reason text |
| F-063 | Payment reminder escalation + auto-cancel | `src/app/api/cron/payment-reminders/route.ts` | Daily: reminder level 1 → 2 → auto-cancel; `autoCancelExempt` orders skipped |
| F-064 | Pickup expiry automation | `src/app/api/cron/pickup-expiry/route.ts` | Daily: reminders before deadline, auto-cancel past policy window |

### Admin — reports, exports, settings, staff

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-065 | Season reports (year-over-year) | `src/app/(admin)/admin/reports/page.tsx` | This year vs average of past years, year-by-year table, item-level sales across years via replacement chain; drill-downs for lapsed customers and winners/losers |
| F-066 | CSV exports with export history | `src/app/(admin)/admin/export/page.tsx`; `src/app/api/export/deliveries/route.ts`; `src/app/api/export/year-end/route.ts`; `src/app/api/export/year-metrics/route.ts`; `src/app/api/export/item-sales/route.ts`; `src/app/api/export/lapsed-customers/route.ts` | Deliveries, year-end accounting, year metrics, item sales, lapsed customers; history log of who downloaded what (`ExportLog`) |
| F-067 | Stripe reconciliation (report-only) | `src/app/(admin)/admin/reconciliation/page.tsx`; `src/app/api/cron/reconcile-stripe/route.ts` | Compares Stripe vs Payment/Refund rows, flags mismatches; never moves money; "Run now" + monthly cron |
| F-068 | Settings (orders / shipping / email / developer tabs) | `src/app/(admin)/admin/settings/page.tsx`; `prisma/schema.prisma` (`Setting`, `ShippingRule`, `PickupLocation`, `Season`) | Store open/closed, payment toggles, shipping rules + pickup locations, email config; Developer tab owner-only |
| F-069 | Staff user management | `src/app/(admin)/admin/users/page.tsx` | Pending-confirmation flow, role assignment (Owner/Manager/Staff/Driver), per-user permission overrides dialog |
| F-070 | Role-based access control (6 roles + overrides) | `src/config/permissions.ts`; `prisma/schema.prisma` (`PermissionOverride`) | developer/admin/manager/clerk/messenger/customer; linear rank with explicit allow-lists for driver carve-outs; per-user grant/deny overrides on a bounded permission set; server-enforced |
| F-071 | Staff impersonation (developer-only) | `src/app/(admin)/admin/impersonate/page.tsx`; `src/app/api/impersonate/route.ts` | Start/stop impersonation with audit logging and an impersonation bar |
| F-072 | Audit log | `src/app/(admin)/admin/audit-log/page.tsx`; `prisma/schema.prisma` (`AuditLog`) | Last 200 staff actions with Clerk-ID-to-name mapping, sort/filter |
| F-073 | Help center | `src/app/(admin)/admin/help/page.tsx` | Searchable/filterable staff help articles |
| F-074 | Guided tours (training aids) | `src/features/tours/tours.ts`; `src/features/tours/admin-tour.tsx` | driver.js tours; aimed at elderly staff on the test deployment |
| F-075 | Test-mode tools | `src/app/(admin)/admin/test-mode/page.tsx`; `src/app/api/admin/seed-test-season/route.ts`; `src/app/api/admin/wipe-test-data/route.ts`; `src/app/api/admin/reset-test-db/route.ts` | Seed demo orders, wipe/reset test data, captured-email viewer; `IS_TEST_ENV` + developer gated |
| F-076 | Test/prod environment switch | `src/app/(admin)/admin/env-switch/route.ts`; `README.md` (sister URL flow) | One-click "Switch to Test / Back to Live"; same Clerk login on both deployments |
| F-077 | First-run setup bootstrap | `src/app/(storefront)/setup/page.tsx`; `src/app/api/setup/route.ts` | Creates the first developer account; only works while no StaffUser rows exist |

### Messenger (driver app)

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-078 | Messenger route list | `src/app/(messenger)/messenger/page.tsx` | Assigned + in-progress routes with progress bars, "Finished today"; managers see all routes |
| F-079 | Messenger stop execution | `src/app/(messenger)/messenger/routes/[id]/page.tsx` | Ordered stop cards, tap-to-call, tap-to-map, items + greetings, office notes, big Delivered button; drivers see only their own routes |

## Blocked / notes

- No blocked areas. Two stubs found (still inventoried as features since the screens/endpoints exist): USPS address validation (`F-024`) and geocode refresh (`F-053`) are placeholder implementations.
- Out of scope for this slice (other specialists' jobs): data-migration scripts (`scripts/nexternal/`), outbox/event plumbing, rate limiting internals, health/client-error endpoints, testing infra.
