# Residual Clean-Code Review — arm-03 (blind)

Test 5 · External residual reviewer (clean-code)
Tree reviewed: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-03/workspace`
Post self-fix state. Findings only — no fixes applied.

Scope: duplication, naming, god files, pattern drift.

## Summary

| Category | Count |
|---|---|
| God files (mixed concerns) | 3 (1 strong, 2 borderline) |
| Duplicated logic / types | 3 |
| Pattern drift / co-location | 3 |
| Dead / redundant code | 1 |
| Naming / structure (minor) | 2 |
| **Total findings** | **12** |

## Findings

### F1 — God file: `src/lib/routes/service.ts` (965 lines, 19 exports, ≥5 concerns)  [strong]

The module bundles five unrelated concerns under one filename:

1. Crypto / PIN hashing — `hashToken`, `hashPin`, `verifyPinHash`, `isMagicPinUnlocked`
2. Magic-link lifecycle — `issueMagicLink`, `isMagicLinkActive`, `loadMagicLinkSession`, `verifyMagicPin`, `startRouteViaMagicLink`
3. Route CRUD — `listRoutes`, `getRouteDetail`, `createRouteFromPackages`, `reassignRoute`, `removeRouteStop`
4. Stop delivery — `markStopDelivered`, `markStopDeliveredFromPrint`, `printRoute`
5. Reroute logic — `suggestReroutes`, `confirmReroute`

`hashToken` / `hashPin` are also security primitives with no business being next to route CRUD. Split candidates: `routes/crypto.ts`, `routes/magic-link.ts`, `routes/service.ts` (CRUD only), `routes/stops.ts`, `routes/reroute.ts`. Violates the project god-file rule (>500 lines + mixed concerns).

### F2 — Duplicated "No season" 409 guard across 10 admin route files (16 occurrences)  [strong]

Identical 4-line block repeated in every admin API route that needs a season:

```ts
const season = await getCurrentSeason();
if (!season) {
  return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
}
```

Files (HEAD): `admin/routes/route.ts` (×2), `admin/routes/[id]/route.ts` (×2), `admin/packages/route.ts` (×2), `admin/packages/[id]/route.ts` (×2), `admin/pickup/route.ts` (×2), `admin/print-batches/route.ts` (×2), `admin/bulk-delivery/route.ts`, `admin/fulfillment/route.ts`, `admin/packages/[id]/method/route.ts`, `admin/print-batches/artifacts/[artifactId]/route.ts`.

`lib/storefront/season.ts` already exports `getCurrentSeason`; a sibling `requireCurrentSeason()` (returning `Season` or throwing `ApiError(409, "No season")`) would collapse all 16 copies and route the error through the existing `apiErrorResponse` path.

### F3 — Duplicated client-side POST fetch boilerplate (30+ occurrences across ≥12 components)  [strong]

The shape

```ts
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const json = await res.json();
```

is copy-pasted across `admin/order-detail.tsx`, `admin/staff-manager.tsx`, `admin/catalog-admin.tsx`, `admin/settings-hub.tsx`, `admin/addon-admin.tsx`, `admin/media-admin.tsx`, `admin/setup-form.tsx`, `account/account-dashboard.tsx`, `order/assign-dialog.tsx`, `order/cart-sidebar.tsx`, `storefront/newsletter-form.tsx`, and others. `src/lib` has no `postJson` / `apiFetch` helper (grep for `postJson|apiFetch|fetchJson|requestJson` returns nothing). Extract a `lib/http/postJson.ts` (or extend `lib/http/public-guard.ts`) so the content-type header and JSON parse live in one place.

### F4 — Type/schema drift: `TestModeSetting` defined twice, `TEST_MODE_KEY` literal duplicates `OPS_SETTINGS.testMode`  [strong]

- `src/lib/ops/settings-keys.ts` lines 13-16: `export type TestModeSetting = { enabled: boolean; env: "test" | "live" }`
- `src/lib/ops/test-ops.ts` lines 27-30: an identical `export type TestModeSetting = { enabled: boolean; env: "test" | "live" }`

Same shape, two sources of truth. Worse, `test-ops.ts` line 25 declares `export const TEST_MODE_KEY = "ops.testMode"` while line 15 of the same file imports `OPS_SETTINGS` from `settings-keys.ts` — and `OPS_SETTINGS.testMode` is already `"ops.testMode"`. The constant and the `OPS_SETTINGS` entry are the same string, kept in parallel. Pick one source (keep `OPS_SETTINGS.testMode` + the type in `settings-keys.ts`, re-export from `test-ops.ts`).

### F5 — Pattern drift: `APP_URL` bypassed in `routes/service.ts`  [medium]

`lib/env.ts:18` centralizes `APP_URL` with a zod-validated default `http://127.0.0.1:3103`. Two consumers use it correctly:

- `lib/stripe/client.ts:91` → `getEnv().APP_URL.replace(/\/$/, "")`
- `lib/http/public-guard.ts:63` → `new URL(env.APP_URL).origin`

But `lib/routes/service.ts:321` reads `process.env.APP_URL?.replace(/\/$/, "") || "http://127.0.0.1:3103"` directly, skipping env validation and duplicating the default literal. Should call `getEnv().APP_URL` like the others.

