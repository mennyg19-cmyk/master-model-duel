# OpenCode host

Run the **same duel** in [OpenCode](https://opencode.ai) (multi-model). Rules become `AGENTS.md` + `rules/*.md` + `opencode.json` `instructions` — not `.cursor/rules`.

## One-time setup

1. Install OpenCode and configure providers (Anthropic, OpenAI, Gemini, etc.).  
2. Open **this repo** in OpenCode.  
3. Ensure root `AGENTS.md` is present (orchestrator instructions — already in repo).  
4. Put OpenCode model ids in `catalog/MODEL-FAMILIES.json` under each family’s `hosts.opencode` list (examples included; edit to match your providers).

## Start a run

1. In OpenCode chat: **start testing** (same kickoff questions).  
2. When writing `KICKOFF.yaml`, set `host: opencode` and use **OpenCode model ids** (e.g. `anthropic/claude-sonnet-4-20250514`) that appear under `hosts.opencode` for that family.  
3. Bootstrap:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-run.ps1 -KickoffYaml "runs/{id}/KICKOFF.yaml" -DuelHost opencode
```

Each arm gets:

| Path | Purpose |
|---|---|
| `AGENTS.md` | Contestant always-on + rule pack |
| `rules/*.md` | Selected catalog rules (plain markdown) |
| `opencode.json` | `"instructions": ["rules/*.md"]` so OpenCode loads them |
| `workspace/` | Build tree |
| `results/` | Arm deliverables |

## How to spawn (orchestrator)

Prefer **`scripts/spawn-agent.ps1 -DuelHost auto`** (see `adapters/AUTO.md`). That runs:

```text
opencode run --model <id> --file <filled-prompt.md> "…"
```

inside the arm directory. Interactive sessions are optional for debugging only.

## Cost (hard gate)

After every `opencode run` / spawn, run `scripts/append-cost-ledger.ps1` with whatever usage the CLI printed (or blank + `usage_missing_pending_export`). Next spawn waits on that row. See `results/COST-LEDGER-HOWTO.md`.

### Focused specialists / grill interleave

Same protocol files. One OpenCode session per specialist job; merge agent is another session.

## Rules duel on OpenCode

Same as Cursor: different packs → different `rules/*.md` per arm; **same** `contestant_model` OpenCode id.

## If something feels “Cursor-only”

Ignore `.cursor/` in this repo when on OpenCode. Orchestrator truth is `AGENTS.md` + `adapters/opencode/` + `protocol/`.
