# Run snapshot — `2026-07-20-1748-tomchei-shabbos-website-model_duel`

**UTC snapshot:** 2026-07-21T16:15:00Z (approx)

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
| 1b grill | **gated** — 8/8 (turn_quality 1.985; T12 explain-down dock) — [grade](d8d77458-bf6d-4daa-a484-ef0af94c7f05) |
| 2 plan (not merged) + bonus_plan | **gated** — 15/15 + bonus_plan — [review](5eafd426-7bd7-4ba8-872f-4ac8ae110dc3) |
| 4 build from merged plan | **P1-P7 ✓ gated** · **P8-P12 + Tests 5-6 in flight** (7/12) |
| 5 self-review | pending |
| 6 detect/fix | **rerun** (arm-03 only) — same arm-02 clone + B1–B5 seeds; arm-01/02 scores frozen |

See [SCOREBOARD.md](./SCOREBOARD.md) · [FINAL-REPORT.md](./FINAL-REPORT.md) · protocol/LATE-JOIN.md
