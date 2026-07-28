# P3 Quality Review — arm-06 (blind)

**Phase:** Test 4 P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media
**EXPECTED:** `shared/phases/PHASE-P3-EXPECTED.md`
**Smoke evidence:** None. No `arms/arm-06/workspace/.scratch/PHASE-P3-SMOKE.md`, no `.scratch/` directory, no running-app transcript. Only `scripts/test-p3.mts` (helper unit tests, wired into `test:unit`).
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED. Findings only — no fixes.

## Verdict

All 8 EXPECTED items are backed by code (pages, routes, schema, seed fixtures). Helper unit tests pass deterministically. But the phase gate cannot close: zero smoke evidence for S1–S5 (no `.scratch/PHASE-P3-SMOKE.md`, no transcript). One blocker (missing smoke), three majors (slug-collision create deadlock, add-on filter drift, options-only PATCH ignores add-on restrictions silently), several minors.

## Findings

### Blocker

**B1 — No P3 smoke evidence exists; phase gate cannot close**
`shared/phases/PHASE-P3-EXPECTED.md` line 26: "Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P3-SMOKE.md`". The directory `arms/arm-06/workspace/.scratch/` does not exist. No `PHASE-P3-SMOKE.md`, no `transcript.log`, no screenshot or curl log. None of S1–S5 (storefront UX, season gate, newsletter round-trip, media+catalog, delivery-ZIP live update) were observed in the running app. P2 left a transcript at `.scratch/smoke-p2/transcript.log`; P3 left nothing. `scripts/test-p3.mts` covers HMAC tokens, money, slugify, ZIP gate, stock math, product input, media validation — all pure helper unit tests, not running-app smoke. Per `workflow.mdc` gate discipline, an unchecked expectation item means the todo is not done; every smoke row is unchecked. The README asserts "P3 ships" features but never claims smoke was run.

### Major

**M1 — Product create deadlocks on any name that slug-collides with a past-season product, and the UI offers no slug field to recover**
`app/api/admin/products/route.ts:41-48` derives `slug = slugify(name)` when none provided and rejects duplicates with 409. `Product.slug` is globally `@unique` (`schema.prisma:198`). `app/(admin)/admin/products/product-form.tsx` has no slug input — the form never sends `slug`, so the auto-slug is the only path. The seed demonstrates the collision risk by hand-suffixing (`classic-mishloach-manos` for 2026, `archive-classic-2025` for 2025). A manager creating "Classic Mishloach Manos" in season 2027 hits `slugify → "classic-mishloach-manos"` → 409 "Another product already uses that slug" with no UI field to set `classic-mishloach-manos-2027`. EXPECTED #6 ("Admin product catalog CRUD") implies the natural recreate-each-season workflow; this breaks it for any reused name. The POST route already accepts an optional `slug` (`lib/catalog/product-input.ts:10`) — the form just doesn't surface it.

**M2 — Add-on restriction options differ between create and edit, allowing inactive add-ons onto a product only via edit**
`app/(admin)/admin/products/new/page.tsx:17` filters `addOn.findMany({ where: { active: true } })`. `app/(admin)/admin/products/[id]/page.tsx:38` fetches `addOn.findMany({ orderBy: { name: "asc" } })` (no `active` filter). A manager can create a product with active add-ons only, then on the edit page attach an inactive add-on to the restriction list. The restriction list drives the storefront detail page's "Available add-ons" panel (`app/(storefront)/packages/[slug]/page.tsx:43-46` filters `addOn.active` at render, so inactive ones stay hidden — but the admin state still records a restriction that can never surface until the add-on is reactivated). Inconsistent trust-boundary: the create and edit surfaces apply different rules to the same relation.

**M3 — Options-only PATCH silently ignores the add-on restriction list, but a scalar PATCH with `addOnIds: []` wipes it**
`app/api/admin/products/[id]/route.ts:54-97` gates the scalar branch on `typeof parsed.data.name === "string"`. The options manager (`options-manager.tsx:26`) posts `{ options: [...] }` with no name, so `isScalarUpdate` is false and `addOnIds` stays `null` — the transaction skips the delete/recreate block (line 130) and restrictions are preserved. Correct for the options manager. But the scalar branch sets `addOnIds = full.data.addOnIds ?? []` (line 90): any scalar PATCH that omits `addOnIds` wipes every restriction. `productInputSchema` makes `addOnIds` optional, so a future API caller (or a form variant) that sends `{ name, seasonId, ... }` without `addOnIds` silently deletes all product-add-on links. The form happens to always send `addOnIds` (checkboxes, possibly empty), so the UI is safe today; the footgun is latent for any other caller. EXPECTED #6's "add-on management" implies the link is intentional state, not a side effect of a scalar edit.

