# Run snapshot — `2026-07-20-1748-tomchei-shabbos-website-model_duel`

**UTC snapshot:** 2026-07-21T13:35:00Z (approx)

## Status — late join in progress

| Item | Value |
|---|---|
| Original winner | arm-02 **74.5**/100 · arm-01 **72.0**/100 |
| Late join | **arm-03** `cursor-grok-4.5-high` (grok) · ports 3103/4103 |
| Freezes | RECONCILED-INVENTORY · USER-RESOLVED · MERGED-BUILD-PLAN unchanged |

## Late-join pipeline

| Test | Status |
|---|---|
| 1a inventory vs freeze + bonus | **gated** — 6/7 (164/192); bonus_novel=2 — [grade](344a7406-a4ee-466a-80a1-bea705eb7945) |
| 1b grill | pending |
| 2 plan (not merged) + bonus_plan | pending |
| 4 build from merged plan | pending (Test 3 skipped like originals) |
| 5 self-review | pending |
| 6 detect/fix | **rerun** (arm-03 only) — same arm-02 clone + B1–B5 seeds; arm-01/02 scores frozen |

See [SCOREBOARD.md](./SCOREBOARD.md) · [FINAL-REPORT.md](./FINAL-REPORT.md) · protocol/LATE-JOIN.md
