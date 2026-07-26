# Test 1a inventory grade — arm-04 (late join)

**Arm:** `arm-04` (blind; late join)
**Arm inventory:** `arms/arm-04/results/CODEBASE-INVENTORY.md` (295 merged features; 8 CONFLICT tagged)
**Reconciled denominator:** `shared/RECONCILED-INVENTORY.md` (192 IDs)
**Rubric:** `kit/rubrics/inventory-1a.md`
**Source verified against:** `.scratch/sources/tomche-shabbos-website` (read-only)

## Scoring summary

covered=192
total_reconciled=192
coverage_pct=100%

| Dimension | Score | Max |
|---|---:|---:|
| Recall | 4 | 4 |
| Precision | 3 | 3 |
| **Total 1a** | **7** | **7** |

## Recall — 4/4

Every one of the 192 reconciled IDs is covered by at least one `MF-###` row in arm-04's inventory with a real evidence path. The arm's 295 merged features (union of five specialist partials: product 121, security 81, data 60, ui 112, integrations 77) subsume the entire reconciled set. Section-by-section coverage:

| Reconciled section | IDs | Covered | Notes |
|---|---:|---:|---|
| Storefront — browsing & marketing | 18 | 18 | R-001..R-018 → MF-094..MF-109, MF-026 |
| Storefront — order builder | 13 | 13 | R-019..R-031 → MF-116..MF-132 |
| Checkout & payments | 6 | 6 | R-032..R-037 → MF-147..MF-167 |
| Customer account | 6 | 6 | R-038..R-043 → MF-084..MF-115 |
| Order lifecycle | 5 | 5 | R-044..R-048 → MF-129..MF-178 |
| Admin — operations hub | 16 | 16 | R-049..R-064 → MF-062..MF-197 |
| Admin — catalog & inventory | 7 | 7 | R-065..R-071 → MF-216..MF-235 |
| Admin — fulfillment & delivery | 10 | 10 | R-072..R-081 → MF-239..MF-262 |
| Admin — email & marketing | 9 | 9 | R-082..R-090 → MF-201..MF-287 |
| Admin — reporting, money & exports | 3 | 3 | R-091..R-093 → MF-173..MF-289 |
| Admin — configuration & staff tooling | 13 | 13 | R-094..R-106 → MF-066..MF-294 |
| Auth, permissions & security controls | 30 | 30 | R-107..R-136 → MF-007..MF-293 |
| Data model & data infrastructure | 29 | 29 | R-137..R-165 → MF-001..MF-295 |
| Integrations & platform | 22 | 22 | R-166..R-187 → MF-151..MF-288 |
| Design system / app-wide UI | 5 | 5 | R-188..R-192 → MF-023..MF-040 |

Peer-unique rows were not filtered out. R-010 (UNIQUE-TO-arm-02 first-run setup) is covered by MF-076/MF-077; R-114 (UNIQUE-TO-arm-01 customer identity linking) is covered by MF-049/MF-085; R-184 (UNIQUE-TO-arm-02 UPS credentials declared) is covered by MF-253; all UNIQUE-TO-arm-02 data-schema rows (R-144..R-165) are covered by the data slice's `F-001`..`F-060` mapped through MF-133..MF-295.

## Precision — 3/3

Spot-check verification of distinctive evidence paths against `.scratch/sources/tomche-shabbos-website` — all resolved to real files:

