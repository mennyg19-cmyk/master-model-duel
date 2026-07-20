# Rule catalog (ablation packs)

At kickoff the user picks which rule files land in **every** contestant arm’s `.cursor/rules/`. Same set for all arms in a run (fair ablation). Different runs can pick different packs.

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
| `grill-protocol` | `grill-protocol.mdc` | **off** | Planning interview — not for builders |
| `plan-review` | `plan-review.mdc` | **off** | Senior plan review — reviewer-side |

**Never copy into contestant arms:** `rebuild-protocol`, `redesign-protocol`, `review-protocol`, `subagents` — those are harness/orchestrator concerns. Contestants get the duel prompts instead.

Source copies live in `catalog/rules/`. Bootstrap copies only the selected IDs into each arm.
