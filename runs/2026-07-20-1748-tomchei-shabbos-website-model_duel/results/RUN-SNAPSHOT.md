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
| 1a inventory vs freeze + bonus | **4/5** — [security ✓](c487deb1-fe75-4bb0-92c1-c712c38faf29) · [data ✓](27232527-d19a-4e00-a183-6717d30f0392) · [ui ✓](0357cd8a-d765-4e35-a395-f8265dc3fa58) · [integrations ✓](e9d5c24b-af69-47b5-9b50-e86f009cba74) · [product](9ee64973-a9d9-4c80-befb-51707b3c7cc6) pending |
| 1b grill | pending |
| 2 plan (not merged) + bonus_plan | pending |
| 4 build from merged plan | pending (Test 3 skipped like originals) |
| 5 self-review | pending |
| 6 detect/fix | **ask user** — originals already gated (skip vs fresh wave) |

See [SCOREBOARD.md](./SCOREBOARD.md) · [FINAL-REPORT.md](./FINAL-REPORT.md) · protocol/LATE-JOIN.md
