# P3 Aggregate Review — arm-04 (blind)

**Phase:** P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media
**Source reviews:** P3-security, P3-quality, P3-rules, P3-clean-code (arm-04)
**Method:** union + dedupe by (location, claim). Security blockers always survive. No new findings introduced during aggregation.

## Counts (after dedupe)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 5 |
| Minor | 20 |

## Prioritized fix list (builder-readable)

### Blockers
None.

### Majors (fix in this order)

1. **`saveAddOn` writes cross-season `AddOnProductRestriction` rows.** `src/lib/catalog/admin.ts:185-190`. Form-supplied `restrictedToProductIds` are not checked against the add-on's season. A `catalog.manage` holder can point an add-on at products in any season; breaks the season-scoping invariant P4/P5 cart builder relies on. Validate each target product's `seasonId` equals the add-on's season before `createMany`.
2. **`saveProduct` lets a form change the season of an existing product.** `src/lib/catalog/admin.ts:70-76`. On update, `seasonId` is taken from the form with no server-side check that it matches the product's existing season. Reassigning orphans `ProductOption`/`InventoryItem` rows and can violate `@@unique([seasonId, slug])`. Also: a non-existent `imageAssetId` throws uncaught P2003 (500), not a graceful validation error. Pin `seasonId` to the existing product on update; validate `imageAssetId` existence before write.
3. **Server actions trust form-supplied entity ids without validating existence.** `src/lib/catalog/admin.ts:60-92` (imageAssetId) and `:186-190` (restrictedToProductIds via `createMany`). A tampered or stale id produces an uncaught Prisma FK violation (P2003 / `createMany` throw) instead of a friendly `Result` failure. Trust-boundary validation cannot rely on the client. Look up each id before write; return `INVALID_CATALOG_INPUT` on miss.
4. **Inconsistent validation/error pattern across settings actions.** `src/app/(admin)/admin/settings/actions.ts`. Four settings actions use three different validation styles (manual `Number()` + redirect, named zod + redirect, manual regex `dollarsToCents` no zod, inline `z.union` no named schema) while catalog actions use the `Result<T>` pattern. Pick one validation approach for settings actions and apply it across all four (named zod schemas + consistent error surfacing).
5. **Pattern drift: replacement action uses `redirect()` for errors while sibling actions use `useActionState` return.** `src/app/(admin)/admin/catalog/actions.ts:49-60`. `setReplacementAction` surfaces failure via `redirect('?error=...')`; `saveProductAction` and `saveAddOnAction` in the same file return `{ error, notice }` for inline errors. Two error-handling patterns coexist in one file for the same admin section. Convert `setReplacementAction` to the `useActionState` return pattern.

### Minors (priority order)

