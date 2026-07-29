# Test 6 — Detect + vague fix score (arm-06)

**Rubric:** `kit/rubrics/detect-vague-fix.md`
**Mode:** `test6_rerun` / `rerun_same_seeds` (clone arm-02 + B1–B5; prior arm scores frozen)
**Max:** 15

| Part | Max | Score | Notes |
|---|---:|---:|---|
| Detect | 8 | **8** | All five seeds found (B4/B5 IDs swapped in DETECT.md; locations correct). See `DETECT-GRADE.md`. |
| Vague fix | 7 | **7** | All five symptom classes fixed from `shared/VAGUE-SYMPTOMS.md` only. Fee+margin unit 13/13; typecheck clean. |
| **Total** | 15 | **15.0** | |

## Seed verification (post-fix)

| Seed | Status |
|---|---|
| B1 fees zip | fixed (`!includes`) |
| B2 margin highest | fixed (`length - 1`) |
| B3 public-guard | fixed (`return false`) |
| B4 checkout URL | fixed (`/api/checkout`) |
| B5 driver PIN | fixed (`&& false` removed) |
