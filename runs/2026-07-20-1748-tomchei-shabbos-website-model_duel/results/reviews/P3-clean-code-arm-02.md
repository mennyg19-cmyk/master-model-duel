# Reviewer specialist — Clean-code

**Arm:** `arm-02`
**Tree / phase:** P3 (Storefront: marketing, catalog, archive, newsletter, admin catalog & media, settings hub)
**Output:** `results/reviews/P3-clean-code-arm-02.md`
**Rules:** `arms/arm-02/rules/clean-code.md`

Scope: storefront pages/components, admin catalog/media/settings components, supporting `lib/` and `app/api/*` routes touched in P3.

## Findings

### F1 — Duplicated `requestJson` helper (Rule of 2 met)
`components/admin/catalog-manager.tsx:32` and `components/admin/settings-hub.tsx:33` each define their own `requestJson` fetch-JSON wrapper with slightly different signatures (`(url, init?)` vs `(url, method, body)`). Two real call sites now — extract to a shared `lib/admin-fetch.ts` and converge the signature.

### F2 — Duplicated `SeasonRow` type (type/schema drift)
`SeasonRow = { id: string; name: string; status: "OPEN" | "CLOSED" }` is declared verbatim in both `catalog-manager.tsx:10` and `settings-hub.tsx:11`. The `"OPEN" | "CLOSED"` literal also re-derives the Prisma enum by hand. Centralize one `SeasonRow` (ideally derived from `Prisma.Season`) and import it.

### F3 — Duplicated `soldOut` calculation
The exact expression `trackInventory && inventoryItem ? quantityOnHand - reserved <= 0 : false` appears in `lib/catalog.ts:34` and is recomputed inline again in `app/(storefront)/catalog/[slug]/page.tsx:20`. The detail page bypasses `getCatalogProducts` and re-derives the rule — extract `isSoldOut(product)` into `lib/catalog.ts` and call it from both.

### F4 — Duplicated product image / placeholder UI
`components/storefront/product-grid.tsx:9` ships a `ProductImage` (with the 🎁 fallback), then `app/(storefront)/catalog/[slug]/page.tsx:31` reimplements the same image-or-🎁-placeholder inline. Lift `ProductImage` to `components/storefront/product-image.tsx` and reuse on the detail page.

### F5 — Duplicated cents conversion (magic value `* 100`)
`Math.round(Number(price) * 100)` is repeated in `catalog-manager.tsx:89`, `catalog-manager.tsx:108`, `settings-hub.tsx:302`, `settings-hub.tsx:322`, `settings-hub.tsx:333`, plus the inverse `/100` in `settings-hub.tsx:321` and `:332`. Add `toCents(dollars)` / `fromCents(cents)` helpers in `lib/catalog.ts` next to `formatCents` and use them everywhere.

### F6 — Duplicated `filterHref` / `sortHref`
`app/(storefront)/catalog/page.tsx:48` and `:55` are near-identical URLSearchParams builders differing only in which param they set. Collapse into one `buildCatalogHref({ category, sort })` helper.

### F7 — Vague name `data` (banned standalone)
`SettingsHub({ data }: { data: SettingsHubData })` (`settings-hub.tsx:43`) uses `data` as a standalone prop name, which the naming rule bans. Rename to `settings` (or destructure the fields directly).

### F8 — Vague name `item` (banned standalone)
`app/(storefront)/page.tsx:86` maps `HOW_IT_WORKS.map((item) => …)`. `item` is on the banned list. Rename to `step` (the field is even `item.step`).

### F9 — `settings-hub.tsx` mixed concerns (split-by-concern trigger)
`components/admin/settings-hub.tsx` (390 lines) bundles the shell plus `OrdersTab`, `ShippingTab`, `EmailTab`, `DeveloperTab` — four distinct concerns in one file. The split rule fires on "mixed concerns" regardless of line count. Move each tab to `components/admin/settings/{orders,shipping,email,developer}-tab.tsx`.

### F10 — Swallowed non-OK in `loadSeason`
`catalog-manager.tsx:60` does `if (productsResponse.ok) setProducts(...)` and `if (addOnsResponse.ok) setAddOns(...)` with no `else` — a failed reload leaves stale state and surfaces no error to the user. Either set an error message on failure or drop the response entirely and re-throw, so the UI doesn't silently lie.

## Summary

10 findings. Strongest: F1/F2 (admin fetch + `SeasonRow` duplication), F3/F4 (catalog sold-out + image duplication), F5 (cents-conversion magic), F9 (settings-hub split). The rest are naming and a silent error swallow.