### F6 — Co-location / naming: `normalizeZip`, `isDeliveryZipAllowed`, and default content live in `storefront/settings-keys.ts`  [medium]

`src/lib/storefront/settings-keys.ts` is named for keys, but also exports:
- `normalizeZip` (line 47), `isDeliveryZipAllowed` (line 51) — zip normalization helpers
- `DEFAULT_DELIVERY_ZIPS`, `DEFAULT_IMPACT`, `DEFAULT_TESTIMONIALS`, `ImpactStat`, `Testimonial` — default content / marketing types

A "settings-keys" module should hold keys and their types, not normalization helpers and default marketing copy. Co-locate zip helpers with address (`lib/address/`) or a dedicated `lib/storefront/delivery-zips.ts`, and move defaults to a content module.

### F7 — Dead / redundant code: identical error branches in `src/app/api/checkout/route.ts:108-111`  [low]

```ts
} catch (error) {
  if (error instanceof AuthError) return apiErrorResponse(error);
  return apiErrorResponse(error);
}
```

Both branches call `apiErrorResponse(error)` with the same argument; the `instanceof AuthError` check adds nothing. `apiErrorResponse` already special-cases `AuthError` internally (see `lib/api-error.ts:18`). Drop the conditional, keep only the fallthrough.

### F8 — Co-location: `bulkUpdateOrderStatus` misplaced in `src/lib/ops/repeat.ts:614`  [medium]

`ops/repeat.ts` is themed around repeat orders (`previewRepeatOrder`, `confirmRepeatOrder`, `repeatOrder`, `bulkRepeatOrders`). `bulkUpdateOrderStatus` is a status mutation, not a repeat operation, and `ops/orders.ts` already owns order queries (`listOrders`, `getOrderDetail`, `dashboardKpis`, `todayWorkQueue`). Move it to `ops/orders.ts` so order state lives in one module.

### F9 — Borderline god file: `src/lib/ops/repeat.ts` (665 lines)  [medium]

Five exports, all repeat-themed except the misplaced `bulkUpdateOrderStatus` (F8). Large but mostly cohesive. After F8 is moved out and `previewRepeatOrder` / `confirmRepeatOrder` share their preview-builder helper (currently inlined), the file should drop under the 500-line guide.

### F10 — Borderline god file: `src/lib/ops/import.ts` (671 lines)  [medium]

Three exports (`stageImport`, `getImportBatch`, `commitImport`) plus an embedded hand-rolled CSV parser (`parseCsv`, `headerMap`, `cell`, lines 23-77). The parser is a reusable concern with no second caller today (Rule-of-2 says leave for now), but it is the reason the file is large. If a second import path appears, extract `lib/csv/parseCsv.ts` first; until then, the size is tolerable but watch.

### F11 — Minor: `src/lib/constants.ts` is a single-export module  [low]

The file contains only `export const SETUP_LOCK_KEY = "setup.bootstrapComplete";` and its sole consumer is `lib/auth.ts`. A "constants" file with one entry is a premature module. Either fold it into `lib/settings.ts` (which already owns `appSetting` access) or into `lib/auth.ts` near its consumer. Not urgent, but don't grow a grab-bag.

### F12 — Minor: two parallel "test" modules with no clear split rationale  [low]

- `src/lib/ops/test-console.ts` — single export `runDressRehearsal`
- `src/lib/ops/test-ops.ts` — 7 exports: test-mode (`getTestMode`/`setTestMode`/`isTestEnvAllowed`) + fixtures (`wipeTestFixtures`/`reseedTestSeason`/`ensureScaleFixtures`/`scalePrintProbe`)

The two-file split has no documented rationale. Either merge into one `ops/test.ts`, or split by concern (test-mode vs fixtures). Today the naming implies a console-vs-ops distinction that the contents don't support.

## Notes on what is already clean

- Error handling is consistent: single `ApiError` + `apiErrorResponse` path, `Result<T>` for service-layer returns, `maskError` for production masking.
- Permission gating is unified through `requirePermission` / `requireAdminPage` / `withPublicGuard`; the two `require*Permission` variants in `auth.ts` are genuinely different (one respects impersonation, one ignores it).
- `lib/orders/*` is well-split by concern (`drafts`, `draft-access`, `draft-wire`, `finalize`, `grouping`, `guest-token`, `lock`, `package-stages`, `state-machine`, `totals`).
- `lib/storefront/catalog.ts` vs `catalog-shared.ts` split (queries vs shared types) is justified.
- UI primitives `Button` and `Input` exist and are used in ~23 and ~3 components respectively — but see F3 for the missing `postJson` companion.

## Method

- File inventory and line counts via `git ls-files` + `Get-Content | Measure-Object -Line` against the committed post-self-fix tree (HEAD), since the working tree has uncommitted deletions for several tracked files.
- Concern boundaries identified by listing top-level exports per file (`^export (async )?function|^export const|^export type`).
- Duplication confirmed by `git grep -c` across `src/app/api/admin` and `src/components`.
- No code changes made; this is a findings-only residual review.
