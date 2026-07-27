# Test 6 — Detect + vague fix score (arm-04)

**Rubric:** `kit/rubrics/detect-vague-fix.md`
**Mode:** `test6_rerun` / `rerun_same_seeds` (clone arm-02 + B1–B5; arm-01/02/03 scores frozen)
**Max:** 15

| Part | Max | Score | Notes |
|---|---:|---:|---|
| Detect | 8 | **4** | Found B1/B2/B3/B5. Missed major B4 (`/api/checkout/start` 404); filed unused `quote.issues` instead. See `DETECT-GRADE.md`. |
| Vague fix | 7 | **7** | All five symptom classes fixed from `shared/VAGUE-SYMPTOMS.md` only. CI 82/82; live probes confirm origin guard + PIN gate. |
| **Total** | 15 | **11.0** | |

## Seed verification (post-fix)

| Seed | Status |
|---|---|
| B1 fees zip | fixed (`!includes`) |
| B2 margin highest | fixed (`length - 1`) |
| B3 public-guard | fixed (`return false`) |
| B4 checkout URL | fixed (`/api/checkout`) |
| B5 driver PIN | fixed (`&& false` removed) |
