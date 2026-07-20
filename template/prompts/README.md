# Contestant prompt pack

Frozen briefs. Orchestrator copies the relevant file into the arm (or pastes it) and replaces placeholders.

| Placeholder | Meaning |
|---|---|
| `__ARM_ID__` | e.g. arm-01 |
| `__WORKSPACE__` | absolute path to arm workspace |
| `__SOURCE__` | source codebase (Test 1a only) |
| `__INVENTORY__` | path to frozen inventory for this spawn |
| `__PLAN__` | path to MERGED-BUILD-PLAN.md |
| `__PHASE_ID__` | phase id from phase map |
| `__PHASE_EXPECTED__` | path to phase EXPECTED checklist |
| `__WEB_PORT__` / `__DB_PORT__` | from ARM.md |
| `__GRILL_SEED__` | kickoff grill seed |
| `__TRANSCRIPT__` | GRILL-TRANSCRIPT path |
| `__AGGREGATE_REVIEW__` | AGGREGATE-REVIEW.md path |
| `__TREE__` | finished tree path for self-review / Test 6 |
| `__BUG_SYMPTOMS__` | vague symptoms only (Test 6 fix) |

**Rule:** Do not edit these files mid-run. Fork a dated copy under `runs/{id}/.scratch/prompts/` only if the user explicitly changes the protocol (log DEVIATIONS).
