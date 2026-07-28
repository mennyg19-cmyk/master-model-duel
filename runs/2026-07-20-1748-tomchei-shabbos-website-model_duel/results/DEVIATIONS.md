# Deviations — `2026-07-20-1748-tomchei-shabbos-website-model_duel`

| When | What | Why |
|---|---|---|
| Test 1a spawn (aborted) | First arm-01 batch aborted before output; retried with sol-high, also aborted | User aborted parallel spawns |
| Test 1a respawn | arm-01 respawned as `gpt-5.6-sol-medium` per user request | Correct kickoff slug restored |
| Test 1a source | Re-provisioned source from `Tomchei-Shabbos-Website` (README-only) → `tomche-shabbos-website` (full app) | arm-02 specialists returned 0 features — wrong repo |
| Test 4 P2 | arm-01 aggregate + arm-02 security review hit `resource_exhausted`; resumed once each (glm-5.2-high) | Cursor quota; protocol rule 29 |
| 2026-07-21T13:52:00Z | **test6_rerun** (arm-03) | User chose rerun: clone arm-02 headline winner → re-seed B1–B5 (same BUG-LEDGER) → detect + vague fix for arm-03 only; arm-01/02 Test 6 scores unchanged |
| 2026-07-26T10:09:25Z | **late_join rollback + restart** arm-04 | User aborted first arm-04 attempt; deleted arm-04 tree, re-bootstrapped Opus 5 high fresh |
| 2026-07-26T10:09:25Z | **test6_rerun** (arm-04) | Same as arm-03: clone arm-02 winner; B1–B5; arm-01/02/03 scores frozen |
| 2026-07-21T13:55:00Z | **grill_frozen_replay ABORTED** (arm-03) | Orchestrator wrongly replayed frozen answers; user corrected — Test 1b must be live grill (own questions, human answers). Invalid transcript quarantined. |
| Test 4 P2 | arm-02 quality + clean-code reviews also exhausted; resumed once each | Cursor quota wave |
| Test 4 P2 | Second `resource_exhausted` on arm-01 aggregate, arm-02 all four P2 reviewers → orchestrator wrote arm-01 aggregate; arm-02 review panel **DNF** until quota resets | Protocol rule 29 |
| Test 4 P6 arm-01 | [arm-01 Test4 P6 build](c63da8b0-d773-47ca-9b48-9baffe069893) HTTP 500 mid-build after schema/migration + admin-operations + csv-import; resumed same agent | Cursor infra error |

## [2026-07-21T13:33:59.6474314Z] Late join arm-03
**What happened:** Added contestant mid-run.
**Rule:** Shared freezes unchanged; see protocol/LATE-JOIN.md.
**Status:** DECIDED

## [2026-07-26T10:09:25.6481873Z] Late join arm-04
**What happened:** Added contestant mid-run after user rolled back first attempt. Model: **`claude-opus-5-thinking-high`** (`claude-opus`), ports 3104/4104. Test 6: **rerun_same_seeds** (clone arm-02; B1–B5). Live grill for Test 1b (no frozen replay).
**Rule:** Shared freezes unchanged; see protocol/LATE-JOIN.md. Grade vs frozen RECONCILED-INVENTORY + MERGED-BUILD-PLAN; bonus_inventory_novel / bonus_plan allowed.
**Status:** DECIDED — Test 1a focused specialists running.

## [2026-07-27T16:11:32.6055869Z] Late join arm-05
**What happened:** Added **`gpt-5.6-terra-high`** (`gpt-terra`), ports 3105/4105. User requested **Test 4 + Test 5 only** (skip 1a/1b/2/6). Build from frozen `MERGED-BUILD-PLAN` + phase cuts; self_review_mode remains `single`.
**Rule:** Shared freezes unchanged; see protocol/LATE-JOIN.md. No rewrite of reconciled inventory / merged plan.
**Status:** DECIDED — Test 4 P1 starting.

## [2026-07-27T16:53:00Z] arm-05 P1 smoke infra
**What happened:** Post-fix live S2–S5 returned honest 503 (no Docker/system Postgres/Clerk on host). Earlier duel arms used **embedded Postgres** on the arm db port for smoke. Orchestrator resumed builder to add embedded PG on 4105 + documented dev-auth; phase not gated until S1–S5 pass.
**Update:** Port 4105 cleared; re-smoke **S1–S5 pass**. P1 gated **1.5/20**.
**Status:** DONE — P1 gated; P2 starting

## [2026-07-28T08:53:00Z] Late join arm-06
**What happened:** Added **`kimi-k3-max`** (`kimi`), ports 3106/4106. User requested **entire suite** (1a/1b/2/4/5/6; Test 3 skipped for all arms in this run). Test 6: **rerun_same_seeds** (clone arm-02 winner; B1–B5; arm-01/02/03/04 scores frozen). Live grill for Test 1b (no frozen replay). Catalog: added `kimi-k3-max` to `kimi` family in `catalog/MODEL-FAMILIES.json`.
**Rule:** Shared freezes unchanged; see protocol/LATE-JOIN.md. Grade vs frozen RECONCILED-INVENTORY + MERGED-BUILD-PLAN; bonus_inventory_novel / bonus_plan allowed.
**Status:** DECIDED — Test 1a focused specialists running.

## [2026-07-28T09:49:00Z] arm-06 T1a merge quota
**What happened:** arm-06 merge agent hit `resource_exhausted` before writing output; resumed once (same agent).
**Rule:** Protocol rule 29 (quota exhaustion → resume once).
**Status:** DONE — merge resumed.


## [2026-07-28T08:46:35.7136836Z] Late join arm-06
**What happened:** Added contestant mid-run.
**Rule:** Shared freezes unchanged; see protocol/LATE-JOIN.md.
**Status:** DECIDED
