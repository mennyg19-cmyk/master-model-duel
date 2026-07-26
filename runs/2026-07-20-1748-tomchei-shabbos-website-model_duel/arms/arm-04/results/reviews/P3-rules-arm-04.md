# P3 Rules Review — arm-04 (blind)

Reviewer: external, rules specialist. Scope: P3 delta only (`shared/MERGED-BUILD-PLAN.md` § P3). Findings only — no fixes. Arm rules graded: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph` (from `arms/arm-04/ARM.md`).

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 5 |

P3 delivers all 8 EXPECTED items with strong HTTP smoke evidence (36/36 in `.scratch/PHASE-P3-SMOKE.md`). The delta is well-factored: pure rules in `lib/catalog/browse.ts` (no Prisma, no `server-only`) are unit-testable; `lib/newsletter/tokens.ts` signs with a purpose string and `timingSafeEqual`; `lib/media/validation.ts` sniffs bytes and rejects SVG; `lib/store-state.ts` centralizes the two-switch gate. No god files. No new deps beyond `@vercel/blob` (lazy-imported). The audit trail, permission gates, and Result-typed library functions are consistent with P1–P2 conventions.

## Findings

### Major

**M1 — Inconsistent validation/error pattern across settings actions.** `src/app/(admin)/admin/settings/actions.ts`. `clean-code.mdc` § Consistency: "One error-handling approach per project." The four P3 settings actions use three different validation styles:
- `saveOrderSettingsAction` (lines 31–43): manual `Number()` + `Number.isInteger` range check, redirects with a hardcoded message string.
- `savePackageTypeAction` / `savePickupLocationAction` (lines 45–94): named zod schemas, redirect with `parsed.error.issues[0].message`.
- `saveShippingSettingsAction` (lines 96–123): manual regex `dollarsToCents` helper, no zod.
- `saveEmailSettingsAction` (lines 125–142): inline `z.union([z.email(), z.literal('')])`, no named schema.

Meanwhile the catalog actions (`saveProductAction`, `saveAddOnAction`) use the `Result<T>` pattern from `lib/`. The split between "library returns Result" and "action redirects" is defensible, but the settings actions themselves do not follow one validation approach.

### Minor

**m1 — Redundant type assertion.** `src/lib/catalog/admin.ts:71`. `clean-code.mdc` § Anti-AI-Tics: "No redundant type assertions the compiler already guarantees." `kind: parsed.data.kind as ProductKind` — `productSchema` already validates `kind` via `z.enum(['PACKAGE','BUNDLE','SPONSORSHIP'])`, so the cast adds nothing. The same value is also already present in the `...fields` spread, making the explicit `kind` key a duplicate override.

**m2 — Misleading schema name reused for weight.** `src/lib/catalog/admin.ts:34`. `clean-code.mdc` § Naming. `const millimetres = z.string()...` is reused for `weightGrams` (line 51). The error message correctly says "millimetres or grams", but the binding `weightGrams: millimetres` reads as a unit mismatch. A neutral name (`wholeNumber`/`dimensionOrWeight`) would not mislead.

**m3 — Replacement-link change logged as product save.** `src/lib/catalog/admin.ts:130–135`. `clean-code.mdc` § Accuracy. `setReplacementLink` records `action: 'catalog.product_saved'` with `created: false`. The `AuditDetails` type (`src/lib/audit.ts:32`) has no dedicated action for replacement links, so the audit trail cannot distinguish "product fields edited" from "replacement link set". Who/when/which entity are correct; the action label is not.

**m4 — `imageAssetId` not validated for existence before write.** `src/lib/catalog/admin.ts:60–92`. `clean-code.mdc` § Error Handling: "Error messages say what went wrong AND what the expected state was." `productSchema` accepts any string for `imageAssetId` (optional text). A stale form submitting a deleted asset id fails the FK constraint with Prisma `P2003`, which `isUniqueViolation` does not catch, so the action throws a 500 instead of a friendly `INVALID_CATALOG_INPUT` failure. The form is server-rendered so this is unlikely, but the gap exists.

**m5 — `storeOnDisk` relies on `buildPathname` sanitization alone.** `src/lib/media/storage.ts:51–60`. `workflow.mdc` § Security Basics. `path.resolve(process.cwd(), LOCAL_UPLOAD_DIRECTORY, pathname)` has no containment check after resolve. Safety depends entirely on `buildPathname` stripping non-`[a-z0-9]` characters. A defense-in-depth `resolved.startsWith(UPLOAD_ROOT)` would protect against a future caller bypassing `buildPathname`. Not an exploitable gap today.

## Out of scope

Cart, checkout, POS, package board, shipping labels, routes/drivers, season wizard, repeat orders, replacement-mapping admin (P10), Stripe/fee flows (P5) — all untouched per EXPECTED, confirmed by diff. No P3 file touches those areas.

## Reproduce

```bash
npm install
npm run db:start          # separate terminal
npm run db:deploy && npm run seed
npm run ci                # lint, typecheck, migration guard, 91 tests
npm run dev               # separate terminal
npm run smoke:p3          # 36 checks
```
