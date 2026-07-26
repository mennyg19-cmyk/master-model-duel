# P3 fix pass — arm-04

**Input:** `results/AGGREGATE-REVIEW-P3.md` (0 blockers, 5 majors, 20 minors)
**Scope:** one pass over `workspace/`. No new features, no P4.
**Outcome:** 5/5 majors fixed · 13 minors fixed · 1 minor answered in writing (M7) · 1 needed no change (M5) · 5 deferred.
**Gates after the pass:** `npm run lint`, `npm run typecheck`, `npm run db:guard` green · **97/97 tests** · **39/39 P3 smoke checks** · **28/28 P1** · **21/21 P2**.

## Fixed — majors

| # | Fix | Where |
|---|---|---|
| 1 | `saveAddOn` now checks every restricted product id against the add-on's own season before it writes: the ids are deduped, counted with `seasonId` in the `where`, and a mismatch returns `INVALID_CATALOG_INPUT` ("An add-on can only be restricted to products in Purim 2027.") instead of writing cross-season rows. The dedupe also removes the duplicate-key path through `createMany`. Smoke P3-12 posts a previous-season product id at the real form: refused, 0 restriction rows written. | `src/lib/catalog/admin.ts` |
| 2 | `saveProduct` loads the existing product first and **pins `seasonId` to it** on update, so a posted season is ignored rather than moving a product away from its options, stock rows and slug uniqueness. Because the server no longer honours it, the editor stops offering the move: the season is rendered as text when editing and stays a select only when creating. `imageAssetId` is checked for existence before the write, so a stale or tampered photo id is a message, not a P2003 500. | `src/lib/catalog/admin.ts`, `src/app/(admin)/admin/catalog/product-form.tsx` |
| 3 | Both form-supplied id sets are now validated at the trust boundary — the photo id (major 2) and the restriction ids (major 1) — and the two Prisma codes that a stale form produces are translated: `P2002` to the duplicate-slug message it already had, `P2025` to "That product no longer exists." / "That add-on no longer exists." Nothing reaches the client as a Prisma error. | `src/lib/catalog/admin.ts` |
| 4 | The settings actions now share one shape: check the permission, parse the **whole** form with one named Zod schema, hand a failure to the page through `?error=`. `storeOpenSchema`, `orderSettingsSchema`, `packageTypeSchema`, `pickupLocationSchema`, `shippingSchema` and `emailSenderSchema` all carry their own plain-English messages, `firstMessage` reads the first issue and `rejectWith` does the redirect. The three ad-hoc styles (manual `Number()`, a hand-rolled regex helper, an inline `z.union`) are gone, and a comment at the top of the file says why settings redirect while catalog forms return state. | `src/app/(admin)/admin/settings/actions.ts` |
| 5 | `setReplacementAction` is a `useActionState` action like its two siblings: it takes the previous state, returns `{ error, notice }`, and the editor renders both inline. The `redirect('?error=…')` path and the page's `searchParams` plumbing are gone. | `src/app/(admin)/admin/catalog/actions.ts`, `[productId]/replacement-form.tsx`, `[productId]/page.tsx` |

## Fixed — priority minors

