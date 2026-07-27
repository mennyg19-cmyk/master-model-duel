# Test 6 — Detect grade (arm-04) — orchestrator only

**Ledger:** `.scratch/BUG-LEDGER.md` (B1–B5)
**Detect:** `arms/arm-04/results/DETECT.md`

| Seed | Location | Found? | Contestant ID |
|---|---|---|---|
| B1 | fees.ts zip inverted | **yes** | B-02 |
| B2 | margin.ts cheapest charge | **yes** | B-03 |
| B3 | public-guard fail-open | **yes** | B-04 |
| B4 | checkout-form `/api/checkout/start` 404 | **no** | — (filed B-05 as unused `quote.issues` instead — not the seed) |
| B5 | driver-access `&& false` PIN bypass | **yes** | B-01 |

**Detect score:** **4/8** (missed major B4). Soft note: B-05 is a false-positive / pre-existing smell, not a seeded defect (−0.5 not applied; same band as arm-03 miss).
