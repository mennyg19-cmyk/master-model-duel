# Kickoff ask UI (less typing)

## Priority

1. **If the `AskQuestion` tool is in your tool list** → use it for every fixed-choice kickoff step (one question per turn). Clickable UI.  
2. **If `AskQuestion` is missing** (common on some models, including Grok) → use the **short-reply fallback** below. Do **not** tell the user to “switch chats” unless they asked for clickable cards and you know another model in their account has AskQuestion.

## When AskQuestion is available (Cursor)

**Do:**
- Call `AskQuestion` once per turn  
- Short option labels  
- At most one escape: `Something else (I will type it)`  
- **Contestant models:** `allow_multiple: true` (multi-select), require **≥2** selections  

**Don’t:**
- “Reply A or B”  
- Markdown option tables for typing letters  
- One-model-at-a-time yes/no when multi-select is possible  

## Short-reply fallback (no AskQuestion)

Ask **one** question. Options are **one-word / short-phrase** answers the user can tap-send or type fast — not “A or B”.

Example for Q0:

> What are you comparing? Reply with one of:  
> **`models`** — different models, same rules  
> **`rules`** — same model, different rules  

Map: `models` → `model_duel`, `rules` → `rules_duel`.

Same pattern for every fixed choice (see ready-made sets).  
**Exception — contestant models:** numbered multi-pick (`1,4,7`) from `list-model-options.ps1`, not a single word.

## Host map

| Host | Prefer | Fallback |
|---|---|---|
| Cursor + AskQuestion tool | AskQuestion | — |
| Cursor without AskQuestion (e.g. Grok) | — | short-reply words |
| OpenCode / generic | — | short-reply words |

## Freeform chat only for

- Local path / git URL when user picks those escapes on Q1 (or when not logged into gh/glab)
- Grill seed paragraph
- Custom model id / custom pack names

## Source codebase (Q1) — list remotes when logged in

### Before asking

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/list-source-options.ps1
```

| `auth=` line | What you do |
|---|---|
| `github:yes` and/or `gitlab:yes` | Build AskQuestion (or numbered fallback) from the listed repos + Local / URL / More |
| both `no` | Freeform: ask absolute path or git URL only. Mention `gh auth login` (or `glab auth login`) to enable listing next time. |

### If AskQuestion is available

**Single-select** (not multi).

- Prompt: `Which repo or directory should Test 1 inventory?`
- Options: every numbered remote row label from the script, then:
  - `Local directory - I will type an absolute path`
  - `Git URL - I will paste a clone URL`
  - `Show more remote repos` (if `has_more=true` / more option present) → re-run script with `-Offset N`, ask again

### If AskQuestion is missing

Print the numbered list from the script, then:

> Reply with a **number**, or `owner/repo`, or an absolute path, or a git URL.

### After selection

| Choice | Action |
|---|---|
| Remote `owner/repo` | Run `scripts/resolve-source.ps1 -OwnerRepo owner/repo` (clones to `.scratch/sources/{name}` if needed). Record printed `source_codebase=`. |
| Local escape | Ask absolute path next turn; `resolve-source.ps1 -LocalPath …` |
| URL escape | Ask URL next turn; `resolve-source.ps1 -GitUrl …` |
| More | Re-list with higher `-Offset`; ask again |

**Validate:** path exists and is readable. After Test 1 this path is **not** mounted into builder workspaces.

## Contestant models (Q2 — model_duel) — MULTI-SELECT

**Required:** user picks **2+** models in one step.

### Before asking

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/list-model-options.ps1 -DuelHost auto
```

Build options from that list (every row = one selectable model for this host).

### If AskQuestion is available

Call **`AskQuestion` with multi-select enabled** (`allow_multiple: true` / equivalent).

- Prompt: `Which models should duel? Select 2 or more.`  
- Options: one option per catalog model id for this host (label = family + slug from list-model-options)  
- Optional last option: `Something else (I will type more slugs)`  
- If fewer than 2 selected → AskQuestion again: `Need at least 2. Select again.`

### If AskQuestion is missing (e.g. Grok)

