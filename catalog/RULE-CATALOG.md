# Rule catalog (ablation packs)

At kickoff the orchestrator **reads this table and scans `catalog/rules/*.mdc`**, then asks which IDs to include. That is the only source of selectable rules — not a memorized shortlist.

| ID | File | Default | What it does |
|---|---|---|---|
| `ponytail` | `ponytail.mdc` | on | Brevity, YAGNI ladder, anti-slop |
| `clean-code` | `clean-code.mdc` | on | Naming, Rule of 2, consistency, anti-AI tics |
| `workflow` | `workflow.mdc` | on | Read-before-edit, verify-in-app, gates, PowerShell |
| `git-discipline` | `git-discipline.mdc` | **off for contestants** | Contestants never git; keep off in arms. Orchestrator uses harness rules instead |
| `vocabulary` | `vocabulary.mdc` | on | Command meanings (tidy/refactor/…) |
| `codegraph` | `codegraph.mdc` | on | Prefer CodeGraph for structure when indexed |
| `testing-protocol` | `testing-protocol.mdc` | optional | Tests-alongside-code expectations |
| `context-canary` | `context-canary.mdc` | optional | Context-rot canary (ablation target) |
| `deploy-awareness` | `deploy-awareness.mdc` | optional | Deploy/env discipline |
| `session-handoff` | `session-handoff.mdc` | optional | HANDOFF format |
| `autonomous-mode` | `autonomous-mode.mdc` | optional | DECISION-LOG when unattended |
| `prose-deslop` | `prose-deslop.mdc` | optional | Long-form prose pass |
| `interface-kit` | `interface-kit.mdc` | optional | UI craft |
| `grill-protocol` | `grill-protocol.mdc` | **off for builders**; **on for Test 1b grill agents** | Planning interview — auto-attached for grill inventory even if off in the shared pack |
| `plan-review` | `plan-review.mdc` | **off** | Senior plan review — reviewer-side |

**Never copy into contestant arms:** `rebuild-protocol`, `redesign-protocol`, `review-protocol`, `subagents` — those are harness/orchestrator concerns. Contestants get the duel prompts instead.

Source copies live in `catalog/rules/`. Bootstrap copies only the selected IDs into each arm (`catalog/rules/{id}.mdc` → `arms/.../.cursor/rules/`).

---

## Add your own rules

Anything you drop in the catalog becomes selectable on the **next** kickoff.

1. Add `catalog/rules/{id}.mdc` (Cursor rule file; `id` = filename without `.mdc`).  
2. Add a row to the table above (ID, file, default on/off/optional, one-line what it does).  
3. Say **start testing** (or **add pack** / late-join rules). The orchestrator must list **every** catalog ID when asking what to include — your rule will appear with the stock ones.

Do **not** paste one-off rules only into an arm folder. Arms are regenerated from the catalog at bootstrap; uncatalogued files won’t be offered and won’t survive a clean arm create.
