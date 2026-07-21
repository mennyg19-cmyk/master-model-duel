# Codebase inventory — arm-03 (product)

## Proof-of-read
- Rules files read: 5 (ponytail, clean-code, workflow, vocabulary, codegraph)
- Top-level dirs sampled: `src/app/(storefront)`, `src/app/(admin)`, `src/app/(messenger)`, `src/app/(auth)`, `src/app/api`, `src/features`, `src/config`, `src/components/storefront`, `README.md`

## Features
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | Storefront home / marketing | `src/app/(storefront)/page.tsx` | Hero, impact stats, how-it-works, season packages grid, mission, testimonials, order CTAs |
| F-002 | Season package catalog browse | `src/app/(storefront)/packages/page.tsx` | Public list of this season’s packages |
| F-003 | Package detail | `src/app/(storefront)/packages/[id]/page.tsx` | Single package view with path into order builder |
| F-004 | Past collections archive | `src/app/(storefront)/past-collections/page.tsx` | Read-only prior-year catalogs; hides items still in current season |
| F-005 | Season open/close gate | `src/features/storefront/server/storeStatus.ts`, `src/app/(storefront)/order/page.tsx` | `ordersOpen` from season; closed store still allows browse, blocks order builder/checkout |
| F-006 | Multi-recipient order builder (web) | `src/app/(storefront)/order/page.tsx`, `src/features/order-builder/components/OrderBuilderShell.tsx` | Products + add-ons + recipients; closed-store message when ordering shut |
| F-007 | Per-line recipient assignment | `src/features/order-builder/components/RecipientAssignDialog.tsx`, `src/features/orders/server/saveDraft.ts` | Items can go to different recipients/addresses; drafts map modes → fulfillment method keys |
| F-008 | Customer address book in builder | `src/features/customers/server/savedAddresses.ts`, `src/features/order-builder/components/AddRecipientDialog.tsx` | Saved addresses + add/edit dialogs for shoppers |
| F-009 | Draft autosave / resume | `src/features/order-builder/components/AutoSave.tsx`, `src/features/orders/server/loadDraft.ts` | Resume via `?draft=` or latest web draft for signed-in customer |
| F-010 | Checkout (card + optional cash/check) | `src/app/(storefront)/checkout/page.tsx`, `src/features/checkout/components/CheckoutClient.tsx` | Draft ownership/token gate; card always; cash/check only if settings enabled |
| F-011 | Offline cash/check payment API | `src/app/api/checkout/offline/route.ts` | Public finalize + record check/cash for enabled methods |
| F-012 | Per-recipient shipping quotes | `src/features/checkout/server/shipping.ts`, `src/features/checkout/shippingRates.ts` | Pickup / local delivery / carrier options priced server-side per recipient |
| F-013 | Delivery method resolution + ZIP rules | `src/features/shipping/server/rateResolution.ts`, `src/config/settings.ts` | Pickup, local delivery, Purim local delivery (ZIP-gated), carrier flat/calculated |
| F-014 | Shipping rules + carrier fallback | `src/features/shipping/server/ruleEngine.ts` | Admin rules by subtotal; optional Shippo carrier fallback when no rule matches |
| F-015 | Checkout success | `src/app/(storefront)/checkout/success/page.tsx` | Post-checkout confirmation screen |
| F-016 | Account orders list | `src/app/(storefront)/account/orders/page.tsx`, `src/app/(storefront)/account/page.tsx` | Account index redirects to orders |
| F-017 | Account order detail | `src/app/(storefront)/account/orders/[id]/page.tsx` | Customer view of one order |
| F-018 | Customer repeat-order review | `src/app/(storefront)/account/orders/[id]/repeat/page.tsx`, `src/features/orders/server/repeat/repeatOrder.ts` | Preview substitutions then confirm into a new draft |
| F-019 | Product replacement chain (repeat) | `src/features/orders/server/repeat/replacementChain.ts`, `src/features/orders/server/repeat/matcher.ts` | Walks `replacesProductId` across seasons for repeat mapping |
| F-020 | Account profile | `src/app/(storefront)/account/profile/page.tsx`, `src/app/api/account/profile` | Customer profile management |
| F-021 | Account saved addresses | `src/app/(storefront)/account/addresses/page.tsx` | Address-book screen outside the builder |
| F-022 | Email subscribe (footer) | `src/components/storefront/email-subscribe.tsx`, `src/app/api/subscribe` | Marketing list opt-in with toast feedback |
| F-023 | Unsubscribe / email preferences | `src/app/(storefront)/unsubscribe/page.tsx`, `src/features/email/server/unsubscribeToken.ts` | Token-verified preferences (full off / conditional / yearly) |
| F-024 | Sign-in / sign-up | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Clerk-hosted auth routes |
| F-025 | First-run owner setup | `src/app/(storefront)/setup/page.tsx`, `src/app/api/setup` | Bootstrap first developer StaffUser when none exist |
| F-026 | Role & permission model | `src/config/permissions.ts`, `src/features/auth/server/requirePermission.ts` | Six roles; permission map; overrides; server is real gate |
| F-027 | Permission-aware admin nav | `src/features/auth/nav.ts`, `src/app/(admin)/admin/layout.tsx` | Sidebar filtered by role/overrides; staff-only; messengers bounce to `/messenger` |
| F-028 | Pending staff confirmation | `src/app/(admin)/admin/layout.tsx` | Unconfirmed staff see waiting screen, not dashboard |
| F-029 | Admin dashboard | `src/app/(admin)/admin/page.tsx` | High-level stats landing |
| F-030 | Today work queue | `src/app/(admin)/admin/today/page.tsx`, `src/features/today/server/workQueue.ts` | Permission-gated cards: drafts, pickups, labels, deliveries, routes, production, follow-ups, alerts |
| F-031 | Orders list & detail | `src/app/(admin)/admin/orders/page.tsx`, `src/app/(admin)/admin/orders/[id]/page.tsx` | Staff order management; money actions on detail |
| F-032 | POS take-order | `src/app/(admin)/admin/pos/page.tsx` | Staff full-viewport builder; `orders.create`; customer search on demand |
| F-033 | POS / admin checkout for an order | `src/app/(admin)/admin/pos/checkout/[orderId]/page.tsx` | Staff checkout path for a built order |
| F-034 | Staff payments (cash/check/comp/card/link/refund) | `src/config/permissions.ts`, `src/app/(admin)/admin/orders/[id]/order-money-actions.tsx`, `src/features/orders/server/adminPayments.ts` | Permission-gated offline/comp/refund/charge flows on order detail |
| F-035 | Follow-up calls queue | `src/app/(admin)/admin/follow-up/page.tsx` | Unpaid / reminder work; `orders.followUp` |
| F-036 | Customers list & detail | `src/app/(admin)/admin/customers/page.tsx`, `src/app/(admin)/admin/customers/[id]/page.tsx` | Search/manage customers; `customers.view` |
| F-037 | Staff bulk repeat orders | `src/app/(admin)/admin/orders/repeat-bulk/page.tsx` | Multi-order merge into one draft with shared review screen |
| F-038 | Single-order staff repeat | `src/app/(admin)/admin/orders/[id]/repeat/page.tsx` | Staff repeat from one order |
| F-039 | Printable packing slip | `src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx` | Per-recipient pack list; print UI does not itself mark shipped |
| F-040 | Email campaigns | `src/app/(admin)/admin/email/page.tsx`, `src/app/(admin)/admin/email/new/page.tsx`, `src/app/(admin)/admin/email/[id]/edit/page.tsx` | Campaign list/create/edit; `email.viewCampaigns` / send |
| F-041 | Triggered email templates | `src/app/(admin)/admin/email/triggered/[key]/edit/page.tsx`, `src/features/email/server/triggeredEmailDefaults.ts` | Edit transactional/triggered templates |
| F-042 | Product catalog admin | `src/app/(admin)/admin/products/page.tsx`, `src/app/(admin)/admin/products/new/page.tsx`, `src/app/(admin)/admin/products/[id]/edit/page.tsx` | Create/edit season products; `products.edit` |
| F-043 | Add-ons admin | `src/app/(admin)/admin/addons/page.tsx`, `src/features/products/server/addOnActions.ts` | Upsells (cards, extras, donations) |
| F-044 | Media library | `src/app/(admin)/admin/media/page.tsx`, `src/app/api/media/[id]` | Product image uploads/assignment |
| F-045 | Inventory overview & production | `src/app/(admin)/admin/inventory/page.tsx`, `src/features/inventory/server/dashboard.ts`, `src/features/inventory/server/production.ts` | Goals/sold/shortfall; manager production batches & write-offs |
| F-046 | Packing & labels fulfillment hub | `src/app/(admin)/admin/fulfillment/page.tsx`, `src/features/fulfillment/server/fulfillmentPool.ts` | Pickup / delivery / shipment channels; print vs mark-shipped actions |
| F-047 | Buy carrier label (cheapest) + savings | `src/features/fulfillment/server/shipmentActions.ts`, `src/features/shipping/server/shipmentPlanning.ts` | Rate-shop via Shippo; buy cheapest; record savings vs customer charge |
| F-048 | Mark channel fulfilled (manual) | `src/features/fulfillment/server/fulfillmentActions.ts` | Separate `fulfillment.markShipped` from print-labels permission |
| F-049 | Build delivery route (map) | `src/app/(admin)/admin/fulfillment/build-route/page.tsx`, `src/app/(admin)/admin/fulfillment/build-route/route-builder.tsx` | Select pending local-delivery stops; Mapbox when configured; `routes.manage` |
| F-050 | Active routes manage | `src/app/(admin)/admin/routes/page.tsx`, `src/app/(admin)/admin/routes/[id]/page.tsx` | Assign messengers, track route status |
| F-051 | Route print sheet | `src/app/(admin)/admin/routes/[id]/print/page.tsx` | Paper delivery sheet for driver |
| F-052 | Route greeting cards print | `src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx` | Print greeting cards for route stops |
| F-053 | Messenger driver home | `src/app/(messenger)/messenger/page.tsx` | Own routes (managers see all); phone-first |
| F-054 | Messenger route stop completion | `src/app/(messenger)/messenger/routes/[id]/page.tsx`, `src/config/permissions.ts` | `routes.viewOwn` / `routes.completeStop` (+ canDrive carve-out) |
| F-055 | Settings (season, shipping, payments, follow-up) | `src/app/(admin)/admin/settings/page.tsx`, `src/config/settings.ts` | Open/close season, fees, ZIP lists, cash/check toggles, unpaid policies, new-season wizard |
| F-056 | Staff accounts & role assignment | `src/app/(admin)/admin/users/page.tsx`, `src/features/users/server/actions.ts` | Assign Owner/Manager/Staff/Driver; permission overrides UI groups |
| F-057 | Impersonation | `src/app/(admin)/admin/impersonate/page.tsx`, `src/features/auth/server/impersonation.ts` | Developer-only see-as-another-role |
| F-058 | Season reports | `src/app/(admin)/admin/reports/page.tsx`, `src/features/reports/server/seasonReports.ts` | YoY metrics, item movers via replacement chain, lapsed customers |
| F-059 | CSV exports | `src/app/(admin)/admin/export/page.tsx`, `src/app/api/export/*` | Deliveries, year-end, metrics, item sales, lapsed; `export.csv` |
| F-060 | Stripe reconciliation screen | `src/app/(admin)/admin/reconciliation/page.tsx`, `src/features/reconciliation/server/runReconciliation.ts` | Report-only Stripe vs local payment mismatches |
| F-061 | Audit / activity log | `src/app/(admin)/admin/audit-log/page.tsx`, `src/features/auth/server/audit.ts` | Staff action history (developer settings gate in nav) |
| F-062 | Test-mode sandbox controls | `src/app/(admin)/admin/test-mode/page.tsx`, `src/app/api/admin/reset-test-db` | Test-env only tools (nav `testOnly`) |
| F-063 | Admin help center | `src/app/(admin)/admin/help/page.tsx` | Searchable how-to guides for staff |
| F-064 | Admin guided tours | `src/features/tours/admin-tour.tsx`, `src/features/tours/tours.ts` | In-app tour content for staff onboarding |