| Item | Fix |
|---|---|
| 1 · P2025 on a missing id | Caught for products and add-ons; `isMissingRecord` sits beside `isUniqueViolation` over one `hasPrismaCode` helper. |
| 4 · Replacement logged as a product save | New audit action `catalog.replacement_linked`, declared in the `AuditDetails` map with `{ slug, replacedByProductId }`, so the trail names the target and reads differently from a field edit. |
| 6 · `fromName` unvalidated | Required and capped at 80 characters by `emailSenderSchema`, with the reason in the message. Addresses stay "an email address, or blank". |
| 8 · Season-order rule untested | `tests/catalog-admin.test.ts` → "a replacement has to come from a later season" covers backwards, same-season, forwards and clearing the link. Cited by smoke P3-10. |
| 9 · `0` accepted as a dimension | `wholeNumber(unit)` refuses zero and keeps blank meaning "not measured yet". Test: "a size of zero is not a size". |
| 12 · Redundant `as ProductKind` | Dropped, along with the duplicate `kind` key the spread already carried. |
| 13 · `millimetres` schema used for grams | Replaced by `wholeNumber('millimetres' \| 'grams')`, so the message names the unit instead of apologising for the binding. |
| 14 · `storeOnDisk` had no containment check | `UPLOAD_ROOT` is resolved once and the resolved target must start with it, or the write throws naming the pathname. `buildPathname` is still the first lock; this is the second. |
| 15 · Duplicated needs-photos card | One `<NeedsPhotosCard products description />` behind both pages — the shared `data-testid` contract now has one component. |
| 16 · Duplicated season picker | One `<SeasonSelectForm action seasons selectedYear />` for catalog and add-ons. |
| 18 · Two dollar-amount rules | One `dollarsFromForm` schema in `src/lib/core/money.ts`; the product/add-on price and both shipping rates use it. |
| 19 · Two `?category=&sort=` builders | One `catalogHref(basePath, { category, sort })` in `src/lib/catalog/browse.ts`, used by the chips and the quick-view close link. Test: "the grid URL leaves out the default sort so one state has one address". |
| 20 · `kind` pre-cast before Zod | Gone. `ProductInput` types `kind` as the raw `string` the form posts and the schema owns the narrowing. |

## Answered rather than changed

| Item | Answer |
|---|---|
| 7 · No hard delete in catalog "CRUD" | Written down as a decision instead of shipping a delete: the D is deactivation (`isActive: false`), because order lines, packages and the archive all point at products and a hard delete would orphan them. Recorded in `.scratch/PHASE-P3-STATUS.md` § Decisions. |
| 5 · `beginImpersonation` re-check | The review itself concludes there is no bypass — `resolveImpersonation` re-checks `status: 'ACTIVE'` on every request. No change. |

## Deferred

| Item | Why |
|---|---|
| 2 · `loadByToken` timing difference | The extra round-trip only happens after a valid HMAC signature, which needs the server key to produce — an attacker cannot reach the branch that leaks, so there is no oracle to close. Equalizing would mean a database query for every unsigned request, which is a worse trade on an unauthenticated route. |
| 3 · No rate limit on newsletter subscribe | Real throttling needs shared state (a counter table or the cache layer) and a decision about what to do behind a proxy. That is a piece of infrastructure, not a fix, and R-122's public-endpoint guards land with the rest of the public write surface in P4/P5. |
| 10 · Uploads land under the current season year | The review marks it acceptable to defer: the asset row is assignable to any product, so only the folder name misleads. |
| 11 · Create form keeps its values after success | A `key`-based reset only fires when the notice text changes, so two creates in a row with the same name would silently not reset. A half-working reset is worse than a stale field the notice already explains. |
| 17 · Duplicated `optionalText` | Rule of 2: two call sites, one line each. Promote when a third appears. |

## Verification

- **Unit tests:** 97/97 (`npm test`). New file `tests/catalog-admin.test.ts` (5 tests) drives the real service functions against the database, plus one new browse test for `catalogHref`.
- **P3 smoke:** 39/39 (`.scratch/PHASE-P3-SMOKE.md`), up from 36. Three checks added, all over HTTP:
  - **P3-11** posts `seasonId` behind the product editor (the control no longer exists, so the post is exactly the tampered request): 200, and the product is still in Purim 2027.
  - **P3-12** posts a Purim 2026 product id as an add-on restriction: refused, 0 rows written.
  - **P3-10** cites the five new unit tests by name.
- **Earlier phases:** P1 28/28, P2 21/21 re-run after the pass.
- **Note for whoever runs these next:** a bare `npm test` inherits `DATABASE_URL` from `.env` (node's `--env-file` does not override an existing variable) and its fixtures truncate every table, so the development database is empty afterwards. The smoke runs are unaffected — `runTests` passes the test URL explicitly — but re-seed with `npm run db:fresh && npm run seed` before smoking after a manual test run. Recorded in `.scratch/PHASE-P3-STATUS.md` § How to reproduce.

## Not touched

Cart, checkout, POS, package board, shipping labels, routes and drivers, the season
wizard, repeat orders, the replacement-mapping admin, Stripe and fee flows. No P4 work
started.
