# Clean-code residual review — arm-01 (post self-fix, Test 5)

- **Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
- **Arm:** `arm-01`
- **Tree graded:** `arms/arm-01/workspace/` (full post-fix tree, `src/`, `scripts/`, `prisma/`, `tests/`)
- **Reviewer:** clean-code specialist (blind — no access to SELF-REVIEW / SELF-FIX notes)
- **Scope:** duplication, naming, god files, pattern drift. Findings only — no fixes.

## Severity summary

| Sev | Count | Categories |
|-----|-------|-----------|
| High | 3 | God file (`legacy-import.ts`), duplicated finalize-order flow, divergent admin error handling |
| Medium | 6 | Address-snapshot parsing dup, sha256 token-hash dup, env-access drift, bulk-loop dup, UI dup (package selects / address pickers), smoke-script boilerplate dup |
| Low | 5 | Empty placeholder route/page files, repeated Tailwind input class strings, `countDocument`/`superRefine` reduction dup, `importedTotals` recompute, inline magic time windows |
| Info | 2 | `Response` vs `NextResponse` mismatch, ` fulfillmentFees` re-export shape |

---

## High

### H1 — God file: `src/domain/legacy-import.ts` (469 lines, mixed concerns)
Single module owns four distinct concerns: zod schema + `superRefine` (1–73), document inspection (98–210), staging (212–243), and the commit migration (245–480). `commitLegacyImport` alone is ~235 lines and interleaves season upsert, customer merge, address upsert, product upsert, order/line creation, audit, and batch finalization in one transaction. Per the arm's own `clean-code.md` rule (split when >500 lines **or mixed concerns**), this file qualifies on the mixed-concerns axis. Each concern also has its own failure modes that are currently impossible to unit-test in isolation.

### H2 — Duplicated finalize-order flow (`src/domain/checkout.ts`)
`commitStripePayment` (252–367) and `finalizePosOrder` (369–415) share the same skeleton: `SELECT … FOR UPDATE` on `Order` → `loadCheckoutOrder` → `findCheckoutConflicts` → `reserveOrderInventory` → `season.nextOrderNumber` increment → `order.update` to `FINALIZED` + `orderNumber` → `materializeOrderPackages`. The Stripe variant then adds payment/intent/confirmation work; the POS variant stops after materialization. The shared preamble is ~30 lines repeated verbatim. A `finalizeOrder(transaction, orderId, { capturePayment })` helper would collapse the drift (the POS path already omits `cachedPaymentStatus`/`confirmationTriggeredAt` — that difference is currently implicit, not expressed).

### H3 — Divergent admin route error handling (pattern drift)
Three different conventions coexist for the same "permission/business error → response" concern:
1. `src/app/api/admin/delivery/route.ts` (65–73, 127–135) — inline `if (AccessDeniedError) 403; else 409 with message`. Uses **409** for every non-permission failure, including validation and not-found.
2. `src/app/api/admin/staff/route.ts` (9–14) — local `permissionError` helper: 403 for `AccessDeniedError`, **rethrow** otherwise (no fallback status).
3. `src/lib/admin-request.ts` `adminRequestErrorResponse` — 403 for `AdminCsrfError`, rethrow otherwise. Not used by the two routes above.

`clean-code.md` mandates "one error-handling approach per project." The 409-catch-all in `delivery/route.ts` is also semantically wrong (validation errors are not conflicts), and the inline-vs-helper split means future routes will copy whichever pattern the author sees first.

---

## Medium

### M1 — Address-snapshot parsing duplicated across modules
`addressText` in `src/domain/delivery.ts` (30–46) and `snapshotAddress` in `src/domain/shipping.ts` (116–130) both decode the same `Prisma.JsonValue` address snapshot (`line1/line2/city/region/postalCode/countryCode`). Same shape, same field list, two implementations (one joins into a string, one maps to a `ShippingAddress`). The `countryCode ?? "US"` default and the `Array.isArray`/object guard are duplicated. A single `parseAddressSnapshot(snapshot)` returning a structured object would let both consumers derive their output.

### M2 — `sha256` token-hash pattern repeated three ways
- `src/domain/delivery.ts` `hash()` (16–18) + `pinHash()` (20–22) — local helper.
- `src/app/api/admin/staff/route.ts` (66) — inline `createHash("sha256").update(inviteToken).digest("hex")`.
- `src/domain/legacy-import.ts` (222–224) — inline `createHash("sha256").update(JSON.stringify(document)).digest("hex")` for `checkpointKey`.

