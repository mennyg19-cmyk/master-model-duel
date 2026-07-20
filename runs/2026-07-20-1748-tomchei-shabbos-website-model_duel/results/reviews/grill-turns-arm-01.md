# Grill turns review — arm-01

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Evidence base:** `arms/arm-01/results/GRILL-TRANSCRIPT.md`, `arms/arm-01/results/GRILL-INVENTORY.md`
**Rubrics:** `kit/rubrics/grill-turns-1b.md`, `kit/rubrics/grill-inventory.md`

## Per-turn grades (0–2 per dimension)

| Turn | Needed vs fluff | Explain-down | Options real | Uptake | Faithful capture | Notes |
|---:|---:|---:|---:|---:|---:|---|
| 1  | 2 | 2 | 2 | 2 | 2 | Hybrid vs print-first vs digital — sets fulfillment design. User picked Recommended B; capture preserves "printing ≠ shipped" nuance. |
| 2  | 2 | 2 | 2 | 2 | 2 | Package grouping core; capture records default-group + staff-split + order link. |
| 3  | 2 | 2 | 2 | 2 | 2 | User picked A (not Recommended C). Capture correctly honors non-recommended choice and the "backend cost-optimization only" framing. |
| 4  | 2 | 2 | 2 | 2 | 2 | User picked Recommended B with a v1 modification (hide/optional ingredients). Capture records the launch-scope trim without dropping the data model. |
| 5  | 2 | 2 | 2 | 2 | 2 | User added price-matched fallback beyond Recommended B; capture includes both required-choice and suggestion logic. |
| 6  | 2 | 2 | 2 | 2 | 2 | User picked A (not Recommended B). Capture records hard block for customer + backend, no manager override. |
| 7  | 2 | 2 | 2 | 2 | 2 | Bulk vs per-package pricing; clean capture of two distinct fee models. |
| 8  | 2 | 2 | 2 | 2 | 2 | User hybridized B (defaults) + C (per-person overrides); capture preserves both layers without forcing a single tier. |
| 9  | 2 | 2 | 2 | 2 | 2 | Bulk-delivery scheduling; capture records no customer appointment + staff route assignment + notify. |
| 10 | 2 | 2 | 2 | 2 | 2 | User rejected all three options for a custom cart-first flow with three-way recipient picker; options still fit the product, and capture records the custom answer faithfully. |
| 11 | 2 | 2 | 2 | 2 | 1 | Recommended B captured correctly, but "I heard" appends "complements order-level default from arm-02 Turn 8 pattern" — an unsourced cross-arm reference the user never raised. Core capture faithful; docked for the imported claim. |
| 12 | 2 | 2 | 2 | 2 | 2 | Off-season archive; clean capture of year-picker, not-for-sale labeling, disabled cart/checkout. |
| 13 | 2 | 2 | 2 | 2 | 2 | Map reroute; capture records suggest-and-confirm, no auto-reroute, and cross-references Turn 3 (keep charge) and label voiding consistently. |

**Fluff turns:** none. All 13 turns address a real seed decision.

## Turn quality

- Per-turn mean = sum of 5 dimensions / 5 (0–2 scale).
- Turns 1–10, 12, 13: 10/5 = **2.00**
- Turn 11: 9/5 = **1.80**

**turn_quality_mean** = (12 × 2.00 + 1.80) / 13 = **1.98** (≈ 1.985)

**necessary_turns** = 13

## Recommended-used rate (fact only)

User picked the model's Recommended option (or included it in a hybrid) in: T1, T2, T4, T5, T7, T8, T9, T11, T12, T13 → **10 / 13 = 76.9%**.
Strict count (excluding the T8 B+C hybrid): 9 / 13 = 69.2%.

## Grill inventory quality

- **Coverage (0–4): 4** — 30 inventory items cover all 13 turns; OPEN items are explicitly marked (G-009 ingredient-enable owner, G-021 notification channel, G-027 "nearby" rule, G-030 label voiding vendor).
- **Anti-hallucination (0–3): 3** — every row carries a transcript turn cite; no claims contradict the transcript. G-010 (BOM/assembly) and G-014 (manual replacement mappings) are reasonable interpretations grounded in T4 and T5 respectively; G-030 is sourced from T1 + T13.

**inventory_score** = 4 + 3 = **7 / 7**

## Combined scores

```
grill_quality    = inventory_score × (turn_quality_mean / 2)
                 = 7 × (1.985 / 2) = 6.95 / 7
grill_efficiency = inventory_score / max(1, necessary_turns)
                 = 7 / 13 = 0.54
```

**Scorecard mapping (8-point scale):** 6.95 / 7 × 8 ≈ **7.9 / 8**

## Summary

| Metric | Value |
|---|---|
| turn_quality_mean | 1.98 / 2 |
| necessary_turns | 13 |
| fluff turns | 0 |
| inventory_score | 7 / 7 |
| grill_quality | 6.95 / 7 |
| grill_efficiency | 0.54 |
| scorecard points | ≈ 7.9 / 8 |
| Recommended-used rate | 76.9% (10/13) |

**Verdict:** Strong grill run. Every turn reduced real ambiguity, options fit the product, and uptake was faithful — including two non-recommended picks (T3, T6) and one custom answer (T10) that the model honored rather than quietly rewriting. The only blemish is Turn 11's unsourced cross-arm reference ("arm-02 Turn 8 pattern") inside the "I heard" line, which cost one faithful-capture point without affecting the decision record. Inventory coverage is complete and every row is cited; efficiency is moderate (0.54) purely because 13 turns were spent, not because any were wasted.
