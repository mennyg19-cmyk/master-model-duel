# Test 1a inventory grade — arm-06 (late join)

**Arm:** `arm-06` (blind; late join)
**Arm inventory:** `arms/arm-06/results/CODEBASE-INVENTORY.md` (171 merged features; 4 CONFLICT tagged)
**Reconciled denominator:** `shared/RECONCILED-INVENTORY.md` (192 IDs)
**Rubric:** `kit/rubrics/inventory-1a.md`
**Source verified against:** `.scratch/sources/tomche-shabbos-website` (read-only)

## Scoring summary

covered=190
total_reconciled=192
coverage_pct=98.96%

| Dimension | Score | Max |
|---|---:|---:|
| Recall | 4 | 4 |
| Precision | 3 | 3 |
| **Total 1a** | **7** | **7** |

## Recall — 4/4

190 of 192 reconciled IDs are covered by at least one `F-###` row in arm-06's inventory with a real evidence path. The arm's 171 merged features (union of five specialist partials: product 79, security 28, data 40, ui 112, integrations 26 → 285 input rows) subsume the reconciled set except for two order-lifecycle misses. Section-by-section coverage:

| Reconciled section | IDs | Covered | Notes |
|---|---:|---:|---|
| Storefront — browsing & marketing | 18 | 18 | R-001..R-018 → F-001..F-006, F-040, F-041, F-103, F-153, F-157, F-158, F-159 |
| Storefront — order builder | 13 | 13 | R-019..R-031 → F-008..F-019, F-021, F-111, F-163 |
| Checkout & payments | 6 | 6 | R-032..R-037 → F-022..F-030, F-131 |
| Customer account | 6 | 6 | R-038..R-043 → F-032..F-038 |
| Order lifecycle | 5 | 3 | R-045, R-047, R-048 → F-025, F-130, F-061. **R-044 MISS** (no row cites `orderStateMachine.ts`/`transitionOrder.ts`); **R-046 MISS** (no row cites `discardDraft.ts`) |
| Admin — operations hub | 16 | 16 | R-049..R-064 → F-042..F-058, F-066 |
| Admin — catalog & inventory | 7 | 7 | R-065..R-071 → F-059..F-066, F-138, F-139, F-140 |
| Admin — fulfillment & delivery | 10 | 10 | R-072..R-081 → F-067..F-074, F-105, F-149 |
| Admin — email & marketing | 9 | 9 | R-082..R-090 → F-075..F-085, F-134 |
| Admin — reporting, money & exports | 3 | 3 | R-091..R-093 → F-086..F-088 |
| Admin — configuration & staff tooling | 13 | 13 | R-094..R-106 → F-089..F-103, F-154..F-156, F-160..F-162, F-168..F-171 |
| Auth, permissions & security controls | 30 | 30 | R-107..R-136 → F-106..F-122, F-131 |
| Data model & data infrastructure | 29 | 29 | R-137..R-165 → F-123..F-150 |
| Integrations & platform | 22 | 22 | R-166..R-187 → F-025..F-028, F-068, F-118, F-133, F-134, F-145, F-149, F-163 |
| Design system / app-wide UI | 5 | 5 | R-188..R-192 → F-151, F-152, F-153, F-167, F-144 |

Peer-unique rows were not filtered out. R-010 (UNIQUE-TO-arm-02 first-run setup) is covered by F-103; R-114 (UNIQUE-TO-arm-01 customer identity linking) is covered by F-032; R-184 (UNIQUE-TO-arm-02 UPS credentials declared) is covered by F-039 (USPS_USER_ID and UPS_* env keys reserved); all UNIQUE-TO-arm-02 data-schema rows (R-144..R-165) are covered by the data slice's F-123..F-150.

## Precision — 3/3

Spot-check verification of distinctive evidence paths against `.scratch/sources/tomche-shabbos-website` — all resolved to real files:

