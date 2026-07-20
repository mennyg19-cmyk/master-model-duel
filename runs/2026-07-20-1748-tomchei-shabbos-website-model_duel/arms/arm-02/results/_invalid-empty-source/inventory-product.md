# Codebase inventory — arm-02 (job: product)

## Proof-of-read
- Rules files read: 6 (`workflow.mdc`, `vocabulary.mdc`, `grill-protocol.mdc`, `codegraph.mdc`, `ponytail.mdc`, `clean-code.mdc`) + arm `AGENTS.md`
- Top-level dirs sampled: entire source tree enumerated recursively — working tree contains only `README.md` (plus `.git/` metadata)

## Source state

The source repo at `.scratch/sources/Tomchei-Shabbos-Website` is an **empty starter repo**:

- Working tree: a single file, `README.md`, containing only the line `# Tomchei-Shabbos-Website`.
- Git pack is 891 bytes (one clone commit on `main`), so the history holds no additional code — nothing was deleted or hidden.
- No source code, no routes, no screens, no config, no dependency manifests.

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| — | *(none)* | — | No user-facing features exist. The only file is `README.md` with the project title; it defines no flows, screens, or permissions. Hard rule 1 (no invented features) means the product slice is empty. |

**Feature count: 0**

## Blocked areas

- Entire product inventory is blocked by an empty codebase: there is no application code to derive user-facing behavior from. Any product definition for "Tomchei Shabbos Website" would have to come from a grill/interview, not from this source tree.
