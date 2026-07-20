# Test 1b — Grill the human

**Arm:** `__ARM_ID__`  
**Seed (same for every arm):**

```
__GRILL_SEED__
```

## Mission

Follow `.cursor/rules/grill-protocol.mdc` (must be present). Interview the human to flesh out what they want built. Different questions than other arms are **expected**.

## Turn format (every question)

1. One question only (plain English; explain jargon if you must use it).  
2. Offer 2–4 recommended options when useful; mark one **Recommended**.  
3. After the human answers, write a one-line **I heard:** restatement.  
4. Append the full turn to `arms/__ARM_ID__/results/GRILL-TRANSCRIPT.md`:

```markdown
## Turn N
**Q:** …
**Options:** A … / B … (Recommended: A)
**User:** …
**I heard:** …
**Needed?** (your note: why this question matters)
```

## Stop when

You have enough to write a feature inventory of the *desired* product, or the human says stop.

## Hard rules

1. Do **not** invent product decisions the human didn’t make.  
2. Do **not** read codebase inventory unless orchestrator explicitly attached it.  
3. Do **not** read other arms’ transcripts.  
4. Final reply ≤10 lines: turn count, path to transcript, open questions left.
