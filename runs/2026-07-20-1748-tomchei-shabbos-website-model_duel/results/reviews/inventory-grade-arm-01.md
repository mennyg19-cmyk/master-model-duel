# Test 1a — Codebase inventory grade (RE-GRADE, corrected rubric)

Arm: arm-01 (blind)
Source: `.scratch/sources/tomche-shabbos-website`
Baseline: `shared/RECONCILED-INVENTORY.md` (192 rows, R-001..R-192)
Arm inventory: `arms/arm-01/results/CODEBASE-INVENTORY.md` (173 features)

## Grading rule applied
Recall denominator = ALL 192 reconciled IDs. UNIQUE-TO-arm-01 / UNIQUE-TO-arm-02 tags are attribution only and do NOT exclude rows from recall. A coarser arm-01 row that covers the same behavior+evidence as a reconciled row counts as covered (mapping noted). A reconciled row with no arm-01 equivalent counts as missed. Precision = junk/unevidenced IDs in arm-01 inventory vs the source tree.

## Scores

| Dimension | Score | Notes |
|---|---|---|
| Recall (0-4) | 2 | 144 / 192 = 74.5% covered |
| Precision (0-3) | 3 | 0 junk IDs; every arm-01 evidence path resolves to a real file |
| **Total** | **5 / 7** | grill on |

## Coverage summary

Covered: 144 / 192 (74.5%).
Missed: 48 / 192.

arm-01 covered all 136 SHARED rows plus 1 of its own UNIQUE rows (R-114) and 3 partial-coverage UNIQUE-arm-02 rows (R-010, R-096, R-134). It missed 47 of the 52 UNIQUE-TO-arm-02 rows plus 1 partial (R-096 counted covered but its developer-tab half is absent).

## Missed IDs (by section)

Storefront — browsing & marketing
- R-014 Test-mode banner on storefront (`src/components/storefront/test-mode-banner.tsx`) — no arm-01 row.

Storefront — order builder
- R-025 Address autocomplete + server-side validation (`address-autocomplete.tsx`, `address-fields.tsx`, `api/addresses/validate`) — no arm-01 row.

Checkout & payments
- R-036 Payment recalculation on order changes (`recalcOrderPayment.ts`, `paymentMath.ts`) — no arm-01 row.

Order lifecycle
- R-044 Order status state machine + transitions (`orderStateMachine.ts`, `transitionOrder.ts`)
- R-045 Order finalization — draft to placed, claims number (`finalizeOrder.ts`)
- R-046 Draft discard (`discardDraft.ts`)
- R-047 Draft reference numbers + wire format (`draftWire.ts`, `20260611000000_draft_numbers`)

Admin — operations hub
- R-054 Refunds incl. Stripe refund path (`src/features/refunds/server/createRefund.ts`) — arm-01 F-030 covers manual refunds via `adminPayments.ts` but not the dedicated Stripe refund module; reconciler assigned F-030 to R-053 only.

Admin — catalog & inventory
- R-071 Stock reserve/allocate/release engine (`reserve.ts`, `allocate.ts`, `release.ts`) — arm-01 F-008 cites `catalog.ts` only.

Admin — fulfillment & delivery
- R-081 Shipment planning + bin packing (`binPacking.ts`, `shipmentPlanning.ts`) — arm-01 F-013/F-031 cite rate/shipping modules but not these.

Admin — email & marketing
- R-087 Order lifecycle emails — confirmation/payment link/refund (`orderEmails.ts`, `orderSummaryHtml.ts`) — arm-01 F-062 covers triggered-template config, not the order email senders.

Admin — configuration & staff tooling
- R-104 Admin shell + permission-gated sidebar + mobile nav (`admin-shell.tsx`, `admin-sidebar.tsx`, `sidebar-config.ts`, `mobile-nav.tsx`)
- R-105 Shared admin list controls — search/pagination/sort/badges (`list-search.tsx`, `pagination.tsx`, `page-size-selector.tsx`, `remember-list-url.tsx`, `sortable-table.tsx`, `responsive-table.tsx`, `status-badges.tsx`)
- R-106 Admin chrome links — visit-store, alert banner, back link (`visit-store-link.tsx`, `alert-banner.tsx`, `back-link.tsx`)

Auth, permissions & security
- R-117 "Must be staff" hard guard + storefront staff check (`src/features/auth/server/staff.ts`)
- R-118 canDrive carve-out for driver-route permissions (`permissions.ts`, `requirePermission.ts`)
- R-135 Permission unit tests (`permissions.test.ts`, `requirePermission.test.ts`)
- R-136 Production error masking for server actions (`src/lib/result/index.ts`)

