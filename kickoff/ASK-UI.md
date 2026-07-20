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

- Absolute path to source codebase  
- Grill seed paragraph  
- Custom model id / custom pack names  

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

### Confirm bootstrap

| AskQuestion options | Fallback reply |
|---|---|
| Yes, bootstrap | `go` |
| Change an answer | `change` |
| Cancel | `cancel` |

### After bootstrap

| AskQuestion options | Fallback reply |
|---|---|
| Run full suite | `suite` |
| Stop — I'll say run test N | `stop` |

### Host confirm (detection medium/low)

| AskQuestion options | Fallback reply |
|---|---|
| Cursor | `cursor` |
| OpenCode | `opencode` |
| Other (generic) | `generic` |
