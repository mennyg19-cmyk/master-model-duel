# Run a single test

Triggered by: **"run test 1"** … **"run test 6"**, **"run inventory"**, **"run test 1a"**, **"run test 1b"**, **"run grill"**, **"run grill inventory"**, **"run plan"**, **"run build no feedback"**, **"run build with review"**, **"run self-review"**, **"run detect"**.

Tests do **not** have to run as a continuous 1→6 batch. Full **"start testing"** still can; this path runs **only** the named test for a chosen `run_id`.

## Procedure

1. Read this file + the matching Test section in `protocol/EXPERIMENT-PLAN.md`.  
2. Confirm **`run_id`** (list `runs/` if needed). If no run exists → send user to **"start testing"** first (bootstrap required).  
3. Load `runs/{run_id}/KICKOFF.yaml`.  
4. Check **prerequisites** below. If a freeze/artifact is missing, **ask** for a path or paste (do not invent product content).  
5. Ask **mode questions** for this test if not already locked (or user wants to override for this run only — log override in `results/DEVIATIONS.md`).  
6. Execute **only** that test for all arms. Stop. Do not auto-start the next test unless the user says so.

## Prerequisites by test

| Test | Need before start | If missing, ask for |
|---|---|---|
| **1** / **1a+1b** | Source + arms; grill seed if 1b on | Source path; inventory mode; grill seed / include flag |
| **1a** Codebase inventory | `SOURCE.md` / `source_codebase` | Source path; inventory mode |
| **1b** Grill inventory | Arms; `grill_seed` | Seed text; confirm grill-protocol on; see `GRILL-INVENTORY.md` |
| **2** Plan | `shared/USER-RESOLVED-INVENTORY.md` (or reconciled if grill off) | Inventory path; if dual track ran but unresolved, **stop** and show comparison first |
| **3** Build (no feedback) | `shared/MERGED-BUILD-PLAN.md` + phase cuts | Merged plan path; phase map if not in run |
| **4** Build (review) | Same as Test 3 (separate trees from Test 3) | Same; confirm Test 3 trees will **not** be reused |
| **5** Self-review | Finished tree per arm | Which tree (Test 4 final / Test 3 final / external path); ask self-review mode (below) |
| **6** Detect + vague fix | Identical clone base + bug ledger | Winner tree path; which headline winner; seed ledger |

Also always needed: contestant arms, rules already copied, reviewer model for external grades (Tests 2–6 as applicable).

## Mode questions (ask when running Test 1 or 5, and at full kickoff)

### Test 1a — Inventory spawn shape

**Ask:** For each contestant arm, should codebase inventory be…

| Answer | Record | Behavior |
|---|---|---|
| One agent | `inventory_mode: single` | One deep inventory per arm |
| Focused specialists | `inventory_mode: focused` | Multiple agents, **same contestant model**, each a different job; then merge → arm inventory |

If focused: show `catalog/SPECIALIST-ROLES.md` inventory jobs; ask which jobs to include (defaults OK). Record `inventory_jobs: [...]`.

### Test 1b — Grill (when running grill or full Test 1 with grill on)

**Ask** (if unset): include grill track? seed text? `grill_sees_codebase_inventory`?  
Then follow `protocol/GRILL-INVENTORY.md`. After both inventories exist, run reviewer comparison and **stop for user resolve** before Test 2.

### Test 5 — Self-review spawn shape

**Ask:** For each arm’s self-review, should it be…

| Answer | Record | Behavior |
|---|---|---|
| One agent | `self_review_mode: single` | One deep self-review |
| Focused specialists | `self_review_mode: focused` | Multiple agents, **same contestant model**, jobs like security / quality / rules / clean-code; then self-aggregate → one fix |

If focused: show self-review jobs from `catalog/SPECIALIST-ROLES.md`; record `self_review_jobs: [...]`.

**Important:** Focused specialists are the **contestant** model (measuring that model’s multi-agent skill). The external residual panel still uses `reviewer_model`.

## After a single test

- Write/update scores under `runs/{run_id}/results/` for that test only.  
- Freeze artifacts the full protocol would freeze (e.g. after Test 1 → `RECONCILED-INVENTORY.md`).  
- Tell the user what’s ready and what command unlocks the next test (e.g. “say **run test 2**”).  
- Do **not** claim full Option D headlines until enough tests exist; partial scoreboard is fine.

## Continuity

Saying **"continue testing"** / **"run next test"** after a single test → run the next unfinished test in order (1→6), still one at a time unless user says **"run remaining"** / **"finish the run"**.