1. **`saveProduct`/`saveAddOn` update on missing id throws uncaught P2025.** `src/lib/catalog/admin.ts:74-76`, `:181-183`. Only P2002 is caught; missing-id surfaces as 500 and leaks "record not found" vs "validation error". Catch P2025 and return a friendly failure.
2. **Newsletter `loadByToken` timing oracle on subscriber existence.** `src/lib/newsletter/subscriptions.ts:58-68`. Valid signature + non-existent id performs a `findUnique` round-trip before returning; bad signature returns immediately. Comment claims equal treatment but timing differs. Equalize the paths (constant-time miss).
3. **Newsletter `subscribe` action has no rate limit.** `src/app/(storefront)/newsletter-actions.ts:18-34`. Unauthenticated caller can flood `NewsletterSubscriber` with unique addresses and probe existing subscriptions via upsert vs create observable behavior. Plan R-122 calls for public-endpoint guards (same-origin, IP rate limit, Zod). Add throttling.
4. **`setReplacementLink` audit action indistinguishable from a product save.** `src/lib/catalog/admin.ts:130-135`. Logged as `catalog.product_saved` with `created: false`; the audit trail cannot distinguish "replacement pointer moved" from "product fields edited", and never records the target product id. Use a distinct action (e.g. `catalog.replacement_linked`) and include the target id in `detail`.
5. **`beginImpersonation` does not re-check target status after cookie issuance.** `src/app/(admin)/admin/staff/actions.ts:98-116`. Cookie valid for `SESSION_MAX_AGE_SECONDS` (12h). `resolveImpersonation` re-checks `status: 'ACTIVE'` per request, so the live gate holds — noted for completeness. No bypass.
6. **`saveEmailSettingsAction` does not validate `fromName`.** `src/app/(admin)/admin/settings/actions.ts:125-142`. `fromAddress` and `replyToAddress` are validated as emails; `fromName` is written verbatim with only `.trim()`. A `settings.manage` holder can set a sender display name that impersonates a person or brand. Add non-empty + length cap.
7. **No hard delete in catalog "CRUD".** `src/lib/catalog/admin.ts`, `src/app/(admin)/admin/catalog/actions.ts`. Plan § P3 says "CRUD"; only Create/Read/Update ship. Soft-delete via `isActive: false` is the right call for an order system (hard delete would orphan order lines), but the D is absent. Either ship a deactivation action labeled as the D or note the soft-delete as the D in the plan.
8. **`setReplacementLink` "later season" rule has no unit test.** `src/lib/catalog/admin.ts:116-121`. Smoke P3-3 only asserts the editor renders; the forward-only-season business rule is enforced in code but not covered by `tests/`. Add a unit test for the season-order invariant.
9. **`millimetres` schema accepts 0.** `src/lib/catalog/admin.ts:34-38`. `z.string().regex(/^\d*$/).transform(...)` lets "0" through as `0`, a nonsensical package dimension that would break rate shopping later. Add a positive-minimum check.
10. **`uploadImageAction` always writes to the current season year's folder.** `src/app/(admin)/admin/media/actions.ts:25`. A manager uploading a photo for an archive product still lands it under `catalog/{currentYear}/...`. Cosmetic — the asset row is assignable to any product regardless of path — but the path misleads. Acceptable to defer.
11. **Create form does not reset after success.** `src/app/(admin)/admin/catalog/product-form.tsx:60`, `add-on-form.tsx:45`. `useActionState` + `defaultValue` keeps last entered values visible after a successful create; the notice clarifies but the stale fields are mildly confusing. Reset form state on success.
12. **Redundant type assertion on `kind`.** `src/lib/catalog/admin.ts:71`. `kind: parsed.data.kind as ProductKind` — `productSchema` already validates `kind` via `z.enum`, so the cast adds nothing; the explicit `kind` key also duplicates the value already in the `...fields` spread. Drop the cast and the duplicate key.
13. **`millimetres` schema name applied to `weightGrams`.** `src/lib/catalog/admin.ts:34-38`. The binding `weightGrams: millimetres` reads as a unit mismatch; the error message compensates by listing both units. Rename to a neutral `wholeNumber` / split into `millimetres` and `grams` so the name does not apologize in its own error string.
14. **`storeOnDisk` relies on `buildPathname` sanitization alone.** `src/lib/media/storage.ts:51-60`. `path.resolve(process.cwd(), LOCAL_UPLOAD_DIRECTORY, pathname)` has no containment check after resolve. Safety depends entirely on `buildPathname` stripping non-`[a-z0-9]` characters. Not exploitable today; a defense-in-depth `resolved.startsWith(UPLOAD_ROOT)` guard would protect against a future caller bypassing `buildPathname`.
15. **Duplicated `needs-photos` card JSX.** `src/app/(admin)/admin/catalog/page.tsx:86-106` and `src/app/(admin)/admin/media/page.tsx:43-63`. Same `<Card data-testid="needs-photos">` block rendered verbatim in two pages. Extract a shared `<NeedsPhotosCard products={...} />` (the `data-testid` contract already implies a single component).
16. **Duplicated season-select GET form.** `src/app/(admin)/admin/catalog/page.tsx:57-78` and `src/app/(admin)/admin/catalog/add-ons/page.tsx:58-79`. Same `method="get"` season picker duplicated across catalog and add-ons pages. Extract `<SeasonSelectForm action seasons selected />` to prevent drift.
17. **Duplicated `optionalText` helper.** `src/app/(admin)/admin/catalog/actions.ts:87-90` and `src/app/(admin)/admin/settings/actions.ts:169-172`. Identical one-liner across two action modules. Acceptable under the rule of 2 today; promote to a shared form-helpers file once a third call site appears.
18. **Duplicated dollars-to-cents parsing.** `src/lib/catalog/admin.ts:23-27` (`priceSchema`) and `src/app/(admin)/admin/settings/actions.ts:163-167` (`dollarsToCents`). Both implement the same `^\d+(\.\d{1,2})?$` regex with `Math.round(Number(x) * 100)`, but one is a Zod schema and one is a plain function, with different error messages. Two sources of truth for "what a dollar amount looks like" is a drift risk. Centralize the money-from-form rule.
19. **Duplicated `?category=&sort=` URL builder.** `src/app/(storefront)/collection/page.tsx:93-99` (`buildHref`) and `src/components/storefront/catalog-controls.tsx:24-30` (`chipHref`). Both build the same `URLSearchParams` with the same "omit sort when it equals default" rule. The close-href and category-chip href must agree; today they agree by coincidence of duplicated code. Extract a shared helper.
20. **`saveProductAction` pre-casts `kind` to the union before Zod validation.** `src/app/(admin)/admin/catalog/actions.ts:25`. `String(formData.get('kind') ?? 'PACKAGE') as 'PACKAGE' | 'BUNDLE' | 'SPONSORSHIP'` casts the raw string to the union before `saveProduct`'s `productSchema` validates via `z.enum`. The cast lies to TypeScript and is harmless only because Zod catches it at runtime. No sibling action pre-casts an enum field this way. Drop the cast; let the schema own the narrowing.

## Top fix targets (builder starts here)

1. **M1** — `saveAddOn` cross-season restriction rows (admin.ts:185-190). Season invariant P4/P5 depends on.
2. **M2** — `saveProduct` season reassignment + `imageAssetId` existence (admin.ts:70-76).
3. **M3** — Form-supplied entity ids not validated for existence (admin.ts:60-92, :186-190).
4. **M4** — Settings actions validation pattern (settings/actions.ts).
5. **M5** — `setReplacementAction` error-surface pattern drift (catalog/actions.ts:49-60).

## Out of scope

Cart, checkout, POS, package board, shipping labels, routes/drivers, season management wizard, repeat orders, replacement-mapping admin (P10), Stripe/fee flows (P5). No findings made against these.
