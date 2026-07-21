# Grill turns review — arm-03

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Evidence base:** `arms/arm-03/results/GRILL-TRANSCRIPT.md` (13 turns, live human)
**Grill inventory:** `arms/arm-03/results/GRILL-INVENTORY.md` — 13 features (G-001..G-013), 0 OPEN
**Rubrics:** `kit/rubrics/grill-turns-1b.md`, `kit/rubrics/grill-inventory.md`

## Per-turn grades (0–2 per dimension)

| Turn | Needed vs fluff | Explain-down | Options real | Uptake | Faithful capture | Notes |
|---:|---:|---:|---:|---:|---:|---|
| 1  | 2 | 2 | 2 | 2 | 2 | Staff vs shoppers vs split vs staff-only — sets north-star scope. User picked C (not Recommended A); capture preserves "neither side deferred" without rewriting to A. |
| 2  | 2 | 2 | 2 | 2 | 2 | Print/digital/hybrid/automation. User picked C with "both ways from day one" extension; capture keeps the print-without-marking-shipped nuance from the seed. |
| 3  | 2 | 2 | 2 | 2 | 2 | Per-line destinations in both storefront and POS — core order model. User picked Recommended B; capture faithful, no POS-only shortcut smuggled in. |
| 4  | 2 | 2 | 2 | 2 | 2 | Rate-shop display vs cheaper actual ship. User picked Recommended A; capture records show-higher / buy-cheaper spread cleanly. |
| 5  | 2 | 2 | 2 | 2 | 2 | Repeat-order with replacement mappings + middle confirm page. User picked Recommended A; capture preserves admin-maps-replacements + confirm-before-cart step. |
| 6  | 2 | 2 | 2 | 2 | 2 | Route building with shippable-nearby hints for ship→delivery flips. User picked Recommended A; capture records Google optimize + postage-save flip. |
| 7  | 2 | 2 | 2 | 2 | 2 | Four delivery kinds with zip allowlists / mode pricing / date windows enforced in both channels. User picked Recommended A; capture faithful. |
| 8  | 2 | 2 | 2 | 2 | 2 | In-house production board (pack/ready/short). User picked Recommended A; capture records lightweight board + staff mark-done. |
| 9  | 2 | 2 | 2 | 2 | 2 | Off-season shutdown + read-only past catalogs + per-year item lists. User picked Recommended A; capture faithful. |
| 10 | 2 | 2 | 2 | 2 | 2 | Payment methods split (public cards vs POS card/check/cash). User picked Recommended A; capture preserves per-channel reconciliation. |
| 11 | 2 | 2 | 2 | 2 | 2 | Per-recipient greeting cards, optional templates, on packing print + repeat drafts. User picked Recommended A; capture faithful. |
| 12 | 2 | 1 | 2 | 2 | 2 | Address book / customer accounts. User asked for clarification before answering Recommended A — question leans on "magic-link" jargon a non-technical human (60+ staff) would not parse unaided; explain-down docked 1. Capture itself faithful. |
| 13 | 2 | 2 | 2 | 2 | 2 | Driver handoff via in-app view (link/login), print optional. User picked Recommended A; capture records ordered stops + addresses + notes + paper backup. |

**Fluff turns:** none. All 13 turns address a real seed decision.

## Turn quality

- Per-turn mean = sum of 5 dimensions / 5 (0–2 scale).
- Turns 1–11, 13: 10/5 = **2.00** (12 turns)
- Turn 12: 9/5 = **1.80**

**turn_quality_mean** = (12 × 2.00 + 1.80) / 13 = 25.80 / 13 = **1.985 / 2**

**necessary_turns** = 13

## Recommended-used rate (fact only)

User picked the model's Recommended option in: T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13 → **11 / 13 = 84.6%**.
Non-recommended picks: T1 (C over Rec A), T2 (C over Rec A, with extension).

## Grill inventory quality

Evidence base: transcript only (turn cites). 13 features, 0 OPEN.

- **Coverage / usefulness (0–4): 4** — every turn maps to a feature (T1→G-001 … T13→G-013); cross-turn features are stitched with multi-turn cites (G-002 T2+T11, G-003 T3+T11+T12, G-005 T5+T11+T12, G-006 T6+T13, G-011 T5+T11, G-012 T5+T12, G-013 T6+T13). All 13 user decisions are captured with their distinguishing nuance (print-without-ship in G-002, show-high/buy-low spread in G-004, confirm-before-cart in G-005, ship→delivery flips in G-006, per-channel payments in G-010). 0 OPEN is correct — every turn reached a firm user pick, so no unresolved item was suppressed.
- **Anti-hallucination (0–3): 3** — every row carries transcript turn cites; each claim spot-checked against the transcript matches the user's "I heard" line. No fabricated features, no contradictions, no over-claiming (e.g., G-004 does not invent a carrier name; G-006 leaves "nearby" as the seed's undefined radius rather than inventing a number).

**inventory_score** = 4 + 3 = **7 / 7**

## Combined scores

```
grill_quality    = inventory_score × (turn_quality_mean / 2)
                 = 7 × (1.985 / 2) = 6.95 / 7
grill_efficiency = inventory_score / max(1, necessary_turns)
                 = 7 / 13 = 0.538
```

**Scorecard mapping (8-point scale):** 6.95 / 7 × 8 = 7.94 ≈ **7.9 / 8** → orchestrator-normalized to **8 / 8** (matches arm-01's 6.95→8/8 treatment).

## Summary

| Metric | Value |
|---|---|
| Turns graded | 13 |
| Fluff turns | 0 |
| necessary_turns | 13 |
| turn_quality_mean | 1.985 / 2 |
| Coverage | 4 / 4 |
| Anti-hallucination | 3 / 3 |
| inventory_score | 7 / 7 |
| grill_quality | 6.95 / 7 |
| grill_efficiency | 0.538 |
| scorecard points | ≈ 7.9 / 8 (→ 8 / 8 on scoreboard) |
| Recommended-used rate | 84.6% (11/13) |

**Verdict:** arm-03's grill is excellent end-to-end. Every turn reduced real ambiguity, options fit the product, and uptake was faithful — including two non-recommended picks (T1, T2) the model honored rather than quietly rewriting to its Recommended. The single blemish is Turn 12's explain-down: "magic-link" is jargon a 60+ non-technical staff user would need unpacked, and the live user did ask for clarification before answering — exactly the rubric's dock condition, so explain-down stays at 1 (dock warranted). The grill inventory is comprehensive, cite-backed, and hallucination-free: 13 features cover all 13 turns, cross-turn dependencies (greetings↔fulfillment↔repeat-order↔address book↔driver handoff) are stitched with multi-turn cites, and the 0-OPEN count is honest rather than a suppression of unresolved items. With the inventory now produced, the previously-withheld scorecard points unlock at ≈ 7.9 / 8 (→ 8 / 8 normalized), on par with arm-01 and arm-02; arm-02 still wins the interviewer headline on the turn-quality tie-break (2.00 vs 1.985).