Data model & data infrastructure (arm-01 produced 7 coarse DATA rows; missed 22 arm-02 schema-detail rows)
- R-144 Customer records (normalized phone/email + dedupe)
- R-145 Saved addresses with geocoding fields
- R-146 Season model gating catalog per year
- R-147 Product catalog schema (dims, inventory flags, kinds)
- R-148 Product options with price adjustments
- R-149 Normalized order tree (Order to OrderLine to add-ons)
- R-150 Price snapshots on order lines
- R-151 Sequential order numbers per season
- R-152 Cached derived payment status on orders
- R-153 Fulfillment groups (multi-destination) + snapshots
- R-154 Data-driven fulfillment methods
- R-155 Shipping quotes with selectable expiring options
- R-156 Pickup locations
- R-157 Package types + shipment boxes
- R-158 Unified inventory (products + add-ons, versioned)
- R-159 Stripe PaymentIntent modeling
- R-160 Payments (stripe/cash/check/comp) with posted/voided states
- R-161 Key-value settings store with typed registry
- R-162 Geocode cache with success/failure TTLs
- R-163 Cron/job run log
- R-164 Data-layer helper libraries (money/normalize/phone/ids/season/dates/result)
- R-165 Legacy-to-new data migration plan (`DATA-MIGRATION-INVENTORY.md`; flagged doc-only)

Integrations & platform
- R-170 Shared Stripe server client — lazy singleton (`src/integrations/stripe.ts`)
- R-171 Resend email sender — SDK isolated (`src/integrations/resend.ts`)
- R-184 UPS direct credentials declared, not implemented (`.env.example`, `env-schema.ts`)
- R-185 Vercel Cron jobs (5) with secret auth (`vercel.json`, `verifyCronSecret.ts`)
- R-187 Health check — DB + env validation (`src/app/api/health/route.ts`)

Design system / app-wide UI (all 5 missed)
- R-188 shadcn-style UI kit (`button.tsx`, `dialog.tsx`, `tabs.tsx`, `components.json`)
- R-189 Custom UI primitives (confirm/empty/FAB/info-hint/page-header/pill/price-tag/smart-select/callout)
- R-190 Design tokens + global styles + brand constants (`tokens.css`, `globals.css`, `brand.ts`)
- R-191 Global error page + root layout — client error reporting (`error.tsx`, `layout.tsx`, `api/client-error`)
- R-192 Marketing imagery assets (`public/images/hero.png`, mission images)

## Partial-coverage rows counted as covered (mapping)

- R-010 First-run setup page + empty-staff bootstrap: arm-01 SEC-022 covers the API half (`src/app/api/setup/route.ts`, bootstrap lockout). The setup page UI (`src/app/(storefront)/setup/page.tsx`) is not inventoried; counted covered on the bootstrap-lockout behavior.
- R-096 Settings Email + Developer tabs: arm-01 F-067 covers the email-tab half; the developer-tab half is not inventoried. Counted covered on the email-tab behavior.
- R-134 Guarded staff-only API routes (media/exports/route-builder): arm-01 SEC-020 covers media and F-069 covers export routes; the route-builder/refresh-coords guard is not inventoried. Counted covered on 2 of 3 evidence paths.

## Junk list (precision)

None. All 173 arm-01 feature IDs cite evidence paths that resolve to real files in the source tree. Spot-checked all bracketed dynamic-route paths (`[id]`, `[[...sign-in]]`) with `Test-Path -LiteralPath` — all present. No fabricated paths, no invented features. arm-01's only structural weakness is granularity (coarse DATA rows, no design-system rows), not fabrication.

## Rationale

arm-01 is a strong product-behavior inventory: it covers every SHARED row (136/136) and surfaces storefront, admin operations, fulfillment, email marketing, security, and integrations with accurate, file-backed evidence. Its precision is perfect — zero hallucinated paths.

It loses recall on two fronts, both structural rather than careless:
1. Data-model granularity — arm-01 rolled the Prisma schema into 7 coarse DATA rows, while arm-02 split it into 26 typed rows. The reconciler kept arm-02's splits as UNIQUE-TO-arm-02 (R-144..R-163), so arm-01 misses 20 schema-detail rows outright. This is the single largest block of misses.
2. Design-system / app-wide UI — arm-01 produced no rows for the UI kit, design tokens, global error page, or marketing imagery (R-188..R-192), and no rows for the admin shell/sidebar/shared list controls (R-104..R-106).

Smaller misses are scattered genuinely arm-02-only behaviors arm-01 had no equivalent for: order state machine / finalization / discard / draft wire format (R-044..R-047), payment recalculation (R-036), reserve/allocate/release engine (R-071), bin packing (R-081), order lifecycle emails (R-087), Stripe refund path (R-054), Resend + shared Stripe client (R-170, R-171), health check (R-187), Vercel cron (R-185), permission tests + error masking (R-135, R-136), canDrive carve-out + must-be-staff guard (R-117, R-118), test-mode banner (R-014), address autocomplete (R-025).

74.5% recall sits just under the 75% threshold for a 3, so Recall = 2. Precision = 3 (0 junk). Total = 5 / 7.
