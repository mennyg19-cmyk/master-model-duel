# Grill turns review — arm-06

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Evidence base:** `arms/arm-06/results/GRILL-TRANSCRIPT.md` (11 turns, live human, late-join arm)
**Grill inventory:** `arms/arm-06/results/GRILL-INVENTORY.md` — 18 features (G-001..G-018), 2 governing constraints, 6 OPEN items (O-001..O-006; O-001/O-002 carry no feature row)
**Rubrics:** `kit/rubrics/grill-turns-1b.md`, `kit/rubrics/grill-inventory.md`

## Per-turn grades (0–2 per dimension)

| Turn | Needed vs fluff | Explain-down | Options real | Uptake | Faithful capture | Notes |
|---:|---:|---:|---:|---:|---:|---|
| 1  | 2 | 2 | 2 | 2 | 2 | Priority among three goals. User picked D (all equal) — NOT Rec A. Capture preserves the rejection of single-priority framing and explicitly names "balance is the requirement, not a fallback"; no quiet shrink toward A's staff-first stance. |
| 2  | 2 | 2 | 2 | 2 | 2 | Immovable limit. User picked "A and B" — both floors, not Rec A alone. Capture records both floors (staff simplicity + order-data integrity) and the degrade-to-paper rule; does not collapse to A-only. |
| 3  | 2 | 2 | 2 | 2 | 2 | Screen vs paper as real record. User picked B (paper) over Rec A. Capture preserves "screen-as-truth rejected" and explicitly notes that A's one-tap confirmations / free reprints were NOT picked — no silent carryover of rec-only elements. |
| 4  | 2 | 2 | 2 | 2 | 2 | Minimum system knowledge. User answered in own words — a hybrid (live-first + paper catchup) not present in the options. Capture calls it "a hybrid, not a pure pick" and preserves both halves: live-first preference AND paper safety net. No force-fit into A. |
| 5  | 2 | 2 | 2 | 2 | 2 | Paper/screen disagreement. User picked C (manager exception) over Rec A, after asking for a real-life example (Order #482 illustration provided). Capture preserves C and explicitly notes it governs only the mismatch case — does not replace paper-as-record from T3. |
| 6  | 2 | 2 | 2 | 2 | 2 | Inventory meaning. User: "A for starters with an option for an eventual B." Capture records v1 = A (finished packages, reserve-at-order, sellout-capable) AND B kept open as a future option with no timeline; architecture-must-not-block constraint preserved. |
| 7  | 2 | 2 | 2 | 2 | 2 | $14 shipping fee on carrier→volunteer switch. User: "A, but don't tell the customer anything" — Rec A's notify step explicitly rejected. Capture preserves A's money rule (fee stays as fundraiser revenue) AND the silent-to-customer requirement, including the no-leak-in-customer-views constraint. User modification honored without forcing full A. |
| 8  | 2 | 2 | 2 | 2 | 2 | Check order becoming "real." User picked C (reserve now, print only when paid) over Rec A. Capture records reserved-unpaid + auto-release states, pay-by deadline (illustrative, not locked), and the strict separation of payable-only paper batch. |
| 9  | 2 | 2 | 2 | 2 | 2 | Driver handoff. User picked "B and C" — both modes — over Rec A. Capture preserves both (driver web page + plain address list), explicitly notes A's printed-sheet/Maps-link was NOT picked, and stitches the link to T4/T5 (list-mode drivers leave status to staff catchup absorbed by G-003/G-004). |
| 10 | 2 | 2 | 2 | 2 | 2 | Off-season. User picked Rec A (browse-only freeze). Capture records season switch, banner + reopening note, all-years browsable, cart/checkout/POS disabled, accounts frozen — every A element preserved without embellishment. |
| 11 | 2 | 2 | 2 | 2 | 2 | Repeat-order unmapped replacements. User picked Rec A. Capture preserves mapped-pre-filled speed path, unmapped-highlighted safety net, draft-cannot-complete-until-pick-or-drop, and "nothing silently removed" — and links replacement-mapping at item setup (G-018) as a first-class catalog feature. |

**Fluff turns:** none. All 11 turns address a real seed decision; the agent also surfaces 6 OPEN items and 7 not-covered topics in the Close block rather than padding turns.

## Turn quality

- Per-turn mean = sum of 5 dimensions / 5 (0–2 scale).
- All 11 turns: 11/5 × 2 = **2.00 / 2**

**turn_quality_mean** = **2.00 / 2**

**necessary_turns** = 11

## Recommended-used rate (fact only)

User picked the model's Recommended option cleanly in: T10, T11 → **2 / 11 = 18.2%**.

Non-recommended picks: T1 (D over Rec A), T2 (A+B over Rec A), T3 (B over Rec A), T4 (own-words hybrid over Rec A), T5 (C over Rec A), T7 (A with notify rejected — partial non-rec), T8 (C over Rec A), T9 (B+C over Rec A).

User-enhanced pick: T6 (Rec A + "option for eventual B" — rec core retained with explicit future-option addition).

## Grill inventory quality

Evidence base: transcript only (turn cites). 18 features (G-001..G-018), 2 governing constraints (T1, T2 — locked, not features), 6 OPEN items (O-001..O-006). O-001 and O-002 honestly carry no feature row because their topics (shipping markup, delivery-window mechanics) never surfaced in T1–T11 — flagged rather than invented.

- **Coverage / usefulness (0–4): 3** — every turn maps to at least one feature, and the two cross-cutting governing constraints (T1, T2) are correctly separated from the feature rows rather than smuggled in as features. Cross-turn stitching exists: G-003/G-004 absorb T9's list-mode driver status back into the T4/T5 catchup/exception model; G-017/G-018 link T11's confirmation page to item-setup replacement mapping; G-007 carries the no-leak-in-customer-views constraint forward. All 11 user decisions are captured with their distinguishing nuance in the Notes column (paper-as-record + rejected A-elements in G-001, live-first + paper-catchup in G-002/G-003, manager-mediated lock in G-004, silent-switch + no-leak in G-007, reserved-unpaid + auto-release in G-008/G-010, both driver modes + rejected A in G-013, browse-only freeze in G-015). The 6 OPEN items are explicitly enumerated and each tied to the feature that carries it (O-003→G-010, O-004→G-003, O-005→G-008, O-006→G-006). The Close block's not-covered list is fully preserved as a separate section. **Why not 4:** the granularity is meaningfully coarser than the transcript density supports — 18 features for 11 turns (~1.6/turn) vs the top arm's ~10/turn. Several features bundle decisions that could stand alone: G-001 bundles the whole nightly print batch (one-tap confirmations rejected, free reprints rejected, paper-as-record, after-the-fact catchup) into one row; G-007 bundles the silent switch + no-refund + no-leak constraint; G-008 bundles reserve-immediately + batch-gating + new states. The nuances are preserved in Notes, but as discrete inventory rows for the downstream plan/build phases they are less mined than they could be — a planner pulling rows from this inventory gets fewer atomic decisions to schedule.
- **Anti-hallucination (0–3): 3** — every row carries transcript turn cites; spot-checks match the user's "I heard" lines. No fabricated features: G-001 explicitly notes A's one-tap confirmations / free reprints were NOT picked (does not invent them as in-scope); G-006 flags component-level inventory as a future option, not v1; G-010 marks the "5 days before Purim" deadline as illustrative, not locked; O-001/O-002 honestly carry no feature row because their topics never surfaced — the inventory says so explicitly rather than inventing a carrier-feature. No agent-taken decisions are smuggled into human rows; the two governing constraints (T1, T2) sit in their own section. No contradictions between rows. This is exactly the anti-hallucination posture the rubric asks for.

**inventory_score** = 3 + 3 = **6 / 7**

## Combined scores

```
grill_quality    = inventory_score × (turn_quality_mean / 2)
                 = 6 × (2.00 / 2) = 6.00 / 7
grill_efficiency = inventory_score / max(1, necessary_turns)
                 = 6 / 11 = 0.545
```

**Scorecard mapping (8-point scale):** 6.00 / 7 × 8 = 6.86 → **6.5 / 8** (orchestrator-normalized; held slightly below the linear 6.86 to reflect the coarser feature granularity relative to transcript density).

## Summary

| Metric | Value |
|---|---|
| Turns graded | 11 |
| Fluff turns | 0 |
| necessary_turns | 11 |
| turn_quality_mean | 2.00 / 2 |
| Coverage | 3 / 4 |
| Anti-hallucination | 3 / 3 |
| inventory_score | 6 / 7 |
| grill_quality | 6.00 / 7 |
| grill_efficiency | 0.545 |
| scorecard points | 6.5 / 8 |
| Recommended-used rate | 18.2% (2/11) |

**OPEN handling note:** All 6 OPEN decisions are honest flags for items the transcript explicitly left unresolved (Close block: shipping markup, delivery-window mechanics, check/cash deadline specifics, batch-catchup UX shape, POS scope, migration timeline). No OPEN row invents a default that contradicts the transcript; no OPEN row suppresses a settled decision. O-001 and O-002 honestly carry no feature row because their topics never surfaced in T1–T11 — the inventory says so rather than fabricating a carrier. Per the prompt's instruction, OPEN rows are not penalized.

**Verdict:** arm-06's grill is a clean 11-turn sweep at full marks on every per-turn dimension. Every turn reduced real ambiguity, options fit the product, and uptake was faithful — including eight non-recommended picks (T1, T2, T3, T4, T5, T7, T8, T9) the agent honored without relitigating, one user-enhanced pick (T6, Rec A + future B option) incorporated cleanly, and one own-words hybrid (T4) the agent captured as a hybrid rather than force-fitting to A. The grill inventory is correct, honest, and well-structured (governing constraints separated, OPEN items enumerated with blocking-feature links, not-covered list preserved) — but it is the coarsest-grained of the late-join arms (18 features for 11 turns), bundling several decisions per row that could stand alone. Anti-hallucination is flawless (no fabricated features, no silent rewrites, rejected-option elements explicitly flagged as NOT picked). With the inventory produced, the scorecard unlocks at **6.5 / 8** — strong on quality (6.00/7) but held back from the top by coarser coverage and lower efficiency (0.545, 11 turns vs the top arm's 10 for the same seed decision-space).
