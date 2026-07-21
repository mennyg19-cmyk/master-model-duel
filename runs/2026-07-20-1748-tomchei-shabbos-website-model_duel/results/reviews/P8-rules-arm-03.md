# P8 Rules review — arm-03

Reviewer: Rules specialist (blind to model name).
Scope: `arms/arm-03/workspace/` P8 changes (Shippo wrapper, margin engine, bin packing, labels, checkout live rates).
Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph.
Method: findings only, no fixes. Evidence cited as `path:line`. Structural lookups via `codegraph` (index healthy: 211 files / 2,283 nodes).

## Severity counts

- Critical: 0
- High: 0
- Medium: 3
- Low: 5
- Info: 2

## Findings

### M1 — Dead `resolveDeliveryFees` + helpers left behind; same helpers copied into the new file
P8 introduced `lib/shipping/checkout-rates.ts:52` (`resolveDeliveryFeesLive`) to replace the sync placeholder. `codegraph callers resolveDeliveryFees` returns **no callers**, yet `lib/checkout/delivery.ts:101` still exports `resolveDeliveryFees`, and its two private helpers `destinationKey` (`delivery.ts:59`) and `addressOnlyKey` (`delivery.ts:71`) are now dead with it. The same two helpers were **copied verbatim** into `checkout-rates.ts:20` and `:31` instead of being lifted to a shared `lib/checkout/destination-key.ts`. Two call sites existed at the moment of the copy (Rule of 2 satisfied), so the extraction was warranted — but the author duplicated instead of extracting and left the dead original behind. Clean-code (dead code — delete, don't comment out; duplicated logic — pull into `lib/` helpers; inconsistent patterns — two destination-key implementations for one concern).

### M2 — Missing `.scratch/phase-plan.md` and `.scratch/run-state.md`
P8 is a multi-todo phase in a multi-phase rebuild (P1–P8). `workflow.mdc` § Expectation Files requires a rolling `.scratch/phase-plan.md` with an EXPECTED block per todo written **before** building, and § Run checkpoint requires `.scratch/run-state.md` for multi-phase runs. `ls .scratch/` shows smoke/status artifacts and scratch scripts but **no `phase-plan.md` and no `run-state.md`**. The smoke file (`arms/arm-03/results/PHASE-P8-SMOKE.md`) exists and passes 3/3, but the pre-build expectation trail the rule mandates is absent. Workflow (gate discipline: expectation checklist items must exist with evidence; the checklist itself was never written).

### M3 — Live `validateAddress` discards Shippo's normalized address; mock/live disagree
`lib/shippo/client.ts:288` `validateAddress` in live mode fetches `/addresses/` with `validate: true` but the response type only declares `validation_results`, and the return sets `normalized: address` — the **input** address, not Shippo's normalized result (`client.ts:308`). Mock mode (`:294`) returns a normalized copy with `country` defaulted. R-177 names "Shippo address validation"; validation is wired but normalization is silently dropped in live mode, and the two modes return different shapes for the same call. Clean-code (consistency: one behavior per concern across modes) + anti-hallucination (the `normalized` field claims a Shippo-normalized address that was never read).

### L1 — Magic default parcel `12×9×6` duplicated in three places
The same default box dimensions appear at: `lib/shipping/checkout-rates.ts:41` (`DEFAULT_PARCEL`), `lib/shipping/labels.ts:86` (fallback parcel), and `lib/shipping/bin-packing.ts:139` (fallback `SMALL` box in `loadActiveBoxTypes`). Three independent copies of the same literal; changing the canonical default requires touching all three. Clean-code (magic values — named constants; duplicated logic).

### L2 — `placeholderShipRateCents` is now a dead setting
`lib/checkout/delivery.ts:20` declares `placeholderShipRateCents` on `DeliveryFeeSettings` and `:26` seeds it in `DEFAULT_DELIVERY_FEES`. `codegraph callers placeholderShipRateCents` returns **no callers** — P8 replaced the placeholder path with `resolveDeliveryFeesLive`. The field is still typed, defaulted, and persisted in settings but never read. Phase EXPECTED §5: "replace P5 placeholder path where applicable." Clean-code (dead code).

### L3 — Smoke script computes two dead booleans
`scripts/smoke-p8.mjs:172` builds `s1` and `:187` builds `s1Pass`, but only `s1Final` (`:204`) is pushed into evidence. `s1` and `s1Pass` are assigned, never read. Clean-code (dead code — delete, don't comment out).

### L4 — Magic sentinel `"none"` for failed-label carrier/serviceLevel
`lib/shipping/labels.ts:185-186` writes `carrier: "none"`, `serviceLevel: "none"` on FAILED `ShippingLabel` rows. The string `"none"` is an untyped sentinel repeated twice and consumed by any reader that filters real carriers. Clean-code (magic values — named constant or enum).

### L5 — `selectMargin` error message omits the expected state
`lib/shipping/margin.ts:53` throws `new Error("No eligible ground carrier quotes for margin selection")`. The message states what went wrong but not what was expected (≥1 ground-equivalent quote from fedex/ups/usps). Clean-code (error messages say what went wrong AND what the expected state was).

### I1 — `GROUND_SERVICES` set carries redundant case variants
`lib/shipping/margin.ts:10-21` lists both `FEDEX_GROUND` and `fedex_ground` (and several more pairs), while `isGroundEquivalent` (`:41`) already falls back to `upper.includes("GROUND" | "PRIORITY" | "PARCEL")`. The lowercase entries in the set are never the deciding branch. Ponytail (boring over clever; subtract don't add) — informational, not a defect.

### I2 — `resolveDeliveryFeesLive` awaits destinations sequentially
`lib/shipping/checkout-rates.ts:91` loops `for (const [key, line] of shipDestinations)` with `await quoteMargin(...)` per destination rather than `Promise.all`. For a handful of destinations this is negligible and may spare Shippo rate limits — the choice is just unstated. Ponytail (minimum code) — informational.

## What passed cleanly

- **No new dependencies.** The Shippo wrapper uses native `fetch` and `node:crypto` (`lib/shippo/client.ts:1,98`) — ponytail ladder rungs 2/3 honored; `package.json` unchanged for P8.
- **Margin engine is a pure function.** `selectMargin` (`lib/shipping/margin.ts:48`) is deterministic: per-carrier cheapest ground quote, then charge = max, buy = min, margin = charge − buy (UR-003 / G-006). S1 evidence records exact 1800/1200/600 for both even (UPS) and odd (FedEx) zips.
- **R-175 compensation is correct.** A failed `buyLabel` writes a `FAILED` `ShippingLabel` + `LABEL_FAILED` audit and throws before any `PURCHASED` row exists (`lib/shipping/labels.ts:113-125,168-207`); the re-buy guard (`:73-76`) only blocks on `PURCHASED`, so retry is unblocked.
- **R-183 / R-184 typed env.** `ShippoEnv` (`client.ts:58`) declares `upsAccountId`, `upsClientId`, `upsClientSecret` with the docstring "Declaration-only — never sent to a UPS direct API in this phase." `.env.example:39-54` mirrors every var with placeholders.
- **P9 stub is correctly scoped.** `isVoidable` (`labels.ts:46`) gates on `routeAssignedAt == null`; `stubAssignLabelToRoute` (`:282`) sets it; `voidLabelForPackage` (`:218-220`) returns 409 with "Label is assigned to a route and cannot be voided here (P9)". S3 confirms PRINTED stays voidable and routed returns 409.
- **Bin packing is pure, deterministic, and persists.** `packItems` (`bin-packing.ts:63`) is first-fit decreasing against `PackageType` boxes, never drops a unit (unpacked list surfaced), and `planPackageShipment` (`:156`) writes the plan onto `Package.shipmentPlan` (schema `prisma/schema.prisma:603`).
- **Comments reference plan IDs and constraints, not narration.** `labels.ts:114` (R-175), `:145` (targetId is StaffUser FK only — label id in meta), `:221` (S3), `client.ts:57` (R-183/R-184), `bin-packing.ts:62` (R-081), `margin.ts:9` (plan risk #2). No "// This function handles…" style.
- **Checkout live rates wired end-to-end.** `buildCheckoutSummary` and `prepareCheckout` (`lib/checkout/session.ts:154,346`) and `createHostedCheckoutSession` (`:420`) all call `resolveDeliveryFeesLive`; S2 evidence shows `liveShip=true`, `shipFeeCents=1800`, quotes 1800/1200.
- **Codegraph used for structure.** Index healthy; no Grep-for-symbol violations observed in the P8 file set — the new shipping modules are cleanly partitioned (`lib/shippo/`, `lib/shipping/`, `lib/checkout/`).