Three call sites, no shared `sha256Hex(value)` helper. `src/lib/ids.ts` already exists and is the natural home; instead each module re-imports `createHash` and rewrites the one-liner.

### M3 — Environment access drift
`src/lib/env.ts` defines a typed `readServerEnvironment()` and `requireEnvironmentValue()`, but most code reads `process.env` directly: `delivery.ts:88` (`MAPBOX_ACCESS_TOKEN`), `auth.ts:16` (`TEST_AUTH_SECRET`), `checkout/stripe/route.ts:203` (`APP_URL`), `messaging-outbox.ts` (none — good), `scripts/*.ts` (`APP_URL`, `CRON_SECRET`, `TEST_AUTH_SECRET`). `APP_URL`, `TEST_AUTH_SECRET`, `NODE_ENV`, `MAPBOX_ACCESS_TOKEN` are **not in the `ServerEnvironment` type**. `shipping.ts` `organizationAddress()` calls `readServerEnvironment()` on every invocation while sibling domain code uses raw `process.env`. Pick one: either everything goes through the typed accessor (and the type is completed), or the accessor is removed.

### M4 — Bulk "applied/conflicts" loop duplicated
The same loop shape — `for (const item of items) { try { …; applied.push(…) } catch (error) { conflicts.push({ id, reason: error.message }) } }` — appears in:
- `src/domain/repeat-orders.ts` `reviewOrdersInBulk` (368–403) and `repeatOrdersInBulk` (419–442)
- `src/domain/package-operations.ts` `bulkAdvancePackageStage` (296–312) and the `skipped` variant in `materializeMissingFinalizedOrders` (103–117)

Four call sites, three modules. The `MAX_REPEAT_BATCH` guard is also repeated twice in `repeat-orders.ts` (359, 412) with the same message string. A `runBulk<T>(items, op)` helper would centralize the try/catch/collect and the batch-size guard.

### M5 — Duplicated UI blocks
- **Package selects** in `src/components/fulfillment-board.tsx` (249–272): the source- and target-package `<select>` blocks are near-identical — same option list (`packages.map` → `{orderLabel} · {recipientName} · {id.slice(-6)}`), same classes, only the setter and placeholder label differ. Two copies, no `<PackageSelect>` component.
- **Address pickers** in `src/components/order-builder.tsx` (446–483): the `ON_ORDER` and `ADDRESS_BOOK` branches render the same `<AddressPicker>` with identical `onChange`/`onEdit`/`value` wiring; only the `addresses` source differs. The whole fieldset could be one render with a derived address list.
- **Inline fetch+message helper** in `fulfillment-board.tsx` `post()` (45–79) is a local copy of the "POST JSON → read `{applied,conflicts,error}` → `setMessage` → `router.refresh()`" pattern that almost certainly recurs in other admin components (`settings-hub.tsx` re-implements a stripped-down version at 54–61). Per `clean-code.md` "duplicated UI — extract shared components."

### M6 — Smoke-script boilerplate duplicated
`scripts/p4-smoke.ts` … `p12-smoke.ts` (8 files) each re-implement:
- The `.env` parse loop (`for (const line of readFileSync(".env"…)…) { … process.env[k] ??= v }`) — verbatim in at least `p9-smoke.ts:21–26` and `p12-smoke.ts:22–27`.
- The `managerHeaders()` HMAC test-auth helper (`p12-smoke.ts:37–48`).
- The `authSecret` default — and it **drifts**: `p9-smoke.ts:30` hardcodes `"p5-local-smoke-signing-key-2026"` ignoring env, while `p12-smoke.ts:33–34` reads `process.env.TEST_AUTH_SECRET ?? "p5-local-smoke-signing-key-2026"`. Same default, two access patterns.

A `scripts/lib/smoke-env.ts` (env loader + `managerHeaders(baseUrl, secret)`) would remove ~30 lines × 8 files and eliminate the `authSecret` drift.

---

## Low

