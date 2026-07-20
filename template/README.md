# Execution kit (frozen templates)

Copied into each run as `runs/{id}/kit/` at bootstrap.

| Folder | Contents |
|---|---|
| `prompts/` | Contestant + reviewer frozen briefs |
| `rubrics/` | Score sheets, SCOREBOARD, FINAL-REPORT |
| `smoke/` | Phase EXPECTED, smoke checklist, phase map |
| `test6/` | Bug seed procedure + ledger template |
| `orchestrator/` | RUN-STATE, spawn checklist, cost how-to |

Also: `template/arm/` → per-arm AGENTS + base prompt.

Orchestrator always fills placeholders from `prompts/README.md` before spawning.
