# Experiment Plan — Multi-model agent duel (harness)

**Status:** LOCKED methodology (runs created via **"start testing"**)  
**Harness:** Master Model Duel (`runs/{run_id}/` = one isolated archive)
**Orchestrator:** third-party chat agent in this repo (does not build any arm)  
**Run mode:** `model_duel` (N models, one rule pack) or `rules_duel` (one model, N packs) — see `protocol/RULES-DUEL.md`  
**Contestants / packs:** chosen at kickoff (`N ≥ 2` arms)  
**Reviewer:** chosen at kickoff — **must be a different model family** than every contestant (`catalog/MODEL-FAMILIES.json`)  
**Rules:** `model_duel` = same pack on every arm; `rules_duel` = pack is the variable  
**Greenfield:** absolute — no prior apps, no prior run trees, no web harvest of the target product  
**Scorecard mode:** **Option D** — one internal /100 **plus two published headlines**

Kickoff interview: `kickoff/QUESTIONS.md`. Bootstrap: `scripts/bootstrap-run.ps1` (copies **execution kit** → `runs/{id}/kit/`).  
**Late join:** `protocol/LATE-JOIN.md` + `scripts/late-join-arm.ps1` (new model *or* new pack, depending on mode).  
**Single test:** `protocol/RUN-SINGLE-TEST.md` + **"run test N"** (tests need not run as one batch).  
**Grill inventory (Test 1b):** `protocol/GRILL-INVENTORY.md` — dual inventories (codebase + grill), reviewer turn grades + user-facing diff.  
**Frozen prompts / rubrics:** `template/` (see `template/README.md`).

---

## Kickoff block (written to `runs/{run_id}/KICKOFF.yaml`)

```yaml
run_id:            # e.g. 2026-07-20-myapp
run_mode:          # model_duel | rules_duel
# model_duel:
contestants:       # list of { arm_id, model, web_port, db_port }
rules_selected:    # shared rule IDs
# rules_duel:
contestant_model:  # one slug for every arm
rule_packs:        # list of { pack_id, label, rules[] } — bootstrap expands arms
reviewer_model:    # family ∉ contestant families
source_codebase:   # absolute path — Test 1 read-only only
inventory_mode:    # single | focused
inventory_jobs:    # if focused — from catalog/SPECIALIST-ROLES.md
include_grill_inventory: true   # Test 1b; false skips grill track
grill_sees_codebase_inventory: false
grill_seed:        # short fuzzy product intent (same for all arms)
self_review_mode:  # single | focused
self_review_jobs:  # if focused
scorecard: option-d
greenfield: true
```

Generate arms under `runs/{run_id}/arms/{arm_id}/`. Do not hardcode A/B-only logic. Never write into another `runs/` folder. In `rules_duel`, report headlines by **pack**, not by pretending packs are different models.

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
| 1 — Inventory | 15 | **1a** codebase (7) + **1b** grill turns/inventory (8) when grill on; else 15 on 1a — see `GRILL-INVENTORY.md` |
| 2 — Plan | 15 | Greenfield build plan from **user-resolved** inventory (after dual-inventory review) |
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
| Best interviewer (optional) | Test **1b** only — turn quality × grill inventory × efficiency |

If the two main headlines disagree on the winner, **say so** — that is a primary result.

---

## Tests (detail)

### Test 1 — Inventory

**Spawn shape** (kickoff `inventory_mode`, or asked at **run test 1**):

| Mode | Per arm |
|---|---|
| `single` | One fresh contestant agent → full feature inventory |
| `focused` | One fresh contestant agent **per job** in `inventory_jobs` (same model) → partial inventories → one merge agent (same model) → arm inventory |

Job definitions: `catalog/SPECIALIST-ROLES.md`. Every specialist and the merge must require evidence paths; no invented IDs. Ledger one row per spawn.

Then:

1. Each arm produces one final inventory (from single or focused+merge).  
2. Fresh **reconciler** (reviewer model, no contestant context) merges all arm inventories → `shared/RECONCILED-INVENTORY.md`.  
3. Fresh **grader** (reviewer model) scores each arm inventory vs the reconciled inventory.

**Reconciler rules (mandatory):**

- Union only; tag `SHARED` / `UNIQUE-TO-{arm_id}`.  
- **No invented IDs.** Every ID needs an evidence path in the source tree.  
- Deduplicate by meaning + path, not by wording alone.  
- Tags are **attribution** (who contributed the ID). If one arm’s coarser row covers another’s granular row, fold and tag `SHARED` — do not leave peer-covered behavior as UNIQUE.

**Grader scores:**

- **Recall** vs **the full reconciled inventory** (every ID is in the denominator for every arm). `UNIQUE-TO-*` does **not** shrink scope.  
- **Precision** — junk / hallucinated IDs penalized.  
Verbosity without evidence does not win.

After Test 1a: freeze `RECONCILED-INVENTORY.md` (codebase).  

### Test 1b — Grill inventory (dual inventory)

When `include_grill_inventory: true` (default for full suite): run **`protocol/GRILL-INVENTORY.md`** in full.

