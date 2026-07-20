# Codebase inventory — arm-02 (partial: integrations)

**Job:** integrations — external APIs, webhooks, email, payments, cron/jobs.

## Proof-of-read

- Rules files read: 4 (AGENTS.md, ponytail.mdc, vocabulary.mdc, workflow.mdc)
- Top-level dirs sampled: entire source tree — it contains only `README.md` (git tree of HEAD confirms: one tracked file, single commit `ff9f735 "Initial commit"`, single branch `main`)
- Files read: `README.md` (full contents: `# Tomchei-Shabbos-Website`)

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| — | none | — | No integration features exist in the source. |

**Feature count: 0.**

## Findings

The source codebase at `D:\Projects\Personal\Tools\agent-duel-harness\.scratch\sources\Tomchei-Shabbos-Website` is an empty scaffold: the only file is a one-line `README.md` with the project title. Verified via directory listing and `git ls-tree -r HEAD` (single file) plus `git log --all` (single commit, no other branches).

There is no application code, no config, no dependency manifest — therefore no external API calls, webhooks, email sending, payment processing, or cron/scheduled jobs to inventory. Per hard rule 1 (every ID needs an evidence path; no invented features), the features table is intentionally empty.

## Blocked areas

None blocked by access — the tree was fully readable. The slice is empty because the product has not been built yet, not because anything was unreadable.
