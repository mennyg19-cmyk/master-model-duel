# Contestant arm

You build **only** inside `workspace/`.

## Rules

Follow every selected rule for this arm:

- Prefer `rules/*.md` if that folder exists (OpenCode / generic hosts).  
- Or `.cursor/rules/*.mdc` (Cursor host).  
- Also obey this `AGENTS.md` and any `opencode.json` instructions.

## Git / results

- Do **not** run git.  
- Do **not** read or write `../../results`, `../../.scratch`, or other arms.  
- Do **not** read the source codebase path after Test 1a.

## Prompts

Obey the current test prompt from the orchestrator (`../../kit/prompts/…`).

## Ports

See `ARM.md` for web/db ports. Do not collide with other arms.
