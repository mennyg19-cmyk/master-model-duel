# P3 fix notes — arm-02 (single fix pass)

**Input:** `arms/arm-02/results/AGGREGATE-REVIEW-P3.md` (0 blockers, 5 majors, 24 minors)
**Scope:** all 5 majors attempted and fixed; MIN-9, MIN-11, MIN-16 also fixed. One pass, no re-review.
**Verification:** `npm run typecheck` + `npm run lint` clean; smoke re-run **40/40 PASS** (`workspace/.scratch/PHASE-P3-SMOKE.md`).

## Fixed

| ID | Fix |
|---|---|
| **MAJ-1** | `app/api/newsletter/subscribe/route.ts` no longer mints or returns the management token — response is token-free `{"ok":true}`; links are email-delivery-only (Email phase). `newsletter-signup.tsx` drops the `manageUrl` link. Smoke S3 now asserts the response leaks no token and mints its round-trip token out-of-band via `p3-helpers.ts token`. |
| **MAJ-2** | New `lib/catalog-validation.ts` → `validateRestrictedProductIds()`: add-on POST (`api/admin/add-ons/route.ts`) and PATCH (`[id]/route.ts`) reject nonexistent (400) and cross-season (400) restricted product ids before writing. Verified: bogus id → 400 (was P2003 → 500). |
| **MAJ-3** | Product PATCH (`api/admin/products/[id]/route.ts`) validates `imageId` (asset exists) and `replacementId` (exists, same season, active) → 400 with clear messages (was 500 / silent cross-season persist). Verified by direct API calls. |
| **MAJ-4** | Quick-view modal (`components/storefront/product-grid.tsx`): Escape closes, Tab/Shift+Tab focus trap inside the dialog, body scroll lock while open, initial focus on close button, focus returned to the triggering button on close. |
| **MAJ-5** | `.scratch/p3-smoke.ps1`: season status snapshotted at start and restored via admin PATCH in a teardown section; `p3-helpers.ts cleanup` now also runs at end of every run (smoke product/media/subscriber rows removed). Two teardown checks added (both PASS). |
| **MIN-9** | `validateSeasonExists()` in `lib/catalog-validation.ts`; product POST and add-on POST return 404 for a bogus `seasonId` (was FK 500). Verified: 404. |
| **MIN-11** | `components/storefront/site-header.tsx`: Escape closes both menus; pointerdown outside the user menu / header closes them. |
| **MIN-16** | `isSoldOut(product)` extracted into `lib/catalog.ts`; both call sites (`getCatalogProducts`, `catalog/[slug]/page.tsx`) converge on it. |

## Skipped / deferred (not attempted this pass)

- **MIN-1..MIN-8** (security lows/informational): x-forwarded-for trust, secret entropy/reuse, token-in-URL, unsubscribe rate limit, `/api/setup` disclosure, impersonation hierarchy, CSRF depth — deferred; low severity, several need design decisions (secret split, POST-based token flow).
- **MIN-10** (media orphan row on disk failure), **MIN-12** (empty CLOSED seasons dropped from `/collections`), **MIN-13** (smoke sort assertion matches anywhere in body) — deferred.
- **MIN-14, MIN-15, MIN-17..MIN-24** (clean-code: fetch-helper dedupe, `SeasonRow` drift, image component dedupe, cents helpers, href builders, naming, settings-hub split, swallowed non-OK, upload-limit message drift) — deferred; refactors beyond the single-pass major budget.

## Notes

- `DECISION-P3-2` in `workspace/.scratch/PHASE-P3-STATUS.md` revised to record the MAJ-1 posture change.
- Smoke check count grew 36 → 40 (token-leak assertion + 2 teardown checks + subscribe assertion split).
