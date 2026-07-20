# Inventory comparison — Test 1a (user-facing)

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`

This document compares each arm's **codebase inventory** (what the existing site actually does) against its **grill inventory** (what the user said they need during the interview). The gap between the two is what the rebuild has to deliver. No model names are used.

Reconciled codebase union: 192 features (`shared/RECONCILED-INVENTORY.md`).
Arm-01 grill: 30 items (G-001..G-030). Arm-02 grill: 16 items (G-001..G-016).

---

## Arm-01

### Buckets

| Bucket | IDs |
|---|---|
| Only in codebase | Most codebase rows have no grill counterpart: storefront marketing (F-001..F-005), checkout plumbing (F-011, F-014..F-016), account self-serve (F-018..F-024), admin catalog/inventory/media (F-041..F-049), email marketing (F-060..F-063), settings (F-064..F-067), reports/exports/reconciliation (F-068..F-070), staff/impersonation/audit/test-mode/help (F-071..F-076), and all SEC/DATA/UI/INT rows. The grill never asks about these — they are assumed or out of scope. |
| Only in grill | G-003 Default package grouping; G-004 Package splitting; G-005 Package-level tracking/printing as a first-class concept; G-006 Staff fulfillment-method switching (shipping ↔ volunteer delivery as a cost-optimization action); G-007 Preserve paid delivery charge on method switch; G-009 Optional ingredient inventory (OPEN: who enables it, when); G-010 Bills of materials + assembly batches. |
| In both | G-001 Hybrid fulfillment workflow ↔ F-050/F-051/F-057; G-002 Document printing (slips/labels/cards, print ≠ shipped) ↔ F-031/F-032/F-054; G-008 Finished-package inventory ↔ F-047/F-048/F-049; G-011 Repeat-order draft creation ↔ F-021/F-033; G-012 Unmapped repeat-item resolution ↔ F-044/F-021; G-013 Price-matched replacement suggestions ↔ F-044; G-014 Manual replacement mappings ↔ F-044; G-015 Delivery-area ZIP gate ↔ F-065; G-016 Bulk-delivery pricing ↔ F-013/F-065; G-017 Per-package delivery pricing ↔ F-013/F-065; G-018 Staff/Manager roles ↔ F-027; G-019 Per-person overrides ↔ F-027/SEC-003; G-020 Staff-scheduled bulk delivery ↔ F-052/F-053; G-021 Bulk-delivery notification (OPEN: channel) ↔ F-060/F-062; G-022 Catalog-first cart entry ↔ F-007/F-035; G-023 Three-source recipient picker ↔ F-012/UI-028..UI-030; G-024 Address-book recipient persistence ↔ F-012/F-023; G-025 Per-recipient greeting memory ↔ F-054/F-009; G-026 Off-season archive ↔ F-005/F-006; G-027 Nearby shipping-package map suggestions (OPEN: "nearby" rule) ↔ F-052; G-028 Confirmed map rerouting ↔ F-052; G-029 Method-change audit ↔ F-073; G-030 Label invalidation on reroute (OPEN: vendor) ↔ F-031/INT-010. |
| Contradictions | G-001 stage taxonomy (New/Printed/Packed/Sent/Picked Up) vs codebase fulfillment status model — the codebase uses a different state vocabulary; the paper-first hybrid stages are not modeled as named states. G-015 "hard-block, no manager override" vs F-065 — codebase configures delivery ZIPs but does not document a hard no-override gate. G-030 "void label on reroute" vs INT-010 — codebase auto-voids labels only when the DB save fails, not when a package is rerouted. |

### Plain English — why it matters for the rebuild

Arm-01's grill is a **fulfillment-workflow interview**. The user spent 13 turns on how packages are grouped, split, printed, tracked, and rerouted — and almost no time on storefront, payments, or admin catalog work. The existing codebase already covers the surrounding system (storefront, checkout, catalog, inventory, reports, staff permissions) but treats fulfillment at the order/fulfillment-group level, not the **package** level. The rebuild has to introduce a package-level entity with its own status, printing, and rerouting lifecycle — without losing the existing order/recipient grouping. The biggest open items are ingredient/BOM inventory (G-009, G-010), which the codebase has no concept of at all, and the "switch shipping → volunteer delivery and keep the delivery charge" flow (G-006/G-007), which has no codebase precedent. Three grill items are explicitly OPEN and need user resolution before build.

---

## Arm-02

### Buckets

| Bucket | IDs |
|---|---|
| Only in codebase | Same broad tail as arm-01 — storefront marketing, account self-serve, admin catalog/inventory/media, settings, reports/exports/reconciliation, staff/impersonation/audit/test-mode/help, and the SEC/D-*/F-UI/INT rows — none of which the grill touches. Plus arm-02-only codebase rows with no grill ask: R-036 payment recalc, R-071 stock reserve/allocate/release engine, R-081 bin packing, R-087 order lifecycle emails, R-170..R-187 (Stripe singleton, Resend, UPS-declared-not-used, Vercel Cron, Nexternal pipeline, health check), R-188..R-192 design system. |
| Only in grill | G-003 Large-scale operations baseline (1,000+ orders / 5,000+ packages / 10+ concurrent staff; batch tools, stricter concurrency, fast bulk printing) — a non-functional requirement, not a single feature. G-008 Nightly print batch ("Tonight's Batch" aggregates not-yet-printed orders into a separate PDF per filing group; printed ≠ shipped; reprint per group/order). G-013 Pickup workflow details (per-order eligibility when inventory available, auto email/text on "Ready for pickup", door-side searchable pickup list, unclaimed-orders report, season cap on latest pickup hours). G-014 Per-package delivery promise (premium, ZIP-restricted, manager-set allowed day(s) shown at checkout with no customer slot choice, "out for delivery today" notification on route start). |
| In both | G-001 Historical data migration ↔ INT-026/D-055; G-002 Repeat last year's order ↔ F-031/F-038/F-045/F-046; G-004 Shipping rate-shop + label printing ↔ F-060/F-062 (partial — see contradictions); G-005 Stripe checkout, immediate capture, one-click refunds ↔ F-022/F-043; G-006 Driver mobile web route link ↔ F-066/F-067; G-007 Printed route sheet fallback ↔ F-064; G-009 Roles + per-person permissions ↔ SEC-004/SEC-005/SEC-014; G-010 Greeting cards ↔ F-065/F-038; G-011 Season lifecycle + per-year catalogs ↔ D-007/F-007/F-006/F-038; G-012 Map reroute shipping → delivery ↔ F-063 (partial); G-015 Customer address book (shared website + POS, staff audit) ↔ F-033/F-050/F-016; G-016 POS phone orders with check/cash ↔ F-047/F-023/F-042/SEC-014. |
| Contradictions | **G-004 margin capture vs F-062 rate resolution.** The grill says "charge the customer the higher quote, ship with the cheaper carrier" — the org keeps the spread. The codebase selects the cheapest rate and charges the resolved rate; it does not capture a margin. This is a real product-model conflict, not a wording gap. **G-006 "tap-to-navigate Google Maps" vs F-063/INT-017 Mapbox.** The codebase geocodes and maps with Mapbox; the grill assumes Google Maps for driver navigation. Minor but affects the driver UX and the integration list. **G-009 "drivers via no-login route link" vs SEC-010/SEC-012.** The codebase requires a logged-in messenger with `routes.viewOwn` (or the `canDrive` carve-out); the grill wants drivers to follow a link with no login at all. The auth model for drivers is in conflict. **G-012 "no customer refund — org keeps shipping savings" vs F-062.** Consistent with G-004's margin philosophy, but the codebase has no reroute-with-charge-preservation feature, so the savings-retention behavior is absent, not just undescribed. |

### Plain English — why it matters for the rebuild

Arm-02's grill is a **scale-and-operations interview**. The user is preparing for 1,000+ orders and 5,000+ packages with 10+ concurrent staff, and the questions concentrate on the things that break at that size: rate-shopping with margin capture, nightly per-group print batches, driver mobile execution, pickup volume, and a single shared address book. The existing codebase already has the pieces (Shippo labels, a route builder, pickup locations, follow-up queues, a shared builder shell) but is built **pass-through**: it charges the customer the rate it ships at. The grill wants the org to **keep the spread** between quoted and shipped rates, and to keep the delivery charge when rerouting shipping packages onto volunteer routes. That is the single biggest behavioral change the rebuild has to absorb, and it ripples into refunds (G-005 "one-click refunds when orders change"), reconciliation (R-093), and the audit trail (G-029). The driver auth model (link vs login) and the map provider (Google vs Mapbox) also need a user decision before build.

---

## Cross-arm summary

- **Grill scope differs by design.** Arm-01's grill is fulfillment-workflow-heavy (30 items, mostly about packages, printing, BOMs, rerouting). Arm-02's grill is operations-and-scale-heavy (16 items, mostly about rate-shopping, print batches, driver mobile, pickup, address book). Both grills ignore the same broad codebase tail (storefront marketing, account self-serve, admin catalog/media, reports, settings, design system), which the rebuild can carry forward largely as-is.
- **Both grills converge on the same hard problem: fulfillment-method switching with charge preservation.** Arm-01 calls it "switch shipping ↔ volunteer delivery, keep the delivery charge" (G-006/G-007). Arm-02 calls it "reroute shipping → delivery, auto-void the label, no customer refund, org keeps the savings" (G-012, tied to G-004 margin capture). The codebase has no precedent for either — this is greenfield work, and it is the highest-risk item in the rebuild.
- **Both grills want a package-level concept the codebase does not have.** Arm-01 wants package grouping/splitting/tracking (G-003..G-005). Arm-02 wants nightly per-group print batches (G-008) and per-package delivery promises (G-014). The codebase models fulfillment at the order/fulfillment-group level. Introducing a package entity is shared scope.
- **Arm-02 surfaces explicit contradictions the rebuild must resolve; arm-01 surfaces gaps.** Arm-02's rate-margin model (G-004), driver auth model (G-009), and map provider (G-006) conflict with the existing code. Arm-01's gaps (ingredient inventory G-009, BOMs G-010, label-void-on-reroute G-030) are absent features, not conflicts.
- **OPEN items needing user input.** Arm-01: G-009 (who enables ingredient inventory and when), G-021 (bulk-delivery notification channel), G-027 ("nearby" rule for map suggestions), G-030 (shipping-label vendor/voiding integration). Arm-02: OPEN-1 (shipping aggregator vendor — Shippo vs EasyPost vs direct FedEx+UPS). These overlap: G-030 and OPEN-1 are the same vendor decision.
- **Reconciled codebase union is stable.** The 192-feature reconcile (`shared/RECONCILED-INVENTORY.md`) carries 2 conflicts forward (role count R-109; Stripe client packages R-166) and 1 flagged doc-only path (R-165). None of these block the grill comparison, but R-109 (is "customer" a StaffRole enum value or a permissions-layer pseudo-role?) should be settled before Test 2 because both grills lean on the role model.

---

## User action required

Before Test 2, edit/approve this comparison into `shared/USER-RESOLVED-INVENTORY.md`. At minimum, resolve:

1. **Fulfillment-method switching with charge preservation** — confirm the org keeps the shipping/delivery charge on reroute (arm-01 G-006/G-007, arm-02 G-012) and decides whether to capture rate margin (arm-02 G-004). This is the rebuild's biggest open behavioral question.
2. **Package-level entity** — confirm the rebuild introduces a package concept with grouping, splitting, status, and printing (arm-01 G-003..G-005, arm-02 G-008/G-014).
3. **Driver auth model** — no-login route link (arm-02 G-009) vs logged-in messenger with `canDrive` carve-out (codebase SEC-010/SEC-012).
4. **Map provider for driver navigation** — Google Maps (arm-02 G-006) vs Mapbox (codebase F-063/INT-017).
5. **Shipping aggregator vendor** — Shippo vs EasyPost vs direct FedEx+UPS (arm-02 OPEN-1 = arm-01 G-030).
6. **Ingredient/BOM inventory** — in or out of launch scope, and who enables it (arm-01 G-009/G-010).
7. **Role model** — is "customer" a StaffRole enum value or a permissions-layer pseudo-role? (reconcile conflict R-109, inherited from arm-02 SEC-004 vs D-002).
8. **Stripe client packages** — dead deps or an unshipped embedded flow? (reconcile conflict R-166, inherited from arm-02 INT-029).

Resolve these, then save the result as `shared/USER-RESOLVED-INVENTORY.md` so Test 2 can plan against a fixed target.