Print the numbered list from `list-model-options.ps1`, then:

> Select **2 or more** models. Reply with **comma-separated numbers** (example: `1,4,7`) or comma-separated slugs.

Do **not** ask one model at a time. Do **not** use single-select yes/no per model unless the user asks for that.

### After selection

Assign `arm-01`…`arm-N`, ports `3100+i`. Record exact model ids in KICKOFF.

---

### Q2 rules_duel — contestant model (single)

AskQuestion **single-select** over the same list (one model for all packs). Fallback: one number or one slug.

---

### Reviewer (Q3) — single-select

AskQuestion single-select over reviewer_defaults for this host **excluding** families already in the contestant set. Fallback: one number/slug from that filtered list.

| AskQuestion options | Fallback reply |
|---|---|
| Different models (same rules) | `models` |
| Same model, different rules | `rules` |

### Rules pack

| AskQuestion options | Fallback reply |
|---|---|
| Default on | `default` |
| Default + testing | `testing` |
| Minimal | `minimal` |
| Choose each rule next | `custom` |

### Grill inventory

| AskQuestion options | Fallback reply |
|---|---|
| Yes | `yes` |
| No | `no` |

### Inventory / self-review shape

| AskQuestion options | Fallback reply |
|---|---|
| One agent | `one` |
| Focused specialists | `focused` |

### After bootstrap — which tests to run (MULTI-SELECT)

**Required:** Ask once after bootstrap (and optionally again when user says **run tests** / **continue testing** with no list).

#### If AskQuestion is available

Call **`AskQuestion` with `allow_multiple: true`**.

- Prompt: `Which tests should run? Select Full suite and/or any individual tests.`  
- Options (use these labels — short description in each):

| Option id | Label (show in UI) |
|---|---|
| `suite` | **Full suite** — run Tests 1a→1b→2→3→4→5→6 in order (with gates) |
| `1a` | **1a Codebase inventory** — read the old app; list features with evidence paths |
| `1b` | **1b Grill inventory** — interview you; build a “what you want” inventory; diff vs codebase |
| `2` | **2 Plan** — greenfield phased build plan from the resolved inventory |
| `3` | **3 Build (no feedback)** — ship phases from merged plan; reviews grade only |
| `4` | **4 Build (with review)** — same plan; one review→fix pass per phase |
| `5` | **5 Self-review loop** — self-critique → one fix → external residual grade |
| `6` | **6 Detect + vague fix** — find seeded bugs on identical trees; fix from symptoms |

- If user selects **only** `suite` → run full ordered suite.  
- If user selects `suite` **plus** others → treat as full suite (ignore extras) **or** confirm: prefer suite-only. Default: **suite wins**.  
- If user selects a subset (no suite) → run those tests in numeric order (1a→1b→2→…); skip others. Still enforce prerequisites (ask for missing inventory/plan when needed).  
- Selecting nothing → ask again.

Record in KICKOFF / run-state: `tests_selected: [suite]` or `[1a, 1b, 2, …]`.

#### If AskQuestion is missing (e.g. Grok)

Print the same list numbered, then:

> Select tests. Reply with **comma-separated ids** (example: `suite` or `1a,1b,2` or `3,4`).

| # | id | Short description |
|---:|---|---|
| 0 | `suite` | Full suite 1→6 with gates |
| 1 | `1a` | Codebase feature inventory |
| 2 | `1b` | Grill you → want-inventory + diff |
| 3 | `2` | Greenfield build plan |
| 4 | `3` | Build without review feedback |
| 5 | `4` | Build with one review→fix pass |
| 6 | `5` | Self-review → fix → residual |
| 7 | `6` | Detect bugs + vague fix |

### Confirm bootstrap

| AskQuestion options | Fallback reply |
|---|---|
| Yes, bootstrap | `go` |
| Change an answer | `change` |
| Cancel | `cancel` |

### Host confirm (detection medium/low)

| AskQuestion options | Fallback reply |
|---|---|
| Cursor | `cursor` |
| OpenCode | `opencode` |
| Other (generic) | `generic` |
