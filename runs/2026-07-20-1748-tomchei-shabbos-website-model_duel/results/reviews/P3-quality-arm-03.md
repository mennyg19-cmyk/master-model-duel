# Reviewer specialist — Quality

**Arm:** `arm-03`
**Tree / phase:** P3 — Storefront (marketing, catalog, archive, newsletter, admin catalog & media, settings hub)
**Output:** `results/reviews/P3-quality-arm-03.md`
**Reviewer focus:** correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P3-EXPECTED.md`.

Evidence reviewed: `src/app/(storefront)/{page,layout,catalog/page,catalog/[slug]/page,archive/page,archive/[slug]/page,newsletter/page,newsletter/unsubscribe/page,order/page}.tsx`, `src/components/storefront/{shell,newsletter-form,catalog-browser}.tsx`, `src/components/admin/{catalog-admin,addon-admin,media-admin,settings-hub}.tsx`, `src/lib/storefront/{newsletter,media}.ts`, `src/middleware.ts`, `src/app/api/{admin/media,newsletter/*}/route.ts`. No `.scratch/PHASE-P3-SMOKE.md` exists.

## Findings

1. **No P3 smoke evidence (missing smoke, blocker vs EXPECTED):** `arms/arm-03/workspace/.scratch/PHASE-P3-SMOKE.md` is absent; S1–S5 (storefront UX, season gate, newsletter round-trip, media+catalog, delivery-ZIP) are unverified.
2. **Media is local-disk, not Vercel Blob (stub vs EXPECTED #7):** `lib/storefront/media.ts:10-50` writes to `public/uploads` with a "swap to @vercel/blob.put" comment; no `@vercel/blob` import or `BLOB_READ_WRITE_TOKEN` path. Restricted validation + needs-photos panel are correct, but the storage backend is a ponytail stand-in.
3. **No media→product linkage UI (missing flow vs EXPECTED #7):** `media-admin.tsx` uploads and lists assets but never sets `Product.primaryImageUrl`/`mediaAssetId`; the needs-photos panel flags products yet there is no admin flow to attach a media asset to a product, so S4 ("admin product appears in storefront grid" with photo) cannot complete end-to-end.
4. **`/order` closure enforced at page, not middleware (partial vs EXPECTED #4):** `order/page.tsx` server-side blocks when closed (good), but `middleware.ts` marks `/order` public and does no season check; a future checkout route added under `/order/*` would not inherit the gate. Closure enforcement is page-local, not route-wide.
5. **CatalogAdmin `onHand` always resets to 10 on edit (bug):** `catalog-admin.tsx:106` hardcodes `onHand: 10` in `edit()`; real stock is never loaded, so editing any product silently overwrites on-hand to 10.
6. **No Delete in catalog/add-on CRUD (missing flow vs EXPECTED #6):** `catalog-admin.tsx` and `addon-admin.tsx` only Create + Edit (catalog) / Create-only (add-ons); no deactivate/delete, so "CRUD" is incomplete.
7. **Newsletter preferences have no standalone UI (partial vs EXPECTED #5):** `api/newsletter/preferences/route.ts` exists but no page consumes it; preferences are only set inline at subscribe time. Unsubscribe auto-fires on page load with no confirm step (`newsletter/unsubscribe/page.tsx:11-26`), a UX/abuse footgun.
8. **Storefront shell has no user menu (missing vs EXPECTED #2):** `shell.tsx` renders a flat "Account" link; no user menu / signed-in state, though EXPECTED #2 calls for a user menu.
9. **Quick-view dialog lacks a11y close (quality):** `catalog-browser.tsx:132-178` dialog has no Escape/overlay-click close, no focus trap, no `Close` via keyboard — only the explicit Close button.
10. **HMAC secret fallback is weak (security-adjacent quality):** `newsletter.ts:9-11` falls back to `APP_URL` then hard-coded `"tomchei-dev-newsletter"`; in any non-dev deploy without `NEWSLETTER_HMAC_SECRET` tokens are forgeable. Fail-closed instead.

## Summary

- **Blockers (missing flow / missing smoke):** F1, F3, F4 (route-wide), F6
- **Stubs / partial:** F2, F7, F8
- **Bugs / quality:** F5, F9, F10

Finding count: **10**
