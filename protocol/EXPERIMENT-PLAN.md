# Experiment Plan — Multi-model agent duel (harness)

**Status:** LOCKED methodology (runs created via **"start testing"**)  
**Harness repo:** this repository (`runs/{run_id}/` = one isolated archive)  
**Orchestrator:** third-party chat agent in this repo (does not build any arm)  
**Contestants:** chosen at kickoff (`N ≥ 2`)  
**Reviewer:** chosen at kickoff — **must be a different model family** than every contestant (`catalog/MODEL-FAMILIES.json`)  
**Rules:** chosen at kickoff (ablation) — same pack copied into every arm  
**Greenfield:** absolute — no prior apps, no prior run trees, no web harvest of the target product  
**Scorecard mode:** **Option D** — one internal /100 **plus two published headlines**

Kickoff interview: `kickoff/QUESTIONS.md`. Bootstrap: `scripts/bootstrap-run.ps1`.

---

## Kickoff block (written to `runs/{run_id}/KICKOFF.yaml`)

```yaml
run_id:            # e.g. 2026-07-20-myapp
contestants:       # list of { arm_id, model, family, web_port, db_port }
reviewer_model:    # any slug whose family ∉ contestant families
reviewer_family:   # filled by bootstrap validation
rules_selected:    # rule IDs from catalog/RULE-CATALOG.md
source_codebase:   # absolute path — Test 1 read-only only
scorecard: option-d
greenfield: true
```

Generate arms under `runs/{run_id}/arms/{arm_id}/`. Do not hardcode A/B-only logic. Never write into another `runs/` folder.

---

## Why Option D (and the Option B note)

**Option D:** publish two headlines from one run:

1. **Best with external reviewer** — emphasizes Tests 1–4 + 6 (pipeline with the chosen reviewer panel).  
2. **Best solo commit** — emphasizes Tests 1–2 + 5 (+ optional Test 3 baseline): one model builds, self-reviews, fixes; third party only audits the residual.

Internal ranking still uses the weight table below so arms are comparable.

**On Option B (equal weights):**  
Calling “mediocre builder + strong detect wins” a *con* assumed the claim was “best builder.” If the claim is **best overall agent for the money** (build + find + fix), that outcome is a **pro** — cheaper models that debug well *should* climb. Equal weights amplify that. You’re on **D** for now so you can tell both stories without forcing one podium.

---

## Scorecard (internal /100)

| Test | Weight | Measures |
|---|---:|---|
| 1 — Inventory | 15 | Codebase understanding → feature inventory |
| 2 — Plan | 15 | Greenfield build plan from frozen inventory |
| 3 — Build (no feedback) | 20 | Execute merged plan, phase-gated, no fix loop |
| 4 — Build (one review pass) | 20 | Same merged plan; one specialist aggregate → one fix → continue |
| 5 — Solo self-review → fix → residual | 15 | Closed loop on own finished tree; reviewer residual grade |
| 6 — Detect + vague fix | 15 | Same as v1: seeded bugs on winner clone(s) |

**Parallel (not inside /100):** token + Cursor `$` tables per arm per test/role (see Cost ledger).

### Dual headlines (required in FINAL-REPORT)

| Headline | Formula (normalize if needed) |
|---|---|
| With external reviewer | weighted Tests **1+2+3+4+6** (re-normalize those weights to 100) |
| Solo commit | weighted Tests **1+2+5** (+ report Test 3 residual as context; re-normalize) |

If the two headlines disagree on the winner, **say so** — that is a primary result.

---

## Tests (detail)

### Test 1 — Inventory

1. Each contestant (fresh context) reads the **source codebase only** (read-only mount) and writes a full feature inventory.  
2. Fresh **reconciler** (reviewer model, no contestant context) merges all inventories → `shared/RECONCILED-INVENTORY.md`.  
3. Fresh **grader** (reviewer model, no contestant context) scores each contestant inventory vs the reconciled inventory.

**Reconciler rules (mandatory):**

- Union only; tag `SHARED` / `UNIQUE-TO-{arm_id}`.  
- **No invented IDs.** Every ID needs an evidence path in the source tree.  
- Deduplicate by meaning + path, not by wording alone.

**Grader scores:**

- **Recall** vs reconciled (and orchestrator may spot-check code features).  
- **Precision** — junk / hallucinated IDs penalized.  
Verbosity without evidence does not win.

After Test 1: freeze `RECONCILED-INVENTORY.md`. Builders never see the source codebase again.

### Test 2 — Plan (greenfield)

