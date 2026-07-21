# Inventory grade — Test 1a — arm-03 (LATE JOIN)

**Arm:** arm-03 (blind; late-join)
**Arm inventory:** `arms/arm-03/results/CODEBASE-INVENTORY.md` (125 merged features, F-001..F-125)
**Reconciled (frozen):** `shared/RECONCILED-INVENTORY.md` (192 IDs, R-001..R-192)
**Rubric:** `kit/rubrics/inventory-1a.md`
**Source tree verified against:** `.scratch/sources/tomche-shabbos-website`

## Scoring (mandatory)

- covered = **164**
- total_reconciled = **192**
- coverage_pct = **85.4%**

### Recall (0–4)

85.4% of all reconciled IDs are covered with real evidence → band **3** (75–89%).

### Precision (0–3)

No fabricated paths detected in arm-03. Every cited path spot-checked resolves to a real file in the source tree (verified `htmlEscape.ts`, `orderStateMachine.ts`, `finalizeOrder.ts`, `discardDraft.ts`, `allocate.ts`, `release.ts`, `binPacking.ts`, `checkoutValidation.ts`, `pricing.ts`, `result/index.ts`, `brand.ts`, `tokens.css`, `health/route.ts`, permission tests, `agent-guardrails.yml`, `DATA-MIGRATION-INVENTORY.md`, `client-error/route.ts`, `fix-order-numbers.ts`, `hero.png` — all OK). No invented features. → band **3** (≤5% junk).

**Junk list:** _none._

## Total 1a score

**6 / 7** (recall 3 + precision 3)

## Coverage notes — misses (28 of 192)

arm-03 produces broad, arm-01-style rows. Per rubric, `UNIQUE-TO-arm-02` rows are attribution only and count as a miss for recall when arm-03 lacks a specific evidencing row. Misses fall into three buckets:

### A. Granular data-schema rows left UNIQUE-TO-arm-02 (arm-03 F-007 broad schema row does not subsume these per reconciler)
- R-144 Customer records (normalized phone/email + dedupe)
- R-146 Season model gating catalog per year
- R-148 Product options with price adjustments
- R-149 Normalized order tree (Order → OrderLine → add-ons)
- R-150 Price snapshots on order lines
- R-157 Package types + shipment boxes
- R-164 Data-layer helper libraries (`src/lib/*` money/normalize/phone/ids/season/dates/result)
- R-165 Legacy→new data migration plan (`DATA-MIGRATION-INVENTORY.md`)

### B. Peer-unique behaviors arm-03 has no specific row for
- R-015 Package category filters
- R-016 Package price sorting
- R-017 Catalog sold-out handling
- R-034 Checkout stock + price validation (`checkoutValidation.ts`, `pricing.ts`)
- R-044 Order status state machine + transitions
- R-045 Order finalization (draft → placed)
- R-046 Draft discard
- R-071 Stock reserve/allocate/release engine (arm-03 F-076 cites `reserve.ts` only; `allocate.ts`/`release.ts` not cited)
- R-081 Shipment planning + bin packing (arm-03 F-078 cites `shipmentPlanning.ts` only; `binPacking.ts` not cited)

### C. Platform / CI / UI-token rows not cited by arm-03
- R-133 Automated repository security guardrails (`.github/workflows/agent-guardrails.yml`)
- R-135 Permission unit tests (`permissions.test.ts`, `requirePermission.test.ts`)
- R-136 Production error masking for server actions (`src/lib/result/index.ts`)
- R-184 UPS direct credentials declared not implemented (arm-03 F-124 cites USPS, not UPS)
- R-186 Nexternal legacy import pipeline (`scripts/nexternal/*` import; arm-03 F-014 cites only `scripts/nexternal/shared/runWithTestDb.ts`)
- R-187 Health check (`src/app/api/health/route.ts`)
- R-189 Custom UI primitives (confirm-dialog/empty-state/fab/info-hint/page-header/pill-input/price-tag/smart-select/callout — arm-03 F-098 lists the shadcn kit, not this custom set)
- R-190 Design tokens + brand constants (`src/styles/tokens.css`, `src/lib/brand.ts`; arm-03 F-001 cites `globals.css` only)
- R-192 Marketing imagery assets (`public/images/*`)

## Late-join bonus (mandatory section)

IDs in arm-03 inventory that are REAL in source (evidence paths verify against `.scratch/sources/tomche-shabbos-website`) but ABSENT from the reconciled inventory.

**bonus_inventory_novel = 2** (1 strong, 1 weak/generic)

| arm-03 ID | Name | Evidence path(s) | Verified | Strength | Notes |
|---|---|---|---|---|---|
| F-101 | Email HTML XSS escape | `src/features/email/server/htmlEscape.ts` | OK | Strong | Distinct security helper escaping `& < > " '` before user strings enter HTML email bodies. Not represented in reconciled R-085 (templates) / R-087 (order emails); reconciled has no XSS-escape row. |
| F-104 | Next.js path cache revalidation after mutations | `revalidatePath` calls in 14+ `src/features/*/server/*.ts` (users, settings, reconciliation, products, addOns, inventory, imports, fulfillment, email, customers) | OK | Weak/generic | Real and widespread, but a generic Next.js pattern rather than a distinct product feature. Reconciled has no cache-invalidation row. |

Reconciled file was NOT edited.

## Method

- Mapped each of arm-03's 125 feature rows to reconciled IDs by evidence-path overlap and behavior. A reconciled ID counts as covered only when arm-03 has a row whose cited evidence supports that specific behavior (broad schema row F-007 does not subsume granular data rows the reconciler left UNIQUE-TO-arm-02).
- All 28 miss evidence paths were verified to exist in source (so they are genuine misses, not hallucinations on arm-03's part — arm-03 simply did not surface them).
- arm-03's own cited paths were spot-checked; none fabricated.
- No model names used; arm ids only.
