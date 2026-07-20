# Test 1b — Grill inventory (dual inventory)

**Status:** LOCKED with the full suite (optional skip only if kickoff sets `include_grill_inventory: false`).  
**Also runnable alone:** **"run test grill"** / **"run grill inventory"** / **"run test 1b"**.

## Why

Code-reading inventory answers: “What does the old app *do*?”  
Grill inventory answers: “What does the human *want* the next app to be?”  

Those diverge. This test forces both, then the **reviewer** shows you the gap so you decide what feeds the build plan.

Different contestants will use `grill-protocol` differently and ask different questions. **That is the design** — do not grade “same questions as peer.” Grade **quality of turns** and **quality of the resulting inventory**.

## Fairness

| Locked equal | Allowed to differ |
|---|---|
| Seed brief (1–3 sentences from user, or “rebuild this product”) | Which questions each model asks |
| Same human answering (interleave arms if fatigue matters) | Question wording, depth, recommended options |
| `grill-protocol` present for the grill agents | How they interpret the rule |
| Reviewer model / family | — |
| No reading peer arm transcripts mid-grill | — |

Contestant **must not** see the other arm’s codebase inventory or grill transcript until after all grill inventories are frozen (unless user explicitly allows a second round).

## Artifacts (per arm)

| Path | Content |
|---|---|
| `arms/{id}/results/CODEBASE-INVENTORY.md` | From Test 1a (read source tree) |
| `arms/{id}/results/GRILL-TRANSCRIPT.md` | Numbered Q&A turns (question, recommended options if any, user answer, model’s “I heard…”) |
| `arms/{id}/results/GRILL-INVENTORY.md` | Feature inventory derived **only** from the grill (evidence = transcript turn IDs, not code paths) |
| `results/reviews/grill-turns-{arm}.md` | Reviewer per-turn grades |
| `results/reviews/inventory-diff-{arm}.md` | Codebase vs grill for that arm |
| `shared/INVENTORY-COMPARISON.md` | Cross-arm summary + user-facing highlight of what changed and why |
| `shared/USER-RESOLVED-INVENTORY.md` | Written **after** user reviews diffs (feeds Test 2 unless user picks another freeze) |

Shared codebase reconcile from Test 1a still produces `shared/RECONCILED-INVENTORY.md` (codebase-only). Grill side may get `shared/RECONCILED-GRILL-INVENTORY.md` the same way (union of grill inventories, no invented IDs — evidence = transcript cites).

## Procedure

### A — Codebase inventory (Test 1a)

Unchanged: read source → arm codebase inventory → reconciler → grade vs reconciled. See `EXPERIMENT-PLAN.md` Test 1.

### B — Grill inventory (Test 1b)

1. Orchestrator ensures `grill-protocol` is available to the grill agent (copy into arm rules for this phase if not already in `rules_selected`).  
2. Give the same **seed** to every arm (user’s fuzzy intent). **Do not** attach the codebase inventory to the grill agent by default (avoids anchoring). Optional kickoff flag `grill_sees_codebase_inventory: false` (default).  
3. Contestant runs a grill (one question at a time per protocol). Record every turn in `GRILL-TRANSCRIPT.md`.  
4. When the model stops (or user ends), a **fresh** same-model agent (or same agent if continuous is preferred — lock at kickoff; default **fresh**) writes `GRILL-INVENTORY.md` from transcript only.  
5. Repeat for every arm (interleave recommended).

### C — Reviewer: turn quality (not turn count)

Fresh **reviewer_model** grades **each turn** in each transcript. Primary score is **quality**, not how many turns.

Per turn, score (0–2 or 0–3 each):

| Dimension | Question |
|---|---|
| **Needed vs fluff** | Did this question reduce real ambiguity, or was it filler / already answered? |
| **Explain-down** | Could a tech-jargon-dumb human understand the question without a glossary? |
| **Options quality** | Were recommended answers / options real for this product, or hallucinated / inapplicable? |
| **Uptake** | Did the model’s next move show it understood the user’s answer (including “use your recommended”)? |
| **Recommended used?** | Fact: did the user pick the model’s recommended option, a variant, or reject? (not a moral score — used later for calibration) |
| **Faithful capture** | “I heard…” / notes match what the user said — no silent rewrite |

**Turn aggregate** for an arm = mean of needed + explain-down + options + uptake + faithful (exclude fluff turns from the mean, or weight fluff as 0 on “needed”).

**Efficiency (secondary, not primary):**

- Prefer **same inventory quality with fewer non-fluff turns** → higher efficiency.  
- Prefer **more detailed, simpler questions that produce a better inventory** over a short fluffy grill that misses product.  
- Formula (publish both):  
  - `grill_quality` = inventory_score × turn_quality_mean  
  - `grill_efficiency` = inventory_score / max(1, necessary_turns)  
  where `necessary_turns` = turns graded non-fluff.

Winner logic: **better inventory + high turn quality wins**. If inventories are tied, **fewer necessary turns wins**. Fluff-heavy long grills lose even if the final list looks big.

### D — Reviewer: inventory comparison → user

For each arm (and a cross-arm summary):

1. Diff **CODEBASE-INVENTORY** vs **GRILL-INVENTORY**:  
   - Only in codebase (legacy / human didn’t re-request)  
   - Only in grill (new intent / not in old code)  
   - In both (aligned)  
   - Contradictions (old behavior vs stated want)  
2. Write plain-English **why this matters** (not jargon).  
3. Present `shared/INVENTORY-COMPARISON.md` to the **user**.  
4. User edits or approves → `shared/USER-RESOLVED-INVENTORY.md`.  
5. **Test 2** builds plans from the **user-resolved** inventory by default (not raw codebase reconcile alone). Log if user chooses codebase-only or grill-only instead.

## What we deliberately do *not* grade

- Similarity of question lists across models  
- Matching the reviewer’s preferred interview style  
- Raw turn count as a positive score  
- “Sounded senior”

## Scorecard contribution

When `include_grill_inventory: true`, Test 1 weight (15) splits:

| Sub | Points | Measures |
|---|---:|---|
| 1a Codebase inventory | 7 | Recall/precision vs reconciled codebase inventory |
| 1b Grill turns + grill inventory | 8 | Turn quality + grill inventory quality + efficiency tie-break |

When grill is off, all 15 stay on 1a.

Publish a third optional headline in FINAL-REPORT: **Best interviewer** = 1b ranking (turn quality × inventory × efficiency).

## Commands

| Say | Effect |
|---|---|
| **run test 1** / **run inventory** | 1a + 1b if enabled |
| **run test 1a** / **run codebase inventory** | Codebase only |
| **run test 1b** / **run grill** / **run grill inventory** | Grill path only (asks seed if missing) |
| Full suite | 1a → 1b → comparison → user resolve → Test 2… |