### Minor

**m1 — Homepage impact bar counts are global, not season-scoped; README claims "packages this season"**
`app/(storefront)/page.tsx:46-50` runs `prisma.package.count()`, `prisma.order.count({ where: { status: "FINALIZED" } })`, `prisma.customer.count()` — no season filter. README line 27 claims "live impact bar (seasons served, packages this season, volunteers)". Labels in code are "Packages delivered / Orders fulfilled / Families served" (cumulative, defensible). The README's "packages this season" claim is not what the code computes. Cosmetic, but the README is the documented contract.

**m2 — `SettingsTabs.addRate` uses `Math.round(feeDollars * 100)` instead of `dollarsToCents`, accepting fractional-cent rates**
`app/(admin)/admin/settings/settings-tabs.tsx:94` does `Math.round(feeDollars * 100)`. `lib/money.ts:9` `dollarsToCents` rejects fractional cents (`1.005 → null`). The settings schema (`lib/settings.ts:14`) only requires `feeCents: z.number().int().nonnegative()`, so `Math.round(1.005 * 100) = 100` passes. A rate entered as `$1.005` is silently rounded to `$1.00`. Product and add-on forms use `dollarsToCents` for the clean-cents guarantee; the settings rate form is the only money path that bypasses it. Inconsistent money conversion.

**m3 — `MediaManager` uses raw `fetch` for assign/delete instead of `apiFetch`, bypassing the project's one mutation pattern**
`app/(admin)/admin/media/media-manager.tsx:44` (upload) uses raw `fetch` because `apiFetch` stringifies JSON and can't carry multipart — reasonable. But `assign` (line 67) and `remove` (line 82) also use raw `fetch` with hand-rolled error parsing, when both send JSON and could use `apiFetch`. The README documents "Mutations: API routes + `apiFetch`" as the one pattern; the media manager is the only client that deviates for non-multipart calls.

**m4 — `MediaAsset.uploadedById` is a plain `TEXT` column with no FK; no referential integrity to `StaffUser`**
`prisma/migrations/20260728190455_p3_storefront/migration.sql:36` declares `"uploadedById" TEXT` with no `AddForeignKey`. `schema.prisma:589` has `uploadedById String?` with no `@relation`. Deleting a staff user leaves dangling uploader ids on media assets. The audit log has the same plain-string `actorId` pattern, so this is consistent with the arm's convention — flagging because media is the first P3 entity that references staff without a relation.

**m5 — Quick-view dialog has no focus trap and no Escape-to-close**
`app/(storefront)/packages/packages-grid.tsx:138-205` renders `role="dialog" aria-modal="true"` but traps nothing: focus stays on the triggering button, Escape doesn't close, and the only keyboard path is Tab to the Close button. Backdrop click closes. The clean-code rule lists a11y under "never cut." Minor because the dialog is small and reachable, but it's a real keyboard-screen-reader gap.

**m6 — Replacement-link editor allows backwards links (current season → older season) with no direction check**
`app/(admin)/admin/products/product-form.tsx:199-213` populates "Replaced by" from `otherProducts` = all products except self, across all seasons (`app/(admin)/admin/products/[id]/page.tsx:39-43`). The PATCH route (`app/api/admin/products/[id]/route.ts:80-88`) only validates `replacedById !== id` and that the target exists — not that the target's season is newer. A manager can set a 2026 product's replacement to a 2025 product. P10's repeat-order chain walk expects forward links (old → new). For P3 this is just the "editor shell" (EXPECTED #6), but the validation gap is locked in now.

**m7 — `priceLabel` in `packages-grid.tsx` has a dead branch**
`app/(storefront)/packages/packages-grid.tsx:32` checks `lowest > product.basePriceCents` but `lowestPriceCents` (line 27) = `basePriceCents + Math.min(0, ...deltas)`, so `lowest <= basePriceCents` always. The `lowest > base` disjunct can never fire; the "from" prefix is controlled entirely by `product.options.length > 0`. No wrong label results, but the condition is misleading dead code.

