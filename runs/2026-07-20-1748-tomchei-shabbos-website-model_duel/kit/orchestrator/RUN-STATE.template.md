# Run state — `__RUN_ID__`

Update after every gate. Bootstrap seeds this file.

```
protocol: feature
phase: kickoff|1a|1b|user_resolve|2|3|4|5|6|final
last_gate_passed: none
open_blocked: none
last_commit: n/a
next_action: start Test 1a or run test N
include_grill_inventory: true|false
```

## Checklist

| Step | Status | Evidence |
|---|---|---|
| Bootstrap | | KICKOFF.yaml |
| 1a inventories | | arms/*/results/CODEBASE-INVENTORY.md |
| 1a reconcile + grade | | shared/RECONCILED-INVENTORY.md |
| 1b grill transcripts | | GRILL-TRANSCRIPT.md |
| 1b grill inventories | | GRILL-INVENTORY.md |
| 1b turn grades | | results/reviews/grill-turns-* |
| Inventory comparison → user | | shared/INVENTORY-COMPARISON.md |
| User resolved inventory | | shared/USER-RESOLVED-INVENTORY.md |
| 2 plans + merge | | MERGED-BUILD-PLAN.md |
| Phase map + EXPECTED | | shared/phases/ |
| 3 build complete | | |
| 4 build complete | | |
| 5 self-review + residual | | |
| 6 detect + vague fix | | |
| SCOREBOARD + FINAL-REPORT | | |

## Grill interleave

If 1b: alternate human turns across arms (A Q1 → B Q1 → A Q2 …) when possible. Log order here.

## tests_selected

From post-bootstrap multi-select (see kickoff/ASK-UI.md):

```
tests_selected: suite | 1a,1b,2,...
```
