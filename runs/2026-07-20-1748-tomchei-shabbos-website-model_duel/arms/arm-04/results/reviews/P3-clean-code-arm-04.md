# P3 Clean-Code Review — arm-04 (blind)

Reviewer: external clean-code specialist
Scope: P3 delta in `arms/arm-04/workspace/` — storefront (home, shell, collection, archive, newsletter), admin catalog & add-ons, media library, settings hub.
Plan ref: `shared/MERGED-BUILD-PLAN.md` § P3; EXPECTED: `shared/phases/PHASE-P3-EXPECTED.md`.
Findings only — no fixes. No scope beyond P3.

## Summary

- Blocker: 0
- Major: 1
- Minor: 8

## Major

### M1 — Pattern drift: replacement action uses `redirect()` for errors while sibling actions use `useActionState` return

`src/app/(admin)/admin/catalog/actions.ts:49-60`

`setReplacementAction` is a plain form action that surfaces failure via
`redirect('/admin/catalog/${productId}?error=...')`, while `saveProductAction`
(lines 11-47) and `saveAddOnAction` (lines 62-85) in the same file use the
`useActionState` pattern returning `{ error, notice }` for inline errors. Two
error-handling patterns coexist in one file for the same admin section, so the
product editor shows an inline alert while the replacement editor on the same
page reloads with a query-string error. The `revalidatePath` on line 58 also
runs unconditionally before the redirect, which is correct but only because
`redirect` throws — the ordering reads as if both paths return.

## Minor

### m1 — Duplicated `needs-photos` card JSX

`src/app/(admin)/admin/catalog/page.tsx:86-106` and
`src/app/(admin)/admin/media/page.tsx:43-63`

The same `<Card data-testid="needs-photos">` block with the same
`needs-photo-link` list is rendered verbatim in two pages. Both call
`productsNeedingPhotos(seasonId)` and map the result to identical markup. A
shared `<NeedsPhotosCard products={...} />` component would remove the
copy-paste; the `data-testid` contract already implies a single component.

### m2 — Duplicated season-select GET form

`src/app/(admin)/admin/catalog/page.tsx:57-78` and
`src/app/(admin)/admin/catalog/add-ons/page.tsx:58-79`

The same `method="get"` season picker — same `<select name="season">`, same
classes, same "Show" button — is duplicated across the catalog and add-ons
pages. A small `<SeasonSelectForm action={...} seasons={...} selected={...} />`
would keep them from drifting (e.g. one gaining a label the other lacks).

### m3 — Duplicated `optionalText` helper

`src/app/(admin)/admin/catalog/actions.ts:87-90` and
`src/app/(admin)/admin/settings/actions.ts:169-172`

Identical one-liner duplicated across two action modules. Belongs in a shared
form-helpers file once a third call site appears; today it is a stable
two-call-site duplicate and acceptable under the rule of 2, but worth noting
because it is the kind of helper that grows a third call site quickly.

### m4 — Duplicated dollars-to-cents parsing

`src/lib/catalog/admin.ts:23-27` (`priceSchema`) and
`src/app/(admin)/admin/settings/actions.ts:163-167` (`dollarsToCents`)

Both implement the same `^\d+(\.\d{1,2})?$` regex with `Math.round(Number(x) * 100)`,
but with different error messages and one as a Zod schema, one as a plain
function. Two sources of truth for "what a dollar amount looks like" is a drift
risk — a future rule (e.g. allow `$36.5`) would need to be changed in both.
Centralize the money-from-form rule.

### m5 — Duplicated `?category=&sort=` URL builder

`src/app/(storefront)/collection/page.tsx:93-99` (`buildHref`) and
`src/components/storefront/catalog-controls.tsx:24-30` (`chipHref`)

Both build the same `URLSearchParams` with the same "omit sort when it equals
the default" rule. The close-href for quick-view and the category-chip href
must agree, and right now they agree by coincidence of duplicated code rather
than by sharing a helper.

### m6 — `millimetres` schema name applied to `weightGrams`

`src/lib/catalog/admin.ts:34-38`

The schema is named `millimetres` and its error message says "Sizes and weights
are whole numbers of millimetres or grams" — but it is reused for `weightGrams`
(line 51). The name lies about one of its uses; the error message compensates by
listing both units. Rename to `wholeNumberDimension` or split into
`millimetres`/`grams` so the name does not have to apologize in its own error
string.

### m7 — `setReplacementLink` logs as `catalog.product_saved` with `created: false`

`src/lib/catalog/admin.ts:130-135`

A replacement-link change is audited with action `catalog.product_saved` and
`detail.created: false`, even though no product field was saved — only
`replacedByProductId` moved. The audit action misnames the event; a reader of
the audit trail cannot distinguish "product edited" from "replacement link
set". Either reuse is acceptable, but the action name should reflect it (e.g.
`catalog.replacement_linked`) or the detail should carry a `field` marker.

### m8 — `saveProductAction` pre-casts `kind` to the union before Zod validation

`src/app/(admin)/admin/catalog/actions.ts:25`

`String(formData.get('kind') ?? 'PACKAGE') as 'PACKAGE' | 'BUNDLE' | 'SPONSORSHIP'`
casts the raw string to the union type before handing it to `saveProduct`,
whose `productSchema` then validates via `z.enum`. The cast lies to TypeScript
and is harmless only because Zod catches it at runtime. No sibling action
pre-casts an enum field this way (`saveAddOnAction` passes raw strings). Drop
the cast and let the schema own the narrowing.

## Notes (not findings)

- `readStoreState()` is called once in the storefront layout and again in
  each storefront page. This is App Router reality (separate RSC boundaries),
  not duplication of intent, so it is not counted here.
- `settings/actions.ts` mixes seven settings domains (store open, follow-up,
  package types, pickup locations, shipping rates, delivery ZIPs, email
  sender) in one 173-line file. Each function is small and self-contained, so
  the file is not a god file by size; a split-by-tab would be reasonable but is
  not required.
- `browseCatalog` filters and sorts the full season catalog in memory. This is
  documented and intentional for the expected catalog size; not a finding.
