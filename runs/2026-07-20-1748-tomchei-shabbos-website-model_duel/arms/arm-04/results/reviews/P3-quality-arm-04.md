# P3 Quality Review — arm-04 (blind)

**Phase:** P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media
**Reviewer role:** Quality specialist
**Scope:** P3 delta + regressions vs `shared/phases/PHASE-P3-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P3.
**Evidence:** source read of `arms/arm-04/workspace/src/**`, `.scratch/PHASE-P3-SMOKE.md`, `tests/**`, migration SQL. Findings only — no fixes.

## Verdict

All 8 EXPECTED items are delivered with real, working code. 36/36 P3 smoke checks pass (`.scratch/PHASE-P3-SMOKE.md`); 91/91 tests pass; `npm run ci` green. No stubs — `/order` is the P3 gate (open-store rule + delivery-ZIP check), not a placeholder; the cart builder is correctly deferred to P4. No P1/P2 regressions (P1 28/28, P2 21/21 still green per status doc). Season gate, archive browse-only, HMAC unsubscribe, byte-sniffed upload validation, and the four-tab settings hub all match EXPECTED.

## Blockers

None.

## Major

1. **Server actions trust form-supplied entity ids without validating existence.** `saveProduct` passes `imageAssetId` straight into `db.product.create/update` with no lookup; a tampered or stale id produces an uncaught Prisma FK violation (500) instead of a friendly `Result` failure. `src/lib/catalog/admin.ts:60-92` via `src/app/(admin)/admin/catalog/actions.ts:31`. Same class of gap in `saveAddOn` for `restrictedToProductIds` — `createMany` throws on a deleted/invalid product id. `src/lib/catalog/admin.ts:186-190` via `actions.ts:78`. The forms only offer valid ids, but trust-boundary validation cannot rely on the client (per `clean-code.mdc`).

## Minor

1. **Replacement-link changes are logged as `catalog.product_saved`.** `setReplacementLink` writes `action: 'catalog.product_saved', detail: { slug, seasonYear, created: false }` — the audit trail cannot distinguish a replacement link edit from a field save, and never records the target product id. `src/lib/catalog/admin.ts:130-135`.
2. **No hard delete in catalog "CRUD".** Plan § P3 says "CRUD"; only Create/Read/Update ship. Deactivation via `isActive: false` is the soft-delete, which is the right call for an order system (hard delete would orphan order lines), but the D is absent. `src/lib/catalog/admin.ts`, `src/app/(admin)/admin/catalog/actions.ts`.
3. **`setReplacementLink` "later season" rule has no unit test.** Smoke P3-3 only asserts the editor renders; the forward-only-season business rule is enforced in code but not covered by `tests/`. `src/lib/catalog/admin.ts:116-121`.
4. **`millimetres` schema accepts 0.** `z.string().regex(/^\d*$/).transform(...)` lets "0" through as `0`, a nonsensical package dimension that would break rate shopping later. `src/lib/catalog/admin.ts:34-38`.
5. **`uploadImageAction` always writes to the current season year's folder.** A manager uploading a photo for an archive product still lands it under `catalog/{currentYear}/...`. Cosmetic — the asset row is assignable to any product regardless of path. `src/app/(admin)/admin/media/actions.ts:25`.
6. **Create form does not reset after success.** `useActionState` + `defaultValue` keeps the last entered values visible after a successful product/add-on create; the notice clarifies, but the stale fields are mildly confusing. `src/app/(admin)/admin/catalog/product-form.tsx:60`, `add-on-form.tsx:45`.

## Counts

- Blockers: 0
- Major: 1
- Minor: 6
