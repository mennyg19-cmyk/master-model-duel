# Generic host

For any multi-model tool that is not Cursor or OpenCode.

## Bootstrap

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-run.ps1 -KickoffYaml "…" -DuelHost generic
```

Each arm gets `rules/*.md` + a plain `AGENTS.md` telling the agent to read those files. No `.cursor/`, no `opencode.json`.

## Your job

Whatever your tool’s equivalent is of “new chat + pick model + attach folder,” point it at the arm directory, paste `kit/prompts/…`, log cost by hand.
