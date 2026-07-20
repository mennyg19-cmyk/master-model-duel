# Kickoff ask UI (less typing)

When the **host has a structured question tool** (Cursor: `AskQuestion`), use it for every kickoff choice that has fixed options. Do **not** dump long numbered lists in chat for those.

## Rules

1. **One question per message** (Cursor AskQuestion limit).  
2. Prefer **short option labels**; put detail in the option description if the tool allows.  
3. Always include at most one escape: **Something else (I will type it)** — never two “Other” options.  
4. Mark the **recommended** option in the prompt text when there is one.  
5. If AskQuestion (or host equivalent) is **unavailable**, ask the same question in short prose with A/B/C choices.  
6. Freeform only when required: source path, custom model slug not in the list, custom run label, grill seed text.

## Host map

| Host | Structured ask |
|---|---|
| Cursor | `AskQuestion` tool — required when available |
| OpenCode | No standard picker yet → short A/B/C in chat (or TUI prompts if the product adds them later) |
| Generic | Short A/B/C in chat |

## Ready-made Cursor AskQuestion sets

Use these titles/options (adapt model lists from `MODEL-FAMILIES.json` for the detected host).

### Host confirm (only if detection medium/low)

- Prompt: `Which harness should run this duel?`  
- Options: `Cursor` | `OpenCode` | `Other (generic)` | `Something else (I will type it)`

### Q0 Run mode

- Prompt: `What are you comparing?`  
- Options: `Different models (same rules)` → `model_duel` | `Same model, different rules` → `rules_duel`

### Q2 Contestants (model_duel) — after listing families

- Prompt: `How do you want to pick contestant models?`  
- Options: `Pick from catalog checklist (next)` | `I will type slugs` | `Something else (I will type it)`  
- Then one AskQuestion **multi-select** if the tool supports it; else several single-selects “Add Sol high?” yes/no per suggested default pair.

### Q3 Reviewer

- Prompt: `Pick reviewer family (must differ from contestants).`  
- Options: built from `reviewer_defaults` for this host + `Something else (I will type it)`

### Q4 Rules

- Prompt: `Rule pack for this run?`  
- Options: `Default on (ponytail, clean-code, workflow, vocabulary, codegraph)` | `Default + testing-protocol` | `Minimal (ponytail + workflow only)` | `I'll choose each rule next` | `Something else (I will type it)`  
- If “I'll choose each rule next”: one AskQuestion multi-select over catalog IDs when supported; else yes/no batches.

### Q5 Inventory spawn

- Prompt: `Test 1a codebase inventory shape?`  
- Options: `One agent per arm` | `Focused specialists (same model, split jobs)` 

### Q5b Grill inventory

- Prompt: `Include grill inventory (interview you for what you want)?`  
- Options: `Yes (recommended for rebuilds)` | `No (codebase inventory only)`

### Q5b follow-up (if yes)

- Prompt: `Should grill agents see the codebase inventory?`  
- Options: `No (recommended)` | `Yes`

### Q6 Self-review spawn

- Prompt: `Test 5 self-review shape?`  
- Options: `One agent` | `Focused specialists (security/quality/rules/clean-code)`

### Q7 Run label

- Prompt: `Run id?`  
- Options: `Auto (date + repo + mode)` | `Something else (I will type it)`

### Q8 Confirm

- Prompt: `Bootstrap this run?`  
- Options: `Yes, bootstrap` | `Change an answer` | `Cancel`

### After bootstrap

- Prompt: `What next?`  
- Options: `Run full suite` | `Stop — I'll say run test N` | `Something else (I will type it)`

## Freeform (chat is OK)

- Absolute path to source codebase  
- Grill seed paragraph  
- Custom model id / custom rule pack labels for rules_duel
