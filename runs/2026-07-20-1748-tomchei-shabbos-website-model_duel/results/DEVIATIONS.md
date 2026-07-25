# Deviations — `2026-07-20-1748-tomchei-shabbos-website-model_duel`

| When | What | Why |
|---|---|---|
| Test 1a spawn (aborted) | First arm-01 batch aborted before output; retried with sol-high, also aborted | User aborted parallel spawns |
| Test 1a respawn | arm-01 respawned as `gpt-5.6-sol-medium` per user request | Correct kickoff slug restored |
| Test 1a source | Re-provisioned source from `Tomchei-Shabbos-Website` (README-only) → `tomche-shabbos-website` (full app) | arm-02 specialists returned 0 features — wrong repo |
| Test 4 P2 | arm-01 aggregate + arm-02 security review hit `resource_exhausted`; resumed once each (glm-5.2-high) | Cursor quota; protocol rule 29 |
| 2026-07-21T13:52:00Z | **test6_rerun** (arm-03) | User chose rerun: clone arm-02 headline winner → re-seed B1–B5 (same BUG-LEDGER) → detect + vague fix for arm-03 only; arm-01/02 Test 6 scores unchanged |
| 2026-07-21T13:55:00Z | **grill_frozen_replay ABORTED** (arm-03) | Orchestrator wrongly replayed frozen answers; user corrected — Test 1b must be live grill (own questions, human answers). Invalid transcript quarantined. |
| Test 4 P2 | arm-02 quality + clean-code reviews also exhausted; resumed once each | Cursor quota wave |
| Test 4 P2 | Second `resource_exhausted` on arm-01 aggregate, arm-02 all four P2 reviewers → orchestrator wrote arm-01 aggregate; arm-02 review panel **DNF** until quota resets | Protocol rule 29 |
| Test 4 P6 arm-01 | [arm-01 Test4 P6 build](c63da8b0-d773-47ca-9b48-9baffe069893) HTTP 500 mid-build after schema/migration + admin-operations + csv-import; resumed same agent | Cursor infra error |

## [2026-07-21T13:33:59.6474314Z] Late join arm-03
**What happened:** Added contestant mid-run.
**Rule:** Shared freezes unchanged; see protocol/LATE-JOIN.md.
**Status:** DECIDED

## [2026-07-25T19:41:59.8867969Z] Late join arm-04
**What happened:** Added contestant mid-run.
**Rule:** Shared freezes unchanged; see protocol/LATE-JOIN.md.
**Status:** DECIDED

## [2026-07-25T19:50:00Z] arm-04 orchestrated from a cloud agent VM — three host limits
**What happened:** The arm-04 late join was run by an orchestrator on a Cursor cloud VM rather than the local host. Three things that host cannot do:

1. **Test 1a blocked.** `SOURCE.md` points at a local Windows path, and the private source repo `mennyg19-cmyk/tomche-shabbos-website` is not reachable from the VM (only the empty public `Tomchei-Shabbos-Website` scaffold is). No source tree → no inventory pass.
2. **Test 1b blocked.** The grill is a live interview with the user; it cannot run unattended.
3. **Test 2 written but ungraded.** The frozen reviewer `glm-5.2-high` is not a spawnable model in the cloud VM's subagent catalog, so no plan review was produced. Substituting another reviewer would break the frozen-panel rule, so the grade is left open instead.

**Rule:** LATE-JOIN.md freezes the reviewer model/family; a swap is not allowed without an explicit user decision. Shared freezes (reconciled inventory, merged plan, phase cuts, arm-01/02/03 scores) untouched.
**Status:** OPEN — arm-04 Test 2 grade and Tests 1a/1b await a run from the local host (or an equivalent host with source access and `glm-5.2-high`).

## [2026-07-25T19:50:00Z] arm-04 Test 2 cost row has no usage numbers
**What happened:** Cursor Task does not report token/$ usage to a cloud orchestrator, so the arm-04 Test 2 ledger row was appended with `usage_missing_pending_export`.
**Rule:** Cost gate needs `verify-cost-ledger.ps1 -RequireUsage`; backfill via `scripts/backfill-cost-ledger.ps1` after a dashboard CSV export.
**Status:** OPEN — backfill before any arm-04 test gate.