### L1 — Empty placeholder route/page files (21 files, 0 bytes)
The tree contains 21 zero-byte `.ts`/`.tsx` files under dynamic route segments, e.g.:
- `src/app/api/order/drafts/[draftId]/route.ts` (0 bytes) — yet `OrderBuilder` calls `fetch('/api/order/drafts/${restoreDraftId}')` and `PATCH /api/order/drafts/${currentDraftId}`. An empty route file means every request 404s.
- `src/app/checkout/[draftId]/page.tsx` (0 bytes) — but `checkout/stripe/route.ts` redirects to `/checkout/${draft.id}`.
- `src/app/(admin)/admin/orders/[orderId]/page.tsx`, `…/repeat/page.tsx`, `src/app/api/admin/orders/[orderId]/payments/route.ts`, `…/refunds/route.ts`, `…/repeat/route.ts`, `src/app/api/admin/print-artifacts/[artifactId]/route.ts`, `src/app/(storefront)/account/orders/[orderId]/page.tsx`, etc.

These are either dead scaffolds or unfinished routes that the UI actually references. Per `clean-code.md` "dead code — delete, don't comment out." If they are intentional stubs, they should at least return a 501; as-is they are silent 404s masquerading as implemented features.

### L2 — Repeated Tailwind input/select class string
`"rounded-xl border border-[var(--border)] px-3 py-2"` (and the `rounded-lg` variant) is repeated for nearly every `<select>`/`<input>` across `order-builder.tsx`, `fulfillment-board.tsx`, `settings-hub.tsx`. No shared input class token or `<FieldInput>` component. Low severity (stable, short string) but it crosses the "duplicated UI" category.

### L3 — `countDocument` and `superRefine` reductions duplicated (`legacy-import.ts`)
`countDocument` (98–112) computes `addressCount`/`lineCount` via the same `.reduce` expressions that `legacyDocumentSchema.superRefine` (58–73) recomputes inline. Two sources of truth for the same totals.

### L4 — `importedTotals` recomputed (`legacy-import.ts:450–456`)
`commitLegacyImport` recomputes `document.orders.reduce((sum, o) => sum + o.totalCents, 0)` — the exact expression `inspectLegacyDocument` already returns as `sourceTotals.orderTotalCents` (203–208). The commit path calls `inspectLegacyDocument` (221) for `issues` but ignores its `sourceTotals` and re-derives the sum.

### L5 — Inline magic time windows
Several domain files inline duration constants without naming them:
- `delivery.ts:12` `routeLinkLifetimeMs = 7 * 24 * 60 * 60 * 1000` (named, good) but `:555` `14 * 24 * 60 * 60 * 1000` pickup expiry is inline; `:109` `30 * 24 * 60 * 60 * 1000` geocode cache TTL inline; `:13` `pinLockMs` named.
- `staff/route.ts:55` `7 * 24 * 60 * 60 * 1000` invite expiry inline.
- `messaging-outbox.ts:13` `OUTBOX_LEASE_MS = 2 * 60 * 1000` (named, good).

Inconsistent: some windows are named constants, some are inline `* 24 * 60 * 60 * 1000` expressions. Per `clean-code.md` "magic values — named constants."

---

## Info

### I1 — `Response.json` vs `NextResponse.json` mismatch
`src/lib/public-request.ts:78` returns `Response.json(...)` while `src/lib/admin-request.ts:28` returns `NextResponse.json(...)` for the same conceptual "error response" helper. Both work in Next.js, but the inconsistency is pattern drift across two sibling lib helpers.

### I2 — `fulfillmentFees` re-export shape (`checkout.ts:17–22`)
`checkout.ts` re-exports `calculateFulfillmentFees`, `CheckoutConflictError`, `fulfillmentFees`, and `CheckoutLineChoice` from `@/domain/fulfillment-fees` — a partial barrel. `checkout/stripe/route.ts:31` then reaches into `fulfillmentFees` keys via `Object.keys(fulfillmentFees)` to build a zod enum. The re-export is fine, but using `Object.keys` on a runtime object to derive a zod enum (instead of a shared `const FULFILLMENT_CODES = […]` source-of-truth array) is fragile — adding a code requires the runtime object to enumerate in a stable way.

---

## Notes / out of scope
- `.scratch/pgsql/pgAdmin 4/…` vendored JS exists under the workspace root (appeared in the size listing). Not graded as contestant code, but it should not be committed inside `workspace/` — flagging for the orchestrator, not a clean-code finding against arm-01's product code.
- Naming across the domain layer is generally strong (boolean `isAvailable`, `hasPermission`; collections plural; verbs for functions). No banned standalone names (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) found in the sampled files. The one soft spot is `value`/`payload` in `messaging-outbox.ts` and `env.ts` (`requireEnvironmentValue(name)`), which are acceptable in those contexts.
- Comment quality is clean — no narration or change-explanation comments found in the sampled files.
