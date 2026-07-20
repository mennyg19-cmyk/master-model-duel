# Phase EXPECTED — P10

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P10 — Seasons management, repeat orders, replacement mappings.

## Must be true when phase is done

1. [ ] Admin replacement mappings per catalog item with cross-season chain resolution (R-048, G-013)
2. [ ] Customer repeat: copy prior year to draft with middle review page confirming replacements AND recipients (UR-007, G-011, G-012); price-smart defaults; unmapped items must be picked or removed
3. [ ] Staff single-order repeat (R-057); bulk repeat of customer history (R-058)
4. [ ] New-season setup wizard (R-097); manager Open/Closed switch + optional scheduled auto-flip (UR-008); archive stays browsable off-season

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Repeat with discontinued item | Repeat order with discontinued line → review page forces replacement pick; price-smart default; confirm replacements + recipients before continue |
| S2 | Bulk repeat + auto-flip | Bulk repeat drafts N customers; scheduled auto-flip opens season at configured time |
| S3 | Imported prior-year repeat | Repeat imported prior-year order (stub/migration hook OK) → mapped products, recipients, address book, greetings resolve |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P10-SMOKE.md`

## Out of scope this phase

- Full P12 migration import pipeline (year-one repeat fully gated until P12)
- Email/SMS platform (P11)
- Reporting/launch polish (P12)
