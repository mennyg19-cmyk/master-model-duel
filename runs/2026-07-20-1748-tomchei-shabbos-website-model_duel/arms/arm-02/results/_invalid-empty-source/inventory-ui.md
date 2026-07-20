# Codebase inventory — arm-02 (partial: ui)

**Job:** ui — routes, layouts, navigation, forms, client-only state

## Proof-of-read
- Rules files read: 6 present in `.cursor/rules/` (workflow, vocabulary, ponytail read in full; clean-code, codegraph, grill-protocol present)
- Top-level dirs sampled: entire source tree listed recursively — working tree contains only `README.md` (plus `.git/`)

## Source state (blocked area)

The source codebase at `.scratch/sources/Tomchei-Shabbos-Website` is an **empty starter repository**:

- Working tree: one file, `README.md` (25 bytes, contains only the title `# Tomchei-Shabbos-Website`)
- `git ls-tree -r HEAD`: only `README.md` (verified read-only; no checkout missing — the repo genuinely has no code)
- Git pack is 891 bytes — consistent with a single-commit repo containing one small file

There are no routes, layouts, navigation, forms, pages, components, or client-side state anywhere in the tree. No framework, no `package.json`, no HTML/JS/CSS.

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| — | (none) | — | No UI features exist in the source. Zero features inventoried; none invented per hard rule 1. |

## Notes for merge agent

UI slice is empty because the whole repo is empty, not because UI specifically is missing. Expect the data/security/integrations/product slices to report the same. If a different revision or repo was intended as the source, the orchestrator should re-point the source path and rerun 1a.