| Path (arm-04 claim) | Verified |
|---|---|
| `src/features/orders/server/orderAccess.ts`, `finalizeOrder.ts`, `orderStateMachine.ts`, `saveDraft.ts`, `loadDraft.ts`, `discardDraft.ts`, `cancelOwnDraft.ts`, `adminPayments.ts`, `transitionOrder.ts` | ✓ exist |
| `src/features/auth/server/{audit,customer,ensureCustomer,impersonation,requirePermission,resolveUser,staff}.ts` | ✓ exist |
| `src/features/checkout/server/{checkoutToken,checkoutValidation,checkoutView,pricing,shipping}.ts` | ✓ exist |
| `src/features/fulfillment/server/{fulfillmentActions,fulfillmentPool,markDelivered,routeActions,shipmentActions}.ts` | ✓ exist |
| `src/features/email/server/{dispatchEmail,htmlEscape,marketingActions,orderEmails,orderSummaryHtml,templateActions,templateRender,triggeredEmailDefaults,unsubscribeToken,upsertSubscriber,campaignSend}.ts` | ✓ exist |
| `src/features/inventory/server/{actions,allocate,dashboard,items,production,release,reserve,shortfall,writeoff}.ts` | ✓ exist |
| `src/features/customers/server/{customerActions,savedAddresses}.ts` | ✓ exist |
| `scripts/{check-schema-has-migration.mjs,gen-env-example.ts,link-old-product-images.ts,reset-test-db.ts,seed-test-season.ts,test-migration.mjs}` | ✓ exist |
| All 29 `src/app/api/**/route.ts` files cited (account/profile, addresses/validate, admin/{reset-test-db,seed-test-season,wipe-test-data}, checkout, checkout/offline, client-error, cron/{outbox-sweep,payment-reminders,pickup-expiry,purge-email-log,reconcile-stripe}, customers/{find-or-create,search}, export/{deliveries,item-sales,lapsed-customers,year-end,year-metrics}, health, impersonate, media, media/[id], route-builder/refresh-coords, setup, subscribe, unsubscribe, webhooks/stripe) | ✓ exist |
| `lighthouserc.json`, `components.json`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `.github/workflows/agent-guardrails.yml`, `src/features/auth/nav.ts` | ✓ exist |
| `src/lib/{csv,brand,ids/money/normalize/phone/result/season/dates/logging}/index.ts`, `src/test-support/{itDatabase,integrationGlobalSetup}.ts`, `src/features/products/server/seasonSales.ts` | ✓ exist |

No fabricated paths detected. No invented features. The arm explicitly tags 8 feature-level conflicts (CF-01..CF-08) and 3 proof-of-read discrepancies as unresolved rather than inventing resolutions — disciplined behavior that protects precision. Drift rows (MF-174, MF-215, MF-253) are labeled "Drift:" and cite the exact env keys / package.json lines, not invented behavior. Two documented stubs (MF-132, MF-266) are flagged as no-ops.

**Junk list:** none.

## bonus_inventory_novel

Real features present in source with verified evidence paths, absent from `shared/RECONCILED-INVENTORY.md`. Count: 6.

| # | arm-04 row | Name | Evidence path(s) | Verified |
|---|---|---|---|---|
| B-01 | MF-006 | Integration tests against real Postgres in a throwaway schema (`RUN_DB_IT=1` gate) | `src/test-support/itDatabase.ts`, `src/test-support/integrationGlobalSetup.ts` | ✓ both files exist |
| B-02 | MF-016 | Structured JSON logging with recursive secret + PII redaction (console-only, no Sentry/Datadog) | `src/lib/logging/index.ts` | ✓ exists |
| B-03 | MF-086 | Order-access + customer-action integration tests (DB-backed coverage of the access rules) | `src/features/orders/server/orderAccess.integration.test.ts`, `src/features/customers/server/customerActions.integration.test.ts` | ✓ both files exist |
| B-04 | MF-227 | One-off migration: relink product images from the previous Blob store (dry-run unless `--apply`) | `scripts/link-old-product-images.ts` | ✓ exists |
| B-05 | MF-270 | CSV formula-injection neutralization (prefixes `= + - @ tab CR LF`-leading cells with `'`) | `src/lib/csv.ts:18` (`neutralizeFormula`) | ✓ exists; function body confirmed |
| B-06 | MF-271 | Per-season sales aggregates shared with the products list (distinct from `seasonReports.ts`) | `src/features/products/server/seasonSales.ts` | ✓ exists |

These are genuine source features with real evidence, not present in the reconciled union of arm-01 + arm-02. The reconciled file was not edited.

## Notes

- arm-04 is a late-join arm with five specialist partials (product/security/data/ui/integrations); its 295 merged features collapse 451 source rows by meaning + evidence, with the finest granularity any partial used.
- The arm's `AGENTS.md` forbids source reads after Test 1a, so the 8 conflicts and 15 security-gap observations are surfaced rather than resolved. This is a precision-preserving choice, not a coverage gap.
- No model names appear in this grade; arm ids only.
