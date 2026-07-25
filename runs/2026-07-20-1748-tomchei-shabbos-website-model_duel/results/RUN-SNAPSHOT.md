# Run snapshot — `2026-07-20-1748-tomchei-shabbos-website-model_duel`

**UTC snapshot:** 2026-07-21T23:10:00Z (approx)

## Status — arm-03 late join **complete**

| Item | Value |
|---|---|
| Original winner | arm-02 **74.5**/100 · arm-01 **72.0**/100 |
| Late join | **arm-03** `cursor-grok-4.5-high` (grok) · ports 3103/4103 |
| arm-03 base total | **69.5**/100 (+ bonus_plan, inv_novel=2) |

## Late-join pipeline

| Test | Status |
|---|---|
| 1a | **gated** — 6/7 + bonus_novel=2 |
| 1b | **gated** — 8/8 |
| 2 | **gated** — 15/15 + bonus_plan |
| 4 | **complete** — P1–P12 **18.0/20** |
| 5 | **gated** — **7.5/15** (corrected after residual aggregate + grade) |
| 6 | **rerun complete** — detect 5/5 · vague fix 5/5 · **15.0/15** |

## Status — arm-04 late join **in progress**

**UTC:** 2026-07-25T19:50:00Z

| Item | Value |
|---|---|
| Late join | **arm-04** `claude-opus-5-thinking-medium` (claude-opus) · ports 3104/4104 |
| Join point | after Test 6, same as arm-03 |
| Rules | frozen shared pack (ponytail, clean-code, workflow, vocabulary, codegraph) |

| Test | Status |
|---|---|
| 1a | **blocked** — source codebase unreachable from the cloud orchestrator VM |
| 1b | **blocked** — grill is a live interview |
| 2 | **plan written** ([BUILD-PLAN](../arms/arm-04/results/BUILD-PLAN.md), 16 phases P0–P15) · **grade pending** — reviewer `glm-5.2-high` not spawnable in that VM |
| 4 | not started — builds from frozen `shared/MERGED-BUILD-PLAN.md` (12 phases), not arm-04's own plan |
| 5 | not started |
| 6 | not started — would be a fresh rerun wave on the arm-02 clone (arm-01/02/03 scores frozen) |

See [DEVIATIONS.md](./DEVIATIONS.md) for the three host limits.

See [SCOREBOARD.md](./SCOREBOARD.md)
