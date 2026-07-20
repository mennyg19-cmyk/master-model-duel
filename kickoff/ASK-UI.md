# Kickoff ask UI (less typing)

## Priority

1. **If the `AskQuestion` tool is in your tool list** → use it for every fixed-choice kickoff step (one question per turn). Clickable UI.  
2. **If `AskQuestion` is missing** (common on some models, including Grok) → use the **short-reply fallback** below. Do **not** tell the user to “switch chats” unless they asked for clickable cards and you know another model in their account has AskQuestion.

## When AskQuestion is available (Cursor)

**Do:**
- Call `AskQuestion` once per turn  
- Short option labels  
- At most one escape: `Something else (I will type it)`  

**Don’t:**
- “Reply A or B”  
- Markdown option tables for typing letters  

## Short-reply fallback (no AskQuestion)

Ask **one** question. Options are **one-word / short-phrase** answers the user can tap-send or type fast — not “A or B”.

Example for Q0:

> What are you comparing? Reply with one of:  
> **`models`** — different models, same rules  
> **`rules`** — same model, different rules  

Map: `models` → `model_duel`, `rules` → `rules_duel`.

Same pattern for every fixed choice (see ready-made sets: use the **fallback reply** column).

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

## Ready-made sets

### Q0 Run mode

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
