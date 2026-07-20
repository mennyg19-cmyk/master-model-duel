# P3 Quality review — arm-02

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Arm: `arm-02`
Phase: P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media
Reference: `shared/phases/PHASE-P3-EXPECTED.md`
Reviewer focus: correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.

## Summary

All eight EXPECTED items are present and `.scratch/PHASE-P3-SMOKE.md` reports
S1–S5 passing (36/36), with CI green (lint + typecheck + migration:guard + 27
unit tests). The findings below are quality gaps, not blockers: server-side
validation holes in the admin catalog/add-on APIs that turn bad input into
unhandled 500s, a media-upload ordering bug that can orphan asset rows, missing
keyboard/focus behavior on the quick-view and header menus, an archive list
that silently drops empty past seasons, and smoke hygiene that pollutes the DB
and toggles the live season status without restoring it.

Findings: **9**

## Findings

### F1 — Add-on `restrictedToProductIds` is not validated server-side (existence or same-season)
**Severity: medium · Type: validation gap / broken flow**

`app/api/admin/add-ons/route.ts:21-57` (POST) and
`app/api/admin/add-ons/[id]/route.ts:6-34` (PATCH) accept
`restrictedToProductIds: z.array(z.string())` and write `AddOnRestriction`
rows directly. The Prisma schema (`prisma/schema.prisma:226`) declares
`AddOnRestriction.product @relation(... references: [id], onDelete: Cascade)`
— a hard FK — so a nonexistent product id makes `createMany` throw
`PrismaClientKnownRequestError` (P2003), which is not caught, and Next.js
returns 500. There is also no check that the referenced products belong to
the same season as the add-on: an add-on in "Purim 2026" can be restricted to
a "Purim 2025" product, which is semantically wrong but persists silently.
The client (`components/admin/catalog-manager.tsx:300-314`) scopes the
multi-select to the current season's products, but that is the only
enforcement and is trivially bypassed via direct API call.

### F2 — Product PATCH `imageId` / `replacementId` not validated for existence, same-season, or active state
**Severity: medium · Type: validation gap / broken flow**

`app/api/admin/products/[id]/route.ts:6-42` accepts `imageId` and
`replacementId` as arbitrary strings; the only guard is
`parsed.data.replacementId === id` (self-reference). `Product.imageId` and
`Product.replacementId` are FK columns (`schema.prisma:174-179`), so a
nonexistent `imageId` or `replacementId` triggers a Prisma FK violation →
unhandled 500 instead of a clean 400/404. `replacementId` pointing to a
product in a different season, or to an inactive product, is accepted with no
check. The client replacement dropdown
(`components/admin/catalog-manager.tsx:176-183`) filters only by
`candidate.id !== product.id` — not by season or `isActive` — so an admin can
point a retired product at an inactive replacement that itself is no longer
sellable, which defeats the R-148 intent.

### F3 — Product / AddOn POST do not validate that `seasonId` exists
**Severity: low · Type: broken flow**

`app/api/admin/products/route.ts:21-29` and
`app/api/admin/add-ons/route.ts:21-28` validate `seasonId: z.string().min(1)`
only. Creating a product/add-on against a nonexistent or malformed season id
fails on `db.product.create` / `db.addOn.create` with a Prisma FK error and
surfaces as 500, not a 400/404. The `GET` route at least returns an empty list
for an unknown season; the write path should similarly reject it up front.

### F4 — `saveMediaUpload` (local driver) creates the DB row before writing the file; orphan row on disk failure
**Severity: low · Type: correctness / error handling**

`lib/media.ts:61-67` creates `db.mediaAsset` with `url: ""`, then `mkdir` +
`writeFile`, then `update` to set `url: /media/{id}`. If `writeFile` throws
(disk full, permission, path issue), the asset row with an empty url
persists — the admin library and needs-photos panels will list a broken
asset with no bytes on disk, and `/media/{id}` will 404. There is no
`try/catch` to delete the row on failure. Symmetrically, in the Vercel-Blob
branch (`lib/media.ts:50-58`), if `db.mediaAsset.create` throws after `put()`
succeeds, the blob is orphaned in Vercel Blob with no cleanup. The local
branch should write the file first (or clean up the row on failure); the Blob
branch should `del()` the blob on DB failure.