| Path (arm-06 claim) | Verified |
|---|---|
| `src/features/order-builder/orderDraftContext.tsx`, `orderDraftReducer.ts`, `orderDraftSelectors.ts` | ✓ exist |
| `src/features/order-builder/components/{AutoSave,ClearGuestDraftOnSuccess,ProductPanel,ProductCard,ProductQuickView,RecipientAssignDialog,AddRecipientDialog,EditSavedAddressDialog,OrderSidebar,MobileCartFab,OrderBuilderShell}.tsx` | ✓ all exist |
| `src/features/checkout/server/{checkoutToken,checkoutValidation,pricing}.ts`, `src/features/checkout/components/CheckoutClient.tsx` | ✓ exist |
| `src/features/shipping/server/{ruleEngine,rateResolution,shipmentPlanning,binPacking,geocode,geocodeRefresh}.ts` | ✓ exist |
| `src/features/inventory/server/{reserve,allocate,release,writeoff,shortfall,dashboard,production,actions}.ts` | ✓ exist |
| `src/features/fulfillment/server/{fulfillmentPool,fulfillmentActions,shipmentActions,routeActions,markDelivered}.ts` | ✓ exist |
| `src/features/email/server/{dispatchEmail,htmlEscape,marketingActions,orderEmails,orderSummaryHtml,templateActions,templateRender,triggeredEmailDefaults,unsubscribeToken,upsertSubscriber,campaignSend}.ts` | ✓ exist |
| `src/features/auth/server/{audit,customer,ensureCustomer,impersonation,requirePermission,resolveUser,staff}.ts`, `src/features/auth/nav.ts` | ✓ exist |
| `src/features/refunds/server/createRefund.ts`, `src/features/reconciliation/server/{runReconciliation,matcher}.ts`, `src/features/payments/server/{webhookIdempotency,recalcOrderPayment,paymentMath}.ts` | ✓ exist |
| `src/features/testdata/server/{testModeActions,seedTestSeason,wipeTestData}.ts`, `src/features/tours/{tours.ts,admin-tour.tsx,run-driver.ts}` | ✓ exist |
| `src/features/imports/server/{actions,batchEngine}.ts`, `src/features/exports/server/exportResponse.ts`, `src/features/products/server/{productActions,addOnActions,seasonSales}.ts` | ✓ exist |
| `scripts/{check-schema-has-migration.mjs,gen-env-example.ts,link-old-product-images.ts,reset-test-db.ts,seed-test-season.ts,test-migration.mjs}` | ✓ exist |
| `scripts/nexternal/{shared/excel.ts,shared/runWithTestDb.ts,customers/importCustomers.ts,products/importProducts.ts,historical/importHistorical.ts,fix-order-numbers.ts}` | ✓ exist |
| All 5 `src/app/api/cron/*/route.ts` files (outbox-sweep, payment-reminders, pickup-expiry, purge-email-log, reconcile-stripe) | ✓ exist |
| All `src/app/api/**/route.ts` files cited (checkout, checkout/offline, webhooks/stripe, subscribe, unsubscribe, addresses/validate, customers/search, customers/find-or-create, media, media/[id], impersonate, health, client-error, account/profile, export/{deliveries,year-end,year-metrics,item-sales,lapsed-customers}, route-builder/refresh-coords, admin/{reset-test-db,wipe-test-data,seed-test-season}, setup) | ✓ exist |
| All `src/app/(admin)/admin/**` page/component paths cited (orders/[id]/*, pos/checkout/[orderId], customers/[id]/*, products/[id]/*, routes/[id]/*, email/[id]/edit, email/triggered/[key]/edit, settings/*, users/*, impersonate/*, audit-log/*, test-mode/*, help/*, env-switch) | ✓ exist (bracketed paths verified with -LiteralPath) |
| `src/app/(messenger)/messenger/routes/[id]/{page,start-route-button,deliver-button}.tsx`, `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | ✓ exist |
| `src/lib/{brand,csv,money/index,normalize/index,phone/index,ids/index,season/index,dates/index,result/index,logging/index}.ts`, `src/config/{permissions,env,env-schema,settings}.ts`, `src/server/{db,outbox,verifyCronSecret,withPublicGuard}.ts` | ✓ exist |
| `src/components/{storefront,ordering,admin,ui}/*` cited (email-subscribe, mobile-menu, user-menu, test-mode-banner, product-quick-view, address-autocomplete, address-fields, repeat-review, media-picker, csv-import-dialog, visit-store-link, alert-banner, back-link, impersonation-bar, pagination, page-size-selector, remember-list-url, status-badges, list-search, mobile-nav, sidebar-config, admin-sidebar, sortable-table, responsive-table, tabs, button, dialog, pill-input, fab, info-hint, page-header, price-tag, smart-select, callout, empty-state, confirm-dialog) | ✓ exist |
| `DATA-MIGRATION-INVENTORY.md`, `MIGRATION-PLAN.md`, `lighthouserc.json`, `components.json`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `.github/workflows/{agent-guardrails,ci}.yml`, `vercel.json`, `next.config.ts` | ✓ exist |
| `public/images/{hero.png,mission-shabbos-table.jpg,mission-volunteers.jpg}`, `src/styles/tokens.css`, `src/app/globals.css` | ✓ exist |

No fabricated paths detected. No invented features. The arm explicitly tags 4 feature-level conflicts (F-032 vs F-153 Customer auto-create; F-070 vs F-149 geocode refresh; F-079 campaign audience; F-096 staff role naming) and 5 known stubs/placeholders (USPS validation format-only, UPS/USPS env keys reserved, route-builder refresh-coords placeholder, New Season wizard shell, Nexternal file-export with no live API) as unresolved rather than inventing resolutions — disciplined behavior that protects precision.

**Junk list:** none.

## bonus_inventory_novel

Real features present in source with verified evidence paths, absent from `shared/RECONCILED-INVENTORY.md`. Count: 4.

| # | arm-06 row | Name | Evidence path(s) | Verified |
|---|---|---|---|---|
| B-01 | F-142 | next/image remote-pattern allowlist for the Vercel Blob host (enables next/image optimization of media uploads) | `next.config.ts` | ✓ exists (R-180 cites next.config.ts for Blob storage but does not call out the next/image allowlist as a distinct feature) |
| B-02 | F-143 | One-off legacy product-image backfill script linking old images into Vercel Blob / MediaUpload | `scripts/link-old-product-images.ts` | ✓ exists (no reconciled row cites this script) |
| B-03 | F-146 | Test-database runner that swaps DATABASE_URL from `.env.test-branch` so Nexternal imports dry-run against a test branch (password masked in logs) | `scripts/nexternal/shared/runWithTestDb.ts`, `scripts/reset-test-db.ts` | ✓ both exist (R-101 cites `scripts/reset-test-db.ts` for the test-mode console, but `runWithTestDb.ts` and the import-pipeline test-runner mechanism are not in the reconciled file) |
| B-04 | F-150 | Next.js `revalidatePath` calls after server-action mutations across ~15 action modules (no use cache / Redis — DB tables are the cache layer) | `src/features/products/server/productActions.ts`, `src/features/fulfillment/server/routeActions.ts`, `src/features/fulfillment/server/shipmentActions.ts`, `src/features/imports/server/actions.ts`, `src/features/settings/server/actions.ts` (+10 more) | ✓ all cited paths exist; no reconciled row mentions revalidatePath or path revalidation |

These are genuine source features with real evidence, not present in the reconciled union of arm-01 + arm-02. The reconciled file was not edited.

## Notes

- arm-06 is a late-join arm with five specialist partials (product/security/data/ui/integrations); its 171 merged features collapse 285 source rows by meaning + evidence, with the finest granularity any partial used.
- Two recall misses are narrow and both in the Order lifecycle section: R-044 (order state machine — `orderStateMachine.ts`/`transitionOrder.ts` not cited by any F-row) and R-046 (draft discard — `discardDraft.ts` not cited). Finalization (R-045) and draft reference numbers (R-047) are covered by F-025/F-130; the gap is the transition engine and the discard path specifically.
- The arm's merge notes explicitly state the merge agent did not re-access the source tree (read-only boundary after Test 1a); the file is a pure union of the 5 partials. The 4 tagged conflicts and 5 stubs are surfaced rather than resolved — a precision-preserving choice, not a coverage gap.
- arm-06 found 4 novel features absent from the reconciled file (F-142, F-143, F-146, F-150). It did not surface several features that arm-04 reported as novel (integration test harness `itDatabase.ts`/`integrationGlobalSetup.ts`, structured JSON logging `logging/index.ts`, CSV formula-injection neutralization `csv.ts:neutralizeFormula`, per-season sales aggregates `seasonSales.ts`, order/customer integration tests) — those remain arm-04-only finds.
- No model names appear in this grade; arm ids only.
