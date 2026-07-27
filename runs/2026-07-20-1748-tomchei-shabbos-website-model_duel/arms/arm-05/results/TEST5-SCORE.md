# Test 5 — Residual + self-loop score (arm-05)

**Rubric:** `kit/rubrics/self-review-residual.md`
**Aggregate:** `AGGREGATE-RESIDUAL-REVIEW.md`
**Max:** 15

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Residual quality (post-fix tree) | 6 | 3.5 | 2 blockers (BLK-1 payment-void IDOR; BLK-2 delivery notifications never delivered) + 12 majors. The IDOR is insider-scoped but the notification dead-end makes a core P9/P11 acceptance feature non-functional in every environment. Far heavier residual than arm-04 (0B/3Maj). |
| Self-finding fix rate | 4 | 4 | 8/8 self-found majors closed (SR-001..SR-008). Self-review had 0 blockers · 8 majors; all 8 fixed per SELF-FIX-NOTES, none skipped. Residual blockers/majors are carry-over debt the self-review did not surface, not unfixed self-IDs. |
| Regressions introduced | 3 | 2.5 | No new blocker/major from the fix pass per residual panel, but SR-008's "rework the initial fetch effects" introduced duplicated `load()` vs `useEffect` fetch logic in reports + seasons (MIN-15/MIN-16) — a clean-code regression in code the fix touched. typecheck/lint/test/smoke:p9/smoke:p12 green per notes. |
| Solo process hygiene | 2 | 2 | Fresh self-review (findings only), one fix pass, `SELF-FIX-NOTES.md` maps Fixed/Skipped/Verification with self-review IDs intact. |
| **Total** | 15 | **12.0** | |

## Score rationale

- **Residual 3.5/6:** Two blockers anchor this dimension. BLK-2 (delivery notifications captured but never delivered) is the heaviest — a P9/P11 acceptance-gated feature ships completely non-functional; `dispatchSms` writes to the same dead-end `deliveryNotification` table and the only sweeper targets `emailOutbox`. BLK-1 (payment-void IDOR) is insider-scoped (`orders.write` holders voiding payments on orders they don't own) but still a cross-tenant mutation. The 12 majors compound it: three security trust-boundary gaps (MAJ-1 campaign `createMany` bug, MAJ-2/MAJ-3 Host-header → phishing-link chain), two feature-stub residuals (MAJ-5 full-table load, MAJ-6 impersonation audit stub), and the clean-code structural debt (MAJ-7..MAJ-12: dual CSV parsers, god file, duplicated hash/normalizeEmail/error-handling/POST-boilerplate). arm-04 scored 5.0 with 0B/3Maj; arm-05's 2B/12Maj lands at 3.5.
- **Fix rate 4/4:** full closure of the self-found major set (8/8) in one pass, matching the rubric's expected 4/4. Self-review identified 0 blockers · 8 majors; all 8 landed and verified per the residual panels' SR-001..SR-008 checks.
- **Regressions 2.5/3:** no new blocker/major introduced, but SR-008's lint fix duplicated fetch logic in two admin pages (MIN-15/MIN-16) — a real clean-code regression in touched code, not carry-over. Half-point dock from the 3=none ceiling.
- **Hygiene 2/2:** notes and process match the rubric literally.

## Solo TCO ($)

See `results/COST-LEDGER.csv` (lineage + self-review + self-fix; residual reviewers listed separately). Usage backfill still pending on many rows.
