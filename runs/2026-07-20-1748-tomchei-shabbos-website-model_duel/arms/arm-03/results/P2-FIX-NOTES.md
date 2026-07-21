# P2 Fix Notes — arm-03

Date: 2026-07-21  
Scope: one post-review fix pass (Blockers Q-F1–Q-F3, Critical R-1/R-2, High/Medium CC-F1/CC-F2)

## Fixed

| ID | Fix |
|---|---|
| **Q-F1** | `finalizeOrder` materializes `Package` (+ `PackageItem` + stage audit) from order lines grouped by `groupingKey`. |
| **Q-F2** | Finalize reserves inventory in the same transaction for tracked products and add-ons via `reserveInventoryWithClient`. |
| **Q-F3** | Added `transitionPackage` with row lock, legal stage graph, optimistic `version` guard, package + global audit. |
| **R-1** | Documented `InventoryItem_target_xor_check` CHECK in `schema.prisma`; added `assertInventoryTargetXor` app guard; migrate-guard asserts schema+SQL both mention the constraint. |
| **R-2 / Q-F7** | Finalize locks the order (`FOR UPDATE`) before claiming a season order number; version-guarded DRAFT→PLACED. Same-draft contention test proves one winner and no burned number. |
| **CC-F1** | `finalize` / `discard` / `transition` / `reserve` / `transitionPackage` use `maskError` in Result envelopes. |
| **CC-F2** | Shared `runOrderMutation` + `lockOrderForUpdate` for finalize/discard/transition. |

## Deferred

Remaining aggregate Medium/Low/Info (35 total − items above).

## Verification

- `npm run typecheck`: pass
- `npm run ci:migrate-guard`: pass (`xorCheckDocumented: true`)
- `npm run test:domain-p2`: pass (S2–S5 + same-draft + package OCC + XOR)
- Evidence: `workspace/.scratch/PHASE-P2-SMOKE.md`
