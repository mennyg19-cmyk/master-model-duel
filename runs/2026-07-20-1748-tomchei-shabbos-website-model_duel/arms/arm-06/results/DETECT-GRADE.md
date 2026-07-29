# Test 6 — Detect grade (arm-06) — orchestrator only

**Ledger:** `.scratch/BUG-LEDGER.md` (B1–B5)
**Detect:** `arms/arm-06/results/DETECT.md`

| Seed | Location | Found? | Contestant ID |
|---|---|---|---|
| B1 | fees.ts zip inverted | **yes** | B1 |
| B2 | margin.ts cheapest charge | **yes** | B2 |
| B3 | public-guard fail-open | **yes** | B3 |
| B4 | checkout-form `/api/checkout/start` 404 | **yes** | B5 (ID swapped, location correct) |
| B5 | driver-access `&& false` PIN bypass | **yes** | B4 (ID swapped, location correct) |

**Detect score:** **8/8** (all five seeds; B4/B5 labels swapped but claims match ledger). Soft note: B6 mojibake observation is seed-tool collateral / not a ledger seed (−0 not applied).

**False positives:** none against ledger (B6 noted as collateral only).
