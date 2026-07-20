# Kickoff ask UI (click, don’t type)

## Cursor — HARD RULE

On host `cursor` you **must** call the **`AskQuestion` tool** for every fixed-choice kickoff step.

**Forbidden on Cursor (never do these for choices):**
- “Reply A or B”
- Markdown tables of options asking the user to type a letter
- Numbered lists “1) 2) 3) reply with a number”

**If `AskQuestion` is not in your tool list:**  
STOP. Do not continue kickoff in prose. Tell the user:

> AskQuestion isn’t available in this agent session, so I can’t show clickable options. Switch to a Cursor Agent chat that has the AskQuestion tool (or another model/mode), then say **start testing** again.

Only then may you wait. Do **not** silently fall back to A/B.

**AskQuestion usage**
- Exactly **one** AskQuestion per assistant turn  
- Short option labels  
- At most one escape option: `Something else (I will type it)`  
- Put the recommended choice in the question prompt text when there is one  

## Other hosts

| Host | Structured ask |
|---|---|
| OpenCode / generic | No Cursor AskQuestion → short A/B/C in chat is OK |

## Freeform chat is OK only for

- Absolute path to source codebase  
- Grill seed paragraph  
- Custom model id / custom rule pack names  

## Ready-made AskQuestion sets (Cursor)

### Host confirm (detection medium/low only)

- Prompt: `Which harness should run this duel?`  
- Options: `Cursor` | `OpenCode` | `Other (generic)` | `Something else (I will type it)`

### Q0 Run mode

- Prompt: `What are you comparing?`  
- Options: `Different models (same rules)` | `Same model, different rules`

### Contestant pick method (model_duel)

- Prompt: `How do you want to pick contestant models?`  
- Options: `Suggested pair next (click models)` | `I will type slugs` | `Something else (I will type it)`

### Reviewer

- Prompt: `Pick reviewer (must be a different family than contestants). Recommended: GLM if contestants are Claude/GPT.`  
- Options: build from `reviewer_defaults.cursor` in MODEL-FAMILIES + `Something else (I will type it)`

### Rules pack

- Prompt: `Which rule pack? (recommended: Default on)`  
- Options: `Default on` | `Default + testing` | `Minimal` | `Choose each rule next` | `Something else (I will type it)`

### Inventory shape

- Prompt: `Test 1a codebase inventory shape?`  
- Options: `One agent per arm` | `Focused specialists`

### Grill inventory

- Prompt: `Include grill inventory (interview you)? Recommended: Yes for rebuilds.`  
- Options: `Yes` | `No`

### Grill sees codebase?

- Prompt: `Should grill agents see the codebase inventory? Recommended: No.`  
- Options: `No` | `Yes`

### Self-review shape

- Prompt: `Test 5 self-review shape?`  
- Options: `One agent` | `Focused specialists`

### Run id

- Prompt: `Run id?`  
- Options: `Auto (date + repo + mode)` | `Something else (I will type it)`

### Confirm

- Prompt: `Bootstrap this run?`  
- Options: `Yes, bootstrap` | `Change an answer` | `Cancel`

### After bootstrap

- Prompt: `What next?`  
- Options: `Run full suite` | `Stop — I'll say run test N` | `Something else (I will type it)`
