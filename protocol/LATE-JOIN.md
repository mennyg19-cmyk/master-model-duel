# Late join — add an arm to an existing run

**Principle:** Anything that is a **shared live-duel freeze** stays frozen so earlier arms stay comparable. The late arm still runs every test it can, graded against those freezes, and can earn **bonus** when it beats them. It never rewrites the shared brief.

Triggered by: **"add model"**, **"late join"**, **"add contestant"**, **"add pack"** (rules duel).

Depends on `run_mode` in `KICKOFF.yaml`:

| Mode | Late join adds |
|---|---|
| `model_duel` | A **new model**, same shared `rules_selected` |
| `rules_duel` | A **new rule pack**, same `contestant_model` (do not late-join a different model) |

---

## Never change (shared freezes)

| Artifact | Path (typical) | Why frozen |
|---|---|---|
| Shared rules (`model_duel`) | `KICKOFF.yaml` → `rules_selected` | Same ablation for all arms |
| Contestant model (`rules_duel`) | `KICKOFF.yaml` → `contestant_model` | Packs are the variable |
| Reviewer model/family | `KICKOFF.yaml` | Same panel for everyone |
| Source codebase pointer | `SOURCE.md` | Same product |
| **Reconciled inventory** | `shared/RECONCILED-INVENTORY.md` | Live-duel ground truth for plan/build |
| **Merged build plan** + phase cuts | `shared/MERGED-BUILD-PLAN.md`, phase map | Equal build brief for Tests 3–4 |
| Test 6 bug ledger / winner clone (if already cut) | `results/…` | Only re-open if user explicitly restarts Test 6 |

Do **not** re-run reconciler or chooser just because someone joined late.

---

## Must match the run

### `model_duel`

- Same `rules_selected` copied into the new arm’s `.cursor/rules/`
- New contestant model; family must still not equal reviewer family

### `rules_duel`

- Same `contestant_model` (hard fail if a different slug is requested)
- New `pack_id` + rule list (must differ from existing packs)
- Reviewer family check still applies (same family as before)

### Both modes

- New `arm_id`, ports, cost-ledger rows
- Log in `results/DEVIATIONS.md`: `late_join`, timestamp, join point, model + pack (mapping stays in `.scratch` until reveal)

---

## Per-test behavior

### Test 1 — Inventory

1. Late arm inventories the source codebase (read-only), same as originals.  
2. Grade vs **frozen** `RECONCILED-INVENTORY.md` (recall + precision on that set).  
3. **Bonus:** IDs the late arm found that are **real in the source tree** but **absent** from the reconciled inventory.  
   - Orchestrator/reviewer verifies evidence paths.  
   - Record as `bonus_inventory_novel` (count + list).  
   - Does **not** edit the reconciled file.  
   - Does **not** change earlier arms’ Test 1 scores.

### Test 2 — Plan

1. Late arm receives **only** the frozen reconciled inventory (+ rules) — same input as originals.  
2. Writes its own plan; graded like anyone else (coverage vs reconciled, phase sanity).  
3. **Bonus:** plan quality extras that don’t break fairness — e.g. clearer phase cuts, better risk callouts, inventory coverage notes that help execution — scored on a small bonus rubric (`bonus_plan`).  
   - Their plan is **not** merged into `MERGED-BUILD-PLAN.md`.  
   - No influence on other arms’ Test 2 scores.

### Tests 3–4 — Build

1. Late arm builds from the **frozen merged plan** + same phase cuts (equal duel).  
2. Same reviewer panel recipe; same smoke gates.  
3. If originals already finished some phases, late arm simply catches up — no retroactive changes to others.  
4. No “bonus rewrite” of the shared plan. Optional `bonus_build` only for verified extras **beyond** the merged plan that don’t break the app (document tightly or skip bonus here to avoid scope creep). **Default: no build bonus** — equality is the point.

### Test 5 — Solo self-review loop

Fully per-arm. Late join is identical to an original arm (self-review → fix → residual). No shared freeze to disturb.

### Test 6 — Detect / vague fix

- If Test 6 **not started:** late arm can be included when the winner is cloned (all arms get the same tree).  
- If Test 6 **already done:** late arm either skips Test 6 or user starts a **new** Test 6 wave with a fresh clone (log as `test6_rerun`); do not mutate old detection scores.

---

## Scoring presentation

For each late arm, FINAL-REPORT (and live scoreboard) show:

| Column | Meaning |
|---|---|
| Base /100 | Same weights as everyone, using frozen shared artifacts |
| Bonus | `bonus_inventory_novel` + `bonus_plan` (+ optional others) — **reported separately**, not silently folded into base so original rankings stay readable |
| Late-join flag | Yes + join point |

Headline winners for the run stay based on **base** scores unless the user explicitly asks to re-rank with bonus. Bonus is how a late model proves “I saw more / planned better” without invalidating the live duel.

---

## Bootstrap late arm

Orchestrator:

1. Confirm `run_id`, `run_mode`, and that freezes exist (reconciled inventory and/or merged plan as needed for the join point).  
2. Validate reviewer family still OK.  
3. Append under `late_joins:` (keep original contestants/packs intact for history).  
4. Run `scripts/late-join-arm.ps1`:

**model_duel:**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/late-join-arm.ps1 -RunId "{run_id}" -ArmId "arm-0N" -Model "{slug}" -WebPort {port} -DbPort {port}
```

**rules_duel:**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/late-join-arm.ps1 -RunId "{run_id}" -ArmId "arm-0N" -PackId "{pack}" -WebPort {port} -DbPort {port} -Rules ponytail,workflow,vocabulary
```

5. Start the late arm at the correct test for the join point (usually Test 1 if inventory freeze exists; if joining after plan freeze, still run Test 1+2 for scores, then build from merged plan).

### Recommended join points

| Join when | Late arm runs |
|---|---|
| After reconciled inventory frozen | Test 1 (vs freeze + bonus) → Test 2 (equal inventory) → 3–6 on freezes |
| After merged plan frozen | Same; Tests 3–4 use merged plan |
| During Tests 3–4 | Catch up remaining phases on merged plan; still backfill Test 1–2 scores if missing |

---

## What we refuse

- Re-reconciling inventory “to include” the late arm  
- Re-running the chooser merge  
- `model_duel`: giving the late arm a **different** rules pack or reviewer  
- `rules_duel`: late-joining a **different model** (start a `model_duel` instead)  
- Quietly changing earlier arms’ scores