1. Each contestant gets **only** the reconciled inventory (+ always-on rules) and writes an exhaustive phased build plan. **No reference apps.**  
2. Reviewer plan-reviewer checks each plan for inventory coverage + phase sanity.  
3. Fresh reviewer **chooser** merges plans into **one** `shared/MERGED-BUILD-PLAN.md`, citing which arm each major choice came from. **No silent invention** beyond the union of plans. Chooser taste is **not** contestant points.

Score Test 2 on each arm’s own plan quality. The merge is the shared brief for Tests 3–4.

**Orchestrator** cuts equal phase boundaries from the merged plan (same phase count and IDs for every arm).

### Test 3 — Build without feedback

- Every arm builds from **`MERGED-BUILD-PLAN.md` only** (absolute greenfield).  
- After each phase: specialist reviewer panel → aggregator → **grade only** (no findings sent to builder).
- Smoke script must pass before the phase is accepted.  
- Snapshots tagged per arm per phase.

### Test 4 — Build with one review pass

- Same merged plan, same phases, same panel recipe as Test 3.  
- After each phase: specialist panel → aggregator → builder gets **`AGGREGATE-REVIEW.md` only** → **one** fix pass (no second review) → smoke → next phase.  
- No max finding/token cap; cost/time are published (unlimited thrash shows up in `$`).

Tests 3 and 4 may run as separate full rebuilds (recommended: two workspaces per arm, or sequential full runs) so “no feedback” is not contaminated by later fixes. **Do not** reuse Test 3 trees for Test 4.

### Test 5 — Solo self-review loop (5a + residual)

Answers: *If I commit to one model for everything, which should I use?*

1. Freeze each arm’s finished tree (from Test 4 primary build, or declare kickoff which finished tree — default **Test 4 final**; if Test 4 DNF, use Test 3 final and note it).  
2. Fresh contestant agent reviews **own tree only** (optionally same specialist split run as that model, then self-aggregate — or one deep self-review; lock at kickoff).  
3. Fresh contestant fix agent gets **only** aggregate self-findings + tree → **one** fix pass.  
4. **Reviewer specialist panel + aggregator** grades the **post-fix** tree (residual). Same rubric as Tests 3–4.

**Score:** residual quality + self-finding fix rate + regressions + solo TCO (build of that tree’s lineage + self-review + self-fix; residual reviewer cost listed separately as audit).

No cross-model review (no 5b).

### Test 6 — Detect + vague fix

- Clone **headline winner** (declare which headline; default: with-external-reviewer winner) to all arms as identical trees.  
- Seed bugs (ledger gitignored). Detect → grade → vague symptoms → fix → grade.  
- Same methodology as v1.

---

## Review panel (one chosen family only)

For every external grade (Tests 3–5 residual, and optionally Test 2 plan review), spawn the kickoff **reviewer_model**:

| Role | Focus |
|---|---|
| Specialist — security | Trust boundaries, auth, secrets, IDOR |
| Specialist — quality | Correctness, structure, dead stubs |
| Specialist — rules | Selected always-on rules adherence |
| Specialist — clean-code | Duplication, naming, god files, patterns |
| Aggregator | Merge only |

**Aggregator rules:**

1. Union + dedupe by location+claim.  
2. Security blockers always survive.  
3. **No new findings** during aggregation.  
4. Emit single `AGGREGATE-REVIEW.md` for builders (Test 4/5).  
5. Raw specialist files archived under `results/reviews/`.

Same reviewer model for all arms. Fresh context every spawn. Labels `arm-{id}` only — no model names.  
**Hard rule:** reviewer family ∉ contestant families.

---

## Methodological rules (full set)

### Fairness / blinding

1. Contestant model mapping stays in gitignored `.scratch/` until FINAL-REPORT.  
2. Reviewers never see model names — only arm folders.  
3. Orchestrator does not write product code for any arm.  
4. One reviewer family (kickoff choice) for all external grades — never split families across arms; never overlap contestant families.
5. N arms get identical prompts, inventory, merged plan, rubrics, smoke scripts, phase cuts.

### Greenfield / no bleed

6. After Test 1, source codebase is **not** mounted in builder workspaces.  
7. No reading prior `_experiment` builds, v1 duel trees, or “remembered” apps.  
8. No web fetch of the product repo. Prompt forbids it; workspace layout enforces it.  
9. Test 3 and Test 4 are separate trees/runs — feedback arm does not inherit no-feedback fixes.

### Inventory / plan integrity

10. Reconciler: union only, evidence paths, no invented IDs, UNIQUE-TO tags.  
11. Inventory grade = recall + precision (junk IDs hurt).  
12. Chooser merge cites source arm per decision; no silent invention past plan union.  
13. Test 2 scores own plans; merge is not contestant credit.  
14. Tests 3–4 build from **merged plan only**.

