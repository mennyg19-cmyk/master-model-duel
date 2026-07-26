# Grill turns review — arm-04

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Evidence base:** `arms/arm-04/results/GRILL-TRANSCRIPT.md` (10 turns, live human, late-join arm)
**Grill inventory:** `arms/arm-04/results/GRILL-INVENTORY.md` — 99 features (G-001..G-099), 18 OPEN decisions, 17 feature rows carry OPEN
**Rubrics:** `kit/rubrics/grill-turns-1b.md`, `kit/rubrics/grill-inventory.md`

## Per-turn grades (0–2 per dimension)

| Turn | Needed vs fluff | Explain-down | Options real | Uptake | Faithful capture | Notes |
|---:|---:|---:|---:|---:|---:|---|
| 1  | 2 | 2 | 2 | 2 | 2 | Scope framing + fixed Purim deadline. User picked A (NOT Rec B — "all of it, nothing deferred"). Capture preserves the no-deferral stance including map routing and live rate shopping in-scope; no quiet shrink to B. |
| 2  | 2 | 2 | 2 | 2 | 2 | Prior-year data source. User said "A — have Excel files", which is closer to B than Rec A; agent honestly reframed the capture as a one-time Excel file drop rather than a system API, instead of force-fitting to A. Textbook uptake. |
| 3  | 2 | 2 | 2 | 2 | 2 | Nightly print run. User picked Rec A. Capture preserves every distinguishing nuance: bucket PDFs, print-as-log-only, reprints stamped, packed/shipped/delivered stay separate human actions, bucket defs as data. |
| 4  | 2 | 2 | 2 | 2 | 2 | Money on delivery-type switch. User picked Rec A. Capture records price-locked-at-checkout, savings-as-margin, explicit adjust-total with reason, zip warns-staff/blocks-storefront — and stitches the first appearance of the one-engine-two-levels pattern. |
| 5  | 2 | 2 | 2 | 2 | 2 | Inventory counting. User picked Rec A. Capture keeps optional-recipes nuance (no recipe = plain count), buildable-quantity derivation, stock-as-ledger, and reuses the storefront-hard-stop / POS-warn pattern from T4. |
| 6  | 2 | 2 | 2 | 2 | 2 | Outside accounts. User delegated ("A or B, whichever is better"). Agent LOCKED Rec A transparently, with three reasons and a forward path to attach negotiated carrier accounts later. Capture explicitly flags the delegation — not smuggled. |
| 7  | 2 | 2 | 2 | 2 | 2 | Donor identity. User picked B (NOT Rec A — passwords over passwordless). Agent honored B for the UX, added mitigations inside B, and transparently retained the customer/login structural separation from A as "plumbing, not a product decision" — flagged in the open, not a silent rewrite. |
| 8  | 2 | 2 | 2 | 2 | 2 | Driver hand-off. User picked Rec A AND added a PIN. Agent incorporated the human's PIN addition cleanly (per-route, entered once, rate-limited, revocable) and kept every other A element. User enhancement honored without dropping the recommendation. |
| 9  | 2 | 2 | 2 | 2 | 2 | Season calendar. User picked Rec A. Capture records the calendar screen, automatic storefront enforcement, staff override-with-warning, browse-only on close, dates-as-data — and explicitly names this as the third instance of the one-engine-two-levels pattern. |
| 10 | 2 | 2 | 2 | 2 | 2 | Validation. User picked "A and B" (both). Agent honored both, called it "the right answer and not a compromise," and made the rehearsal a hard gate on a fixed date rather than a milestone. Capture preserves the full rehearsal scenario set. |

**Fluff turns:** none. All 10 turns address a real seed decision; the agent also surfaces 7+ open items and 8 not-covered items rather than padding turns to fill them.

## Turn quality

- Per-turn mean = sum of 5 dimensions / 5 (0–2 scale).
- All 10 turns: 10/5 = **2.00**

**turn_quality_mean** = **2.00 / 2**

**necessary_turns** = 10

## Recommended-used rate (fact only)

User picked (or, for T6, delegated into) the model's Recommended option in: T2, T3, T4, T5, T6, T8, T9, T10 → **8 / 10 = 80.0%**.
Non-recommended picks: T1 (A over Rec B — full scope, no deferral), T7 (B over Rec A — passwords over passwordless).
User-enhanced pick: T8 (Rec A + added PIN).

## Grill inventory quality

