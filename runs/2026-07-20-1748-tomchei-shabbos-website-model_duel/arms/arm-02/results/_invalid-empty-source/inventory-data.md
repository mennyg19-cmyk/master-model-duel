# Codebase inventory — arm-02 (partial: data)

## Proof-of-read
- Rules files read: 4 (AGENTS.md, workflow.mdc, ponytail.mdc, vocabulary.mdc)
- Top-level dirs sampled: source root (full listing — only `README.md` + `.git/` exist)

## Job scope

DATA — persistence, schemas, migrations, files/blob storage, caching.

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| — | *(none found)* | — | See "Blocked / empty source" below. |

**Feature count: 0.**

## Blocked / empty source

The source tree at `D:\Projects\Personal\Tools\agent-duel-harness\.scratch\sources\Tomchei-Shabbos-Website` contains exactly one file: `README.md` (25 bytes, single title line `# Tomchei-Shabbos-Website`). There is no application code of any kind.

Checks performed (read-only):
- Full recursive listing including hidden files: only `README.md` and `.git/`.
- The `.git` pack is 891 bytes — small enough that the repository history cannot contain more than the README itself. This is not a failed checkout; the repository is genuinely empty of code.
- Consequently there are no databases, ORM models, schema files, migrations, seed data, file/blob storage handling, or caching layers to inventory.

Per hard rule 1 (every ID needs an evidence path; no invented features), zero data features are recorded. The orchestrator should verify the intended source repository/branch was cloned — if the product code lives elsewhere (different branch or repo), Test 1a needs a re-run against the correct source.
