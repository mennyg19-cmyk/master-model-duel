# FINAL-REPORT — `2026-07-20-1748-tomchei-shabbos-website-model_duel`

**Published:** 2026-07-21  
**Mode:** model_duel  
**Source:** Tomchei Shabbos mishloach manos rebuild (greenfield)  
**Reviewer family:** glm (`glm-5.2-high`)

## Mapping reveal

| Arm | Model | Pack / rules |
|---|---|---|
| arm-01 | `gpt-5.6-sol-medium` (gpt-sol) | ponytail, clean-code, workflow, vocabulary, codegraph |
| arm-02 | `claude-fable-5-thinking-medium` (claude-fable) | ponytail, clean-code, workflow, vocabulary, codegraph |
| arm-03 | `cursor-grok-4.5-high` (grok) | ponytail, clean-code, workflow, vocabulary, codegraph — **late join** |

## Dual headlines

1. **Best with external reviewer:** **arm-02** — 62/65 raw on Tests 1+2+4+6 → **95.4/100** renormalized (Test 3 not run; see deviations).  
2. **Best solo commit:** **arm-02** — 41.5/45 on Tests 1+2+5 → **92.2/100** renormalized.  
3. **Best interviewer (1b):** **arm-02** — tie 8/8 grill score; wins turn-quality tie-break (2.00 vs 1.98).

**Agreement:** Both headlines pick **arm-02**. No disagreement.

## Scoreboard

| Arm | 1a /7 | 1b /8 | 2 /15 | 3 /20 | 4 /20 | 5 /15 | 6 /15 | Total /100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| arm-01 | 5 | 8 | 14 | — | 18.0 | 12.0 | **15.0** | **72.0** |
| arm-02 | 7 | 8 | 14 | — | 18.0 | 12.5 | **15.0** | **74.5** |
| arm-03 | 6 | 8 | 15 | — | 18.0 | 7.5 | **15.0** | **69.5** |

Late join **arm-03** (`cursor-grok-4.5-high`): Tests 1a–2 + 4–6 complete; Test 3 skipped. Bonuses: `inv_novel=2`, `bonus_plan`. Test 6 rerun on arm-02 clone + same B1–B5 seeds.

## Dual inventory

Grill on. arm-02 led codebase inventory recall (7/7 vs 5/7). Grill inventories differed in granularity; user resolved via [shared/USER-RESOLVED-INVENTORY.md](../shared/USER-RESOLVED-INVENTORY.md) after [shared/INVENTORY-COMPARISON.md](../shared/INVENTORY-COMPARISON.md).

## Cost

See [COST-LEDGER.csv](./COST-LEDGER.csv). Usage backfill pending (`usage_missing_pending_export` on most rows).

## Method notes / deviations

- [DEVIATIONS.md](./DEVIATIONS.md) — Test 3 (build no feedback) **not run** despite full suite kickoff; external-reviewer headline renormalized without Test 3.  
- Test 6 cloned **arm-02** headline winner tree to both arms; five seeded bugs; detect 5/5 both arms; vague fix 5/5 both arms.

## Artifacts

| Artifact | Path |
|---|---|
| Reconciled inventory | [shared/RECONCILED-INVENTORY.md](../shared/RECONCILED-INVENTORY.md) |
| User-resolved inventory | [shared/USER-RESOLVED-INVENTORY.md](../shared/USER-RESOLVED-INVENTORY.md) |
| Merged build plan | [shared/MERGED-BUILD-PLAN.md](../shared/MERGED-BUILD-PLAN.md) |
| arm-01 final workspace | [arms/arm-01/workspace/](../arms/arm-01/workspace/) (post Test 6 fix) |
| arm-02 final workspace | [arms/arm-02/workspace/](../arms/arm-02/workspace/) (post Test 6 fix) |
| arm-03 final workspace | [arms/arm-03/workspace/](../arms/arm-03/workspace/) (late join; post Test 6 rerun) |

**Overall winner (original arms, Test 3 excluded): arm-02** at 74.5/100. Late join arm-03 scored **69.5/100** (below both original arms on base total; Test 5 residual 7.5/15 after security-blocker residual panel).