1. Same seed for every arm; contestants grill the user under `grill-protocol` (different questions are expected).  
2. Each arm writes `GRILL-TRANSCRIPT.md` + `GRILL-INVENTORY.md`.  
3. Reviewer grades **each turn** (needed vs fluff, explain-down, options real vs hallucinated, uptake, faithful capture) — **quality of turns**, not turn count. Efficiency: same inventory quality with fewer necessary turns scores higher.  
4. Reviewer diffs codebase inventory vs grill inventory → `shared/INVENTORY-COMPARISON.md` for the **user**.  
5. User resolves → `shared/USER-RESOLVED-INVENTORY.md` (default input to Test 2).

Builders still never see the source codebase after 1a; grill agents should not see peer transcripts.

### Test 2 — Plan (greenfield)

1. Each contestant gets **only** the frozen **user-resolved** inventory when 1b ran (else reconciled codebase inventory) (+ always-on rules) and writes an exhaustive phased build plan. **No reference apps.**  
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

1. Freeze each arm’s finished tree (from Test 4 primary build, or declare which finished tree — default **Test 4 final**; if Test 4 DNF, use Test 3 final and note it).  
2. **Self-review spawn shape** (kickoff `self_review_mode`, or asked at **run test 5**):

| Mode | Per arm |
|---|---|
| `single` | One fresh contestant agent reviews own tree → findings |
| `focused` | Fresh contestant agents per `self_review_jobs` (security, quality, rules, clean-code, …) → self-aggregate (same model) → findings |

   Jobs: `catalog/SPECIALIST-ROLES.md`. Fresh context; no build transcript.  
3. Fresh contestant fix agent gets **only** aggregate self-findings + tree → **one** fix pass.  
4. **Reviewer specialist panel + aggregator** grades the **post-fix** tree (residual). Same rubric as Tests 3–4. Residual uses `reviewer_model`, not contestant specialists.

**Score:** residual quality + self-finding fix rate + regressions + solo TCO (build of that tree’s lineage + self-review spawns + self-fix; residual reviewer cost listed separately as audit).

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

10. Reconciler: union only, evidence paths, no invented IDs, UNIQUE-TO tags for attribution; fold overlaps to SHARED.  
11. Inventory grade = recall + precision vs **full** reconciled list (junk IDs hurt). Never exclude UNIQUE-TO-peer rows from an arm’s denominator.
11b. Grill track: different questions across models are expected; grade turn **quality** + inventory fidelity; efficiency = same quality / fewer necessary turns (`GRILL-INVENTORY.md`).  
11c. After dual inventory, user must see `INVENTORY-COMPARISON.md` before Test 2; default plan input is `USER-RESOLVED-INVENTORY.md`.  
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

23. New agent IDs for self-review (each focused job + merge if any) and for fix (no build transcript).  
24. Residual reviewer panel does not see self-review chat — only post-fix tree.  
25. Same specialist+aggregator recipe as Tests 3–4 for residual (**reviewer_model**, not contestant self-specialists).

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

### Cost ledger (orchestrator-owned — hard gate)

36. **Every spawn** must append one row via `scripts/append-cost-ledger.ps1` **before** the next spawn. Pass **tokens/`$` when the host shows them**. Cursor Task does not inject usage automatically — orchestrator must copy Usage Summary or backfill from dashboard CSV (`scripts/backfill-cost-ledger.ps1`). A spawn without a ledger **row** is incomplete; a **test** without tokens-or-`$` on those rows fails `verify-cost-ledger.ps1 -RequireUsage`.

```text
timestamp_utc,run_id,test,arm_id,phase,role,model,agent_id,kind,input_w_cache_write,input_wo_cache,cache_read,output_tokens,total_tokens,cost_usd,notes
```

37. Roles include at least: `inventory`, `reconcile`, `inventory_grade`, `plan`, `plan_review`, `plan_choose`, `build`, `review_security`, `review_quality`, `review_rules`, `review_clean_code`, `review_aggregate`, `fix`, `self_review`, `self_fix`, `residual_review_*`, `detect`, `vague_fix`, `orchestrate`, `grill`, `grill_inventory`.  
38. Paste Cursor/OpenCode usage when the turn ends; if unavailable, append with `usage_missing_pending_export` and **backfill before the test gate**.  
39. Headline tables: **builder-only `$`** vs **full-pipeline `$`**. Fill SCOREBOARD Cost at every test gate from the CSV.  
40. Test 5 **solo TCO** = lineage build + self-review + self-fix; residual reviewer = audit line item.  
40b. Gate: `scripts/verify-cost-ledger.ps1 -RunId … -RequireUsage` → `ok=true` before declaring a test done. How-to: `template/orchestrator/COST-LEDGER-HOWTO.md`.

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
- Test 1: `N` inventory (or `N × jobs + N` merges if focused) + reconciler + grader  
- For Test 3: `N × phases` build + `N × phases × (4 specialists + 1 agg)`  
- For Test 4: same + `N × phases` fix agents  
- Test 5: `N` self-review (or `N × jobs + N` self-agg if focused) + `N` fix + `N × (4+1)` residual  
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
3. After bootstrap: **multi-select** which tests to run (`kickoff/ASK-UI.md` — Full suite and/or 1a–6 with short descriptions). Record `tests_selected`; run that set in order. Still can say **"run test N"** later per `protocol/RUN-SINGLE-TEST.md` (ask for missing inventories/plans when needed).
4. **"continue testing"** / **"run remaining"** advances unfinished tests.
