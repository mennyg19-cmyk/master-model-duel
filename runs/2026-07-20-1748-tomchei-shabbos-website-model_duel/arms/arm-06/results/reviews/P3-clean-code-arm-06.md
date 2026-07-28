# P3 Clean-Code Review — arm-06 (blind)

**Scope:** new P3 storefront/catalog/archive/newsletter/admin-catalog/media code under
`arms/arm-06/workspace/` — `app/(storefront)/{page,packages/*,past-collections,unsubscribe,checkout,order,layout}.tsx`,
`components/storefront/*`, `app/(admin)/admin/{products,addons,media,settings}/*`,
`app/api/{admin/products,admin/addons,admin/media,admin/settings,subscribe,unsubscribe,uploads}/*`,
`lib/{storefront/catalog,catalog/product-input,media/*,newsletter/*,seasons/*,settings,money,api-fetch}.ts`.

**Focus:** duplication, naming, god files, pattern drift. Findings only — no fixes.
**Severity bands:** Blocker / Major / Minor. File paths cited.

---

## Blockers

None. The P3 surface is internally coherent, the catalog/newsletter/media/admin flows
share one query shape (`catalogProductInclude`), one client helper (`apiFetch`), one
price discipline (`dollarsToCents` at the trust boundary), and one auth gate
(`requireApiPermission`). No god files (largest is `settings-tabs.tsx` at 357 lines,
single concern, under the 500-line split trigger).

---

## Major

### M1. Duplicated product image + fallback glyph across three storefront pages
The "render the first media URL, else a package-glyph SVG" block is copy-pasted in three
storefront render sites with only the wrapper classes and glyph size differing:

- `app/(storefront)/packages/packages-grid.tsx:98-110` (glyph 56×56) plus the standalone
  `PackageGlyph` component at `packages-grid.tsx:228-236`.
- `app/(storefront)/past-collections/page.tsx:44-55` (glyph 48×48, inline SVG, no
  component).
- `app/(storefront)/packages/[slug]/page.tsx:58-69` (glyph 72×72, inline SVG, no
  component).

The same `M12 3l9 5-9 5-9-5 9-5z` package SVG path appears verbatim in all three, and the
same `eslint-disable-next-line @next/next/no-img-element -- uploads come from the local
driver or Blob` justification comment is repeated in all three (plus two admin sites —
`admin/media/media-manager.tsx:141`, `admin/products/[id]/page.tsx:140`).

`PackageGlyph` already exists in `packages-grid.tsx` but is not exported or reused — the
other two pages re-inline the SVG. This is a clear Rule-of-2 extraction (3+ call sites
right now): a shared `ProductImage` component (image + fallback glyph + the eslint
disable) would collapse all five sites and remove the drift in glyph size / path / comment
wording. Violates `clean-code.mdc` "duplicated UI — extract shared components" and
"copy-paste patterns with minor variations — extract the pattern."

---

## Minor

### m1. Vague function name `note`
`app/(admin)/admin/settings/settings-tabs.tsx:64` defines `function note(result, okMessage)`
whose body sets `status`/`error` state and calls `router.refresh()`. "note" does not
describe what it does — it is a status-reporter, not a note. `clean-code.mdc` Naming:
"Function names describe what they DO." Rename to `reportSaveResult` or `setStatusFromResponse`.

### m2. Vague variable name `data`
`app/api/admin/addons/[id]/route.ts:35` declares `const data: { name?: string; priceCents?:
number; active?: boolean } = {}` and then mutates and passes it to `prisma.addOn.update`.
"data" is on the banned standalone list (`clean-code.mdc` Naming). It holds the patch
payload — `patchPayload` or `updateFields` would say so.

### m3. Vague state name `result`
`app/(storefront)/checkout/zip-check-form.tsx:12` holds the delivery-check outcome in
`const [result, setResult] = useState<{ deliverable: boolean; postalCode: string } | null>(null)`.
"result" is on the banned standalone list. `deliveryResult` or `zipCheck` would read as
the yes/no question the rule asks for.

### m4. Vague loop variable `item`
`components/admin/sidebar.tsx:17` iterates `items.map((item) => { … })`. "item" is on the
banned standalone list. The array is `SidebarItem[]` with `href`/`label` — `link` or
`navItem` is the obvious rename.

### m5. Swallowed error in settings POST catch
`app/api/admin/settings/route.ts:29-39` wraps `setSetting` in `try { … } catch { return
NextResponse.json({ error: "That value doesn't match…" }, { status: 400 }); }`. The catch
binding is discarded and the real validation/parse error is replaced by a generic string,
so a schema bug or a Prisma failure looks identical to a bad-shape client input.
`clean-code.mdc` Error Handling: "No swallowed errors" and "Error messages say what went
wrong AND what the expected state was." At minimum log the caught error server-side; the
client-facing message can stay generic.

---

## Summary

| Band   | Count |
|--------|-------|
| Blocker | 0     |
| Major   | 1     |
| Minor   | 5     |

The dominant theme is **one piece of duplicated UI** (M1): the product-image-with-fallback
pattern is inlined three times in the storefront (and the glyph SVG itself three times),
while a `PackageGlyph` component already exists in one of the three files but is not
shared. The minor findings are all naming-hygiene (banned standalone names `data`,
`result`, `item`, and the undescriptive `note`) plus one error-swallowing catch. No
pattern drift between P3 files — `apiFetch`, `parseBody`, `requireApiPermission`,
`dollarsToCents`, and `catalogProductInclude` are reused consistently across the new
routes and pages.