Evidence base: transcript only (turn cites). 99 features, 18 OPEN decisions, 17 feature rows carry OPEN. Agent-taken decisions (G-033 aggregator, G-069 customer/login separation) recorded in a separate section, not as human answers.

- **Coverage / usefulness (0–4): 4** — every turn maps to multiple features, and cross-turn patterns are stitched with multi-turn cites: the one-rules-engine-two-levels pattern (G-022) cites T4+T5+T9; the audit event log (G-029) cites T4+T8+T9; the manual-path-preserved pattern (G-096) cites T1+T3+T6+T8. All 10 user decisions are captured with their distinguishing nuance (price-locked + spread-as-margin in G-025/G-026/G-028, print-as-log in G-047/G-048, optional recipes in G-039, PIN gate in G-056, rehearsal-as-gate in G-091/G-093). The 18 OPEN decisions are explicitly enumerated (O-001..O-018) and each tied to the features it blocks — honest flagging, not suppression. The Close block (locked decisions table, open items, not-covered list) is fully mined: 8 not-covered items become OPEN rows (G-024, G-030, G-031, G-072, G-086, G-097, G-098, G-099) rather than being silently dropped or invented. The 99-feature granularity is justified by transcript density (T5 alone yields 7 distinct features, T8 yields 13), not over-decomposition.
- **Anti-hallucination (0–3): 3** — every row carries transcript turn cites; spot-checks match the user's "I heard" line. No fabricated features: G-006 (sold-out) cites T5 only and does not invent a sold-out UI; G-033 (aggregator) is flagged as agent-taken, not human; G-045 (bucket grouping) carries OPEN for the exact folder scheme rather than inventing one; G-082 (timezone) is OPEN rather than defaulted; G-094 (rehearsal date) is OPEN rather than picking the "roughly three weeks" the agent floated. No contradictions between rows. The agent-taken decisions section keeps G-033 and G-069 visibly separate from human answers, which is exactly the anti-hallucination posture the rubric asks for.

**inventory_score** = 4 + 3 = **7 / 7**

## Combined scores

```
grill_quality    = inventory_score × (turn_quality_mean / 2)
                 = 7 × (2.00 / 2) = 7.00 / 7
grill_efficiency = inventory_score / max(1, necessary_turns)
                 = 7 / 10 = 0.700
```

**Scorecard mapping (8-point scale):** 7.00 / 7 × 8 = 8.00 → **8 / 8** (orchestrator-normalized; matches arm-01/arm-02/arm-03 treatment).

## Summary

| Metric | Value |
|---|---|
| Turns graded | 10 |
| Fluff turns | 0 |
| necessary_turns | 10 |
| turn_quality_mean | 2.00 / 2 |
| Coverage | 4 / 4 |
| Anti-hallucination | 3 / 3 |
| inventory_score | 7 / 7 |
| grill_quality | 7.00 / 7 |
| grill_efficiency | 0.700 |
| scorecard points | 8.0 / 8 |
| Recommended-used rate | 80.0% (8/10) |

**OPEN handling note:** All 18 OPEN decisions are honest flags for items the transcript explicitly left unresolved (Close block: not-covered list, deferred T7 sub-question, T6 delegated-then-locked, T3 folder scheme, T9 timezone, T10 rehearsal date). No OPEN row invents a default that contradicts the transcript; no OPEN row suppresses a settled decision. The agent-taken decisions (G-033, G-069) are isolated in their own section so they cannot be read as human answers. Per the prompt's instruction, OPEN rows are not penalized.

**Verdict:** arm-04's grill is a clean 10-turn sweep at full marks on every dimension. Every turn reduced real ambiguity, options fit the product, and uptake was faithful — including two non-recommended picks (T1, T7) the agent honored without relitigating, one user delegation (T6) the agent locked transparently, and one user enhancement (T8 PIN) the agent incorporated without dropping the recommendation. The grill inventory is the most granular of the four arms (99 features vs arm-03's 13) and the only one to surface OPEN decisions as a first-class enumerated list with explicit blocking-feature links — a stronger anti-hallucination posture than treating silence as a decision. With the inventory produced, the scorecard unlocks at **8.0 / 8**, on par with arm-01/arm-02/arm-03 on quality and ahead on efficiency (0.700 vs arm-03's 0.538, because 10 turns covered the same seed decision-space that arm-03 took 13 turns to cover).
