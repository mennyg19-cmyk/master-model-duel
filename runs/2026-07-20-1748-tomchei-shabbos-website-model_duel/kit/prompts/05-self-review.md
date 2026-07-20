# Test 5 — Self-review

**Arm:** `__ARM_ID__`  
**Tree:** `__TREE__`  
**Rules for this arm:** see `.cursor/rules/`  
**Mode:** `__SELF_REVIEW_MODE__` (`single` | focused job `__SELF_REVIEW_JOB__`)

## Mission

Fresh context. Review **only** this tree. Write findings to `arms/__ARM_ID__/results/SELF-REVIEW.md` (or `self-review-__SELF_REVIEW_JOB__.md` if focused).

## Finding format

| ID | Severity | Location | Claim | Suggested fix |
|---|---|---|---|---|

Severities: blocker / major / minor.

## Hard rules

1. No build transcript. No other arms.  
2. Do not fix in this spawn — findings only.  
3. Final reply ≤10 lines: finding counts by severity, path.