### F5 — Quick-view modal has no Escape, no focus trap, no scroll lock
**Severity: medium · Type: missing UX / a11y**

`components/storefront/product-grid.tsx:63-111` renders a
`role="dialog" aria-modal="true"` overlay. Backdrop click closes (line 69)
and the `×` button closes (line 80), but there is no `Escape` key handler,
no focus move into the dialog on open, no focus trap, and no `<body>` scroll
lock. EXPECTED item 3 lists "quick view" as delivered; S1 smoke only asserts
the trigger string renders, so the keyboard/screen-reader close path is
untested and broken. A keyboard user must tab to the `×` button to dismiss.

### F6 — `SiteHeader` user menu and mobile menu have no click-outside or Escape close
**Severity: low · Type: missing UX / a11y**

`components/storefront/site-header.tsx:43-108`: both the user menu
(`userMenuOpen`, line 48) and the mobile menu (`mobileOpen`, line 73) toggle
on button click but stay open when the user clicks elsewhere or presses
Escape — there is no outside-click handler and no `keydown` listener.
EXPECTED item 2 lists "user menu" and "mobile menu" as delivered shell
features; the toggle works but the dismiss affordances are incomplete,
which is especially visible on mobile where the hamburger menu overlays
content and cannot be closed by tapping away.

### F7 — `getArchiveSeasons` drops CLOSED seasons that have zero products
**Severity: low · Type: correctness / regression vs EXPECTED**

`lib/season.ts:13-18` filters `where: { status: "CLOSED", products: { some: {} } }`.
A CLOSED season with no products will not appear in `/collections`
(`app/(storefront)/collections/page.tsx:6`), yet `/collections/[seasonId]`
(`app/(storefront)/collections/[seasonId]/page.tsx:14-31`) renders it fine
with "This season has no recorded packages." EXPECTED item 4 says
"Past-collections archive (all years, browse only)" — the list view
silently omits empty past seasons, so the archive is "CLOSED seasons with
products", not "all years". The two archive views disagree on what counts
as a past season.

### F8 — Smoke price-sort assertions match the first occurrence anywhere in the HTML body
**Severity: low · Type: smoke false confidence**

`.scratch/p3-smoke.ps1:56-60` asserts sort order with
`[regex]::Match($priceDesc.Body, "Executive Basket|Classic Basket|Kids Treat Box|Wine Duo|Deluxe Basket")`
and takes `.Value` as the "first product". `Match` returns the first
occurrence anywhere in the body — not the first product card. If any other
part of the page (title, breadcrumb, future sort dropdown, meta tag, or the
product's own link text inside a header) mentions a product name before the
first card, the assertion passes even when the sort is broken. The check
proves "Executive Basket appears somewhere", not "Executive Basket is the
first card". A robust check would anchor on the product-card markup (e.g.,
the `data-testid="product-row-..."` or the card container) and read names
in order.

### F9 — Smoke leaves orphan rows and does not restore the season status it toggled
**Severity: medium · Type: smoke hygiene / state pollution**

`.scratch/p3-smoke.ps1` runs `p3-helpers.ts cleanup` at the START (line 27)
but has no cleanup at the end. S2 closes Purim 2026 then reopens it
(lines 66, 81) — the original season status is never captured or restored,
so if a prior reviewer/seed left the season CLOSED, this smoke silently
flips it OPEN for any subsequent test. S5 correctly snapshots and restores
the delivery-ZIP setting (lines 134-142), but S2 does not do the same for
season status. The run also creates a newsletter subscriber
(`smoke@example.com`), a media asset (`smoke.png`), and a catalog product
(`smoke-test-box`) that persist in the DB until the next run's start
cleanup — so between runs the storefront grid and admin catalog list are
polluted with a `Smoke Test Box` row and a `smoke.png` asset, which can skew
later aggregate reviews and P4+ catalog behavior.
