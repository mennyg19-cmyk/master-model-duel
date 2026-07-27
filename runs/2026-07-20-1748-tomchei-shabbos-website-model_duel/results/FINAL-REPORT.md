# FINAL-REPORT — `2026-07-20-1748-tomchei-shabbos-website-model_duel`

**Published:** 2026-07-21 · **Updated:** 2026-07-27 (arm-04 late join complete)  
**Mode:** model_duel  
**Source:** Tomchei Shabbos mishloach manos rebuild (greenfield)  
**Reviewer family:** glm (`glm-5.2-high`)

## Mapping reveal

| Arm | Model | Pack / rules |
|---|---|---|
| arm-01 | `gpt-5.6-sol-medium` (gpt-sol) | ponytail, clean-code, workflow, vocabulary, codegraph |
| arm-02 | `claude-fable-5-thinking-medium` (claude-fable) | ponytail, clean-code, workflow, vocabulary, codegraph |
| arm-03 | `cursor-grok-4.5-high` (grok) | ponytail, clean-code, workflow, vocabulary, codegraph — **late join** |
| arm-04 | `claude-opus-5-thinking-high` (claude-opus) | ponytail, clean-code, workflow, vocabulary, codegraph — **late join** |

## Dual headlines

1. **Best with external reviewer:** **arm-02** — 62/65 raw on Tests 1+2+4+6 → **95.4/100** renormalized (Test 3 not run). Late arm-04: 59/65 → 90.8.  
2. **Best solo commit:** **arm-04** — 44/45 on Tests 1+2+5 → **97.8/100** renormalized. Originals: arm-02 41.5/45 → 92.2.  
3. **Best interviewer (1b):** **arm-04** — tie 8/8 grill score; wins efficiency (0.70 on 10 turns) and turn-quality (2.00).

**Disagreement:** External-reviewer headline stays **arm-02**; solo commit flips to late-join **arm-04**.

## Scoreboard

| Arm | 1a /7 | 1b /8 | 2 /15 | 3 /20 | 4 /20 | 5 /15 | 6 /15 | Total /100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| arm-01 | 5 | 8 | 14 | — | 18.0 | 12.0 | **15.0** | **72.0** |
| arm-02 | 7 | 8 | 14 | — | 18.0 | 12.5 | **15.0** | **74.5** |
| arm-03 | 6 | 8 | 15 | — | 18.0 | 11.0 | **11.0** | **69.0** |
| arm-04 | **7** | **8** | **15** | — | **18.0** | **14.0** | **11.0** | **73.0** |

Late join **arm-04** (`claude-opus-5-thinking-high`): Tests 1a–2 + 4–6 complete; Test 3 skipped. Bonuses: `inv_novel=6`, `bonus_plan`. Test 6 rerun: detect 4/8 (missed B4 checkout/start) + vague fix 7/7 → **11.0/15**.

## Dual inventory

Grill on. arm-02 led original codebase inventory recall; arm-04 tied 7/7 with inv_novel=6. User resolved via [shared/USER-RESOLVED-INVENTORY.md](../shared/USER-RESOLVED-INVENTORY.md) after [shared/INVENTORY-COMPARISON.md](../shared/INVENTORY-COMPARISON.md) — **frozen** for late joins.

## Cost

See [COST-LEDGER.csv](./COST-LEDGER.csv). Backfilled from Cursor usage export (2026-07-27); `verify-cost-ledger -RequireUsage` → ok. Scoreboard Cost: arm-01 **$106.82** · arm-02 **$319.83** · arm-03 **$33.72** (reviewer-only; grok builder rows plan-`Included`) · arm-04 **$663.03**.

## Method notes / deviations

- [DEVIATIONS.md](./DEVIATIONS.md) — Test 3 not run; Test 6 reruns for arm-03/arm-04 clone arm-02 + same B1–B5.  
- Shared freezes (reconciled inventory, merged plan, phase EXPECTED) not rewritten by late joins.

## Artifacts

| Artifact | Path |
|---|---|
| Reconciled inventory | [shared/RECONCILED-INVENTORY.md](../shared/RECONCILED-INVENTORY.md) |
| User-resolved inventory | [shared/USER-RESOLVED-INVENTORY.md](../shared/USER-RESOLVED-INVENTORY.md) |
| Merged build plan | [shared/MERGED-BUILD-PLAN.md](../shared/MERGED-BUILD-PLAN.md) |
| arm-01 final workspace | [arms/arm-01/workspace/](../arms/arm-01/workspace/) (post Test 6 fix) |
| arm-02 final workspace | [arms/arm-02/workspace/](../arms/arm-02/workspace/) (post Test 6 fix) |
| arm-03 final workspace | [arms/arm-03/workspace/](../arms/arm-03/workspace/) (late join; post Test 6 rerun) |
| arm-04 final workspace | [arms/arm-04/workspace/](../arms/arm-04/workspace/) (late join; post Test 6 rerun) |

**Overall winner among original arms (Test 3 excluded): arm-02** at 74.5/100.  
**Late join arm-04** scored **73.0**/100 (between arm-01 and arm-02 on total; leads solo-commit and interviewer headlines).
