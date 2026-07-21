# Run snapshot — `2026-07-20-1748-tomchei-shabbos-website-model_duel`

**UTC snapshot:** 2026-07-21T22:20:00Z (approx)

## Status — late join in progress

| Item | Value |
|---|---|
| Original winner | arm-02 **74.5**/100 · arm-01 **72.0**/100 |
| Late join | **arm-03** `cursor-grok-4.5-high` (grok) · ports 3103/4103 |
| Freezes | RECONCILED-INVENTORY · USER-RESOLVED · MERGED-BUILD-PLAN unchanged |

## Late-join pipeline

| Test | Status |
|---|---|
| 1a inventory vs freeze + bonus | **gated** — 6/7 (164/192); bonus_novel=2 |
| 1b grill | **gated** — 8/8 |
| 2 plan (not merged) + bonus_plan | **gated** — 15/15 + bonus_plan |
| 4 build from merged plan | **P1–P11 ✓ gated** · **P12 build in flight** · Tests 5-6 pending |
| 5 self-review | pending |
| 6 detect/fix | **rerun** (arm-03 only) — arm-02 clone + B1–B5 seeds; arm-01/02 frozen |

See [SCOREBOARD.md](./SCOREBOARD.md) · protocol/LATE-JOIN.md