### Evidence / gates

15. Phase EXPECTED checklist written before building that phase.  
16. Smoke script (or fixed HTTP checklist) required — STATUS prose is not evidence.  
17. Gate incomplete until review artifacts exist (Test 3: grade; Test 4: grade+fix+re-smoke).  
18. Snapshot every phase complete and every Test 5 pre/post fix. Never delete an arm until residuals exist for all arms.

### Test 4 / 5 fix passes

19. Exactly **one** review→fix cycle per phase (Test 4) or per self-loop (Test 5).  
20. Builder may only read aggregator output (+ tree + frozen plan/rules).  
21. No finding/token cap; publish duration and `$` so thrash is visible.  
22. No phase re-plan during fix; no starting the next phase until smoke passes.

### Test 5 freshness

23. New agent IDs for self-review and for fix (no build transcript).  
24. Residual reviewer panel does not see self-review chat — only post-fix tree.
25. Same specialist+aggregator recipe as Tests 3–4 for residual.

### Prompts / deviations

26. Freeze all prompts and rubrics at kickoff. Mid-run prompt edits void or restart that test.  
27. Log DEVIATIONS for exhausted retries, wrong-tier spawns, path leaks, smoke failures.  
28. Wrong-tier output discarded; re-spawn correct slug.  
29. `resource_exhausted`: one same-model resume from STATUS/WIP; second failure → arm DNF that phase; others continue.  
30. Contestant git / other-arm / ledger / frozen-plan edits → revert + re-spawn that step.

### Scoring honesty

31. Publish dual headlines; do not hide disagreement.  
32. `$`/tokens parallel table — not mixed into /100 unless a future run explicitly adds an efficiency axis.  
33. N=1 product → state “on this codebase” in the report.  
34. DNF arms get explicit DNF — no invented scores.  
35. Run continuously until the batch completes; use stop-condition table above, not calendar abort.

### Cost ledger (orchestrator-owned)

36. Every spawn appends one row to `results/COST-LEDGER.csv`:

```text
timestamp_utc,run_id,test,arm_id,phase,role,model,agent_id,kind,input_w_cache_write,input_wo_cache,cache_read,output_tokens,total_tokens,cost_usd,notes
```

37. Roles include at least: `inventory`, `reconcile`, `inventory_grade`, `plan`, `plan_review`, `plan_choose`, `build`, `review_security`, `review_quality`, `review_rules`, `review_clean_code`, `review_aggregate`, `fix`, `self_review`, `self_fix`, `residual_review_*`, `detect`, `vague_fix`, `orchestrate`.  
38. Paste Cursor usage/`Cost` when the turn ends; nightly CSV reconcile allowed as backup.  
39. Headline tables: **builder-only `$`** vs **full-pipeline `$`** (includes reviewer panel).  
40. Test 5 **solo TCO** = lineage build + self-review + self-fix; residual reviewer = audit line item.

### Public packaging

41. Public repo from day one: plan, prompts, rubrics, inventories, reviews, cost summaries, frozen finals.  
42. No secrets, no bug ledger, no mapping until reveal.  
43. Specialist raw reviews + aggregates + smoke logs retained.

---

## Reviewer family choice

Pick any slug in `catalog/MODEL-FAMILIES.json` whose family is **not** used by a contestant. GLM is a strong default when contestants are Claude/GPT premier tiers (worked in v1; watch for score compression — specialists + evidence mitigate).

---

## Spawn matrix (orchestrator checklist)

At kickoff, expand:

- `N` inventory agents → 1 reconciler → 1 inventory grader  
- `N` plan agents → 1 plan reviewer (or N) → 1 chooser → orchestrator phase cut  
- For Test 3: `N × phases` build + `N × phases × (4 specialists + 1 agg)`  
- For Test 4: same + `N × phases` fix agents  
- Test 5: `N` self-review (+ optional self-specialists) + `N` fix + `N × (4+1)` residual  
- Test 6: `N` detect + `N` fix on cloned winner  

Cost ledger row per spawn. Snapshots per gate. All paths under `runs/{run_id}/`.

---

## Out of scope (this version)

- Seeding defects to grade the reviewer panel’s hit rate  
- Cross-model review (5b)  
- Premier debate loop (replaced by reviewer chooser merge)  
- Calendar time-box abort  

---

## How to start

1. User says **"start testing"** in this repo.  
2. Orchestrator runs `kickoff/QUESTIONS.md` → writes `KICKOFF.yaml` → `scripts/bootstrap-run.ps1`.  
3. Begin Test 1; continue until Tests 1–6 complete or arms DNF per stop-condition rules.