**m8 — Closed banner copy assumes a past season exists**
`app/(storefront)/layout.tsx:17-25` shows "Ordering is closed for this season — browse past collections" whenever `!openSeason`. On a fresh install with zero seasons (no past, no open), the banner still links to `/past-collections` which renders "No past seasons yet — this is our first year" (`past-collections/page.tsx:30`). Slightly circular empty-state copy; not a broken flow.

## EXPECTED coverage map

| # | EXPECTED | Evidence | Verdict |
|---|---|---|---|
| 1 | Homepage: mission, impact bar, how-it-works, testimonials, store-open-aware CTAs | `app/(storefront)/page.tsx` — all sections present; CTAs branch on `openSeason` | DONE (m1 on count scope) |
| 2 | Storefront shell: sticky header, desktop nav, mobile menu, user menu, footer signup, closed banner | `layout.tsx`, `site-header.tsx`, `mobile-menu.tsx`, `user-menu.tsx`, `subscribe-form.tsx`, `closed-notice.tsx` | DONE |
| 3 | Current-season catalog: filters, sort, sold-out, quick view, detail + option pricing | `packages/page.tsx`, `packages-grid.tsx`, `[slug]/page.tsx`, `option-panel.tsx`, `lib/storefront/catalog.ts` | DONE |
| 4 | Past-collections archive (all years, browse only, no checkout); closure on /order, /checkout | `past-collections/page.tsx` (CLOSED seasons, no buy buttons); `order/page.tsx`, `checkout/page.tsx` server-side `getOpenSeason` gate | DONE |
| 5 | Newsletter subscribe + preferences + HMAC unsubscribe | `api/subscribe`, `api/unsubscribe`, `unsubscribe/page.tsx`, `lib/newsletter/{subscribers,tokens}.ts`, `lib/hmac.ts`; unit-covered in `test-p3.mts` | DONE |
| 6 | Admin product CRUD + season select + replacement-link shell + add-on management | `admin/products/{page,new,[id]}`, `product-form.tsx`, `options-manager.tsx`, `season-select.tsx`, `admin/addons`, `api/admin/products`, `api/admin/addons` | DONE (M1 slug, M2 add-on filter, M6 backwards links) |
| 7 | Media library on Vercel Blob + restricted uploads + needs-photos panel | `admin/media`, `media-manager.tsx`, `api/admin/media`, `lib/media/{validation,storage}.ts`, `app/uploads/[name]/route.ts` | DONE (m3, m4) |
| 8 | Settings hub: Orders, Shipping, Email, Developer tabs | `admin/settings`, `settings-tabs.tsx`, `api/admin/settings`, `api/admin/{package-types,pickup-locations}` | DONE (m2 rate rounding) |

## Smoke verification

| # | Smoke claim | Transcript evidence | Verdict |
|---|---|---|---|
| S1 | Storefront UX at desktop+mobile; nav, quick-view, filter, sort with seeded catalog | None — no `.scratch/PHASE-P3-SMOKE.md`, no transcript | **Missing (B1)** |
| S2 | Closed season hides checkout CTAs, blocks /order server-side; archive browsable without buy buttons | None | **Missing (B1)** |
| S3 | Subscribe → unsubscribe token round-trip; reject tampered/expired tokens | Unit tests in `test-p3.mts` cover token math; no running-app round-trip evidence | **Missing (B1)** |
| S4 | Upload allowed image, reject disallowed; admin product appears in storefront grid | None | **Missing (B1)** |
| S5 | Edit delivery-ZIP in settings → checkout blocking updates immediately | None | **Missing (B1)** |

## Notes

- `getOpenSeason` (`lib/seasons/queries.ts`) comment claims the single-open-season invariant is enforced by the `seasons_single_open` partial index — verified present at `migrations/20260728182000_p2_fix_pass/migration.sql:59`. Comment is accurate (corrects the P2 review's earlier doubt).
- `OptionPanel` (`[slug]/option-panel.tsx:90`) navigates to `/order?product=${slug}` without passing the selected option values. Acceptable for P3 — the cart lands in P4 and the order page is a documented stub. Flagging only so P4 knows the option selection is currently discarded at navigation.
- `app/uploads/[name]/route.ts` validates the filename against `^[0-9a-f-]{36}\.(jpg|png|webp|gif)$` and serves with `cache-control: public, max-age=31536000, immutable`. Path-traversal-safe. Good local-driver seam.
- `validateUpload` checks extension/content-type agreement but not magic bytes — a renamed binary with a matching extension+declared type passes. Standard limitation for size-capped image-only uploads; the 5 MB cap and image-only allowlist contain the risk. Not a finding for P3.
