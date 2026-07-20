# Kickoff questions ("start testing")

Ask **one group at a time**. Do not bootstrap until all answers are locked in `runs/{run_id}/KICKOFF.yaml`.

## How to ask (important)

**Cursor:** use **`AskQuestion`** for every fixed choice. **Never** “Reply A or B.” Details + ready-made options: `kickoff/ASK-UI.md`.  
If AskQuestion is missing → **STOP** (do not continue kickoff in prose).

**OpenCode / generic:** short A/B/C in chat is OK.

---

**Before asking:** run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/detect-host.ps1
```

| Confidence | What you do |
|---|---|
| **high** | Do **not** ask. Record `host` from detection. Tell the user: “Detected **X** — using that harness.” |
| **medium** | Show detection + evidence. Ask: “Use this host?” Default = detected. |
| **low** | Ask which host (table below). Suggest setting `DUEL_HOST` next time. |

| Answer | Record `host` | Spawn path |
|---|---|---|
| Cursor | `cursor` | Cursor Task via `scripts/spawn-agent.ps1` brief |
| OpenCode | `opencode` | `opencode run` via `scripts/spawn-agent.ps1` |
| Other | `generic` | Manual brief from spawn-agent |

Full rules: `adapters/AUTO.md`. Model ids must match that host in `catalog/MODEL-FAMILIES.json`.

---

## Q0 — Run mode

**Ask:** What are you comparing?

| Mode | Answer | Meaning |
|---|---|---|
| `model_duel` | Different models | Same rule pack on every arm (classic) |
| `rules_duel` | Same model, different rules | One model; each arm gets a different rule pack |

Record `run_mode`. Details for rules mode: `protocol/RULES-DUEL.md`.

---

## Q1 — Source codebase

**Ask:** Absolute path (or git URL + local clone path) of the repo to inventory in Test 1.

**Validate:** Path exists; readable tree. Record `source_codebase`. After Test 1 this path is **not** mounted into builder workspaces.

---

## Q2 — Contestants (depends on mode)

### If `model_duel`

**Ask:** List of model ids for **this host** (`N ≥ 2`).  
Cursor: Cursor slugs. OpenCode: `provider/model` ids from `hosts.opencode` in MODEL-FAMILIES (edit that file if yours differ).

Assign `arm_id` = `arm-01` … `arm-N`, ports `3100+i`.

### If `rules_duel`

**Ask:**

1. **One** contestant model slug (same for every arm).  
2. **N ≥ 2 named rule packs** — each pack = list of rule IDs from the **live catalog** (`catalog/RULE-CATALOG.md` + `catalog/rules/*.mdc`). Present the full catalog when building packs (same procedure as Q4).

**Validate:** Packs must not be identical sets. Suggest clear labels (`full`, `no-clean-code`, `no-canary`, `minimal`).

Each pack becomes one arm (`arm-01` …) with that pack’s rules only.

---

## Q3 — Reviewer model

**Ask:** One model slug for **all** external review roles (specialists, aggregator, reconciler, chooser, residual).

**Validate (hard fail):** Reviewer’s `family` must **not** equal any contestant model’s family.  
In `rules_duel` there is only one contestant family — reviewer must still differ from it.

If invalid: refuse, list allowed families, ask again.

---

## Q4 — Rules (always from catalog)

**Before asking:** Read `catalog/RULE-CATALOG.md` **and** list every `catalog/rules/*.mdc` file. The offer list = union of table IDs + files on disk (flag any file missing from the table, or table row missing a file).

**Never** invent a shortlist from memory. **Never** skip a catalog rule because it’s “custom” or new — if it’s in `catalog/rules/`, ask about it.

Show the user a checklist of **all** catalog IDs with default on/off/optional from the table (new/uncatalogued files: treat as optional until the user sets a default in the table).

### If `model_duel`

**Ask:** Which of these catalog rules to include in **every** arm? (yes/no or include list)

**Suggest default on** (unless the catalog row says otherwise): `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`  
**Suggest default off:** `git-discipline`, `grill-protocol`, `plan-review`  
**Optional / ablation targets:** everything else in the catalog, including user-added rules

Record top-level `rules_selected` (IDs only; must exist as `catalog/rules/{id}.mdc`).

### If `rules_duel`

Packs were sketched in Q2. Re-confirm each pack against the **full** catalog checklist; show a diff table (rule × pack). Every rule ID in every pack must exist in the catalog.

### Custom rules

If the user wants a rule that isn’t in the catalog yet: tell them to add `catalog/rules/{id}.mdc` + a `RULE-CATALOG.md` row, then re-ask Q4 from the refreshed list. Do not accept “paste this rule text into the arm” as a substitute.

---

## Q5 — Inventory spawn shape (Test 1a)

**Ask:** When running Test 1a (codebase inventory), for each contestant arm do you want…

1. **One agent** — single deep feature inventory (`inventory_mode: single`), or  
2. **Focused specialists** — multiple agents of **that arm’s same model**, each inventoring a different job (security, data, UI, …), then merge (`inventory_mode: focused`)

If focused: show `catalog/SPECIALIST-ROLES.md` inventory jobs; ask which to include (defaults OK). Record `inventory_jobs`.

---

## Q5b — Grill inventory (Test 1b)

**Ask:** Include the **grill inventory** track with the suite? (Recommended: **yes** for rebuilds where your head-plan may differ from the old app.)

| Answer | Record |
|---|---|
| Yes | `include_grill_inventory: true` |
| No | `include_grill_inventory: false` (Test 1 weight stays all on 1a) |

If yes:

1. **Seed:** short fuzzy description of what you want (same text for every arm). Record `grill_seed`.  
2. Confirm `grill-protocol` will be on for grill agents (auto-include for 1b even if off in the shared builder pack).  
3. **Ask:** Should grill agents see the codebase inventory? Default **no** (`grill_sees_codebase_inventory: false`) so they don’t just restate the code.  
4. Remind: models will ask **different** questions — that’s the duel. Reviewer grades turn *quality*, not question sameness or raw turn count.

Details: `protocol/GRILL-INVENTORY.md`.

---

## Q6 — Self-review spawn shape (Test 5)

**Ask:** When running Test 5 self-review, for each arm do you want…

1. **One agent** — single deep self-review (`self_review_mode: single`), or  
2. **Focused specialists** — multiple agents of **that arm’s same model** for security / build quality / rule adherence / clean-code (etc.), then self-aggregate → one fix (`self_review_mode: focused`)

If focused: show self-review jobs from `catalog/SPECIALIST-ROLES.md`; record `self_review_jobs`.

Note: external residual review still uses `reviewer_model`. Focused mode measures the contestant’s multi-agent self-critique.

---

## Q7 — Run label

**Ask:** Short slug for this run (or accept auto `yyyy-MM-dd-HHmm` + source repo name + mode).

---

## Q8 — Confirm

Show summary:

- `run_mode`  
- source path  
- models / packs  
- reviewer + family-overlap proof  
- `inventory_mode` (+ jobs if focused)  
- `include_grill_inventory` (+ seed summary if yes)  
- `self_review_mode` (+ jobs if focused)  
- run path `runs/{run_id}/`

**Ask:** Proceed to bootstrap? Yes →

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-run.ps1 -KickoffYaml "runs/{run_id}/KICKOFF.yaml" -DuelHost cursor
```

Use `-DuelHost opencode` or `generic` to match Q-1 (or set `host:` in KICKOFF.yaml).

**Then ask:** Run the full suite now (Tests 1–6), or stop after bootstrap so you can say **run test 1** (etc.) one at a time? See `protocol/RUN-SINGLE-TEST.md`.

If full suite: begin Test 1 with locked `inventory_mode` / jobs. If single-test path: stop after bootstrap and wait for **run test N**.
