# Smoke / phase-gate kit

Copy into `runs/{run_id}/shared/smoke/` at bootstrap.

## Files

| File | Use |
|---|---|
| `PHASE-EXPECTED.template.md` | Copy per phase → `shared/phases/PHASE-__ID__-EXPECTED.md` **before** arms build that phase |
| `smoke-checklist.template.md` | HTTP/UI checks arms must pass |
| `phase-map.template.md` | Equal phase IDs for all arms after plan merge |

Orchestrator fills templates; contestants must not edit the shared EXPECTED after build starts (they may mirror into workspace scratch).
