# P10 Clean-code review — arm-02

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Scope:** `arms/arm-02/workspace/` files touched in P10 (see git status): `lib/repeat.ts`, `tests/repeat.test.ts`, the `app/api/admin/seasons/*`, `app/api/cron/season-flip`, `app/api/repeat`, `app/api/admin/orders/[id]/repeat`, `app/api/admin/repeat/bulk`, `app/api/admin/products/[id]` routes, the `components/account/repeat-review`, `components/admin/{bulk-repeat,repeat-order-button,catalog-manager,pos-client}`, `components/admin/settings/{orders-tab,season-management,types}`, and the page files that wire repeat links in.
**Rule set:** `arms/arm-02/rules/clean-code.md` (clean-code IS in scope).
**Mode:** Findings only, no fixes. Blind to model name.

---

## Findings

### Major

**M1 — Two competing HTTP-client helpers (consistency: one HTTP client per project).**
`lib/api-client.ts` is the documented single place for the `{ error }` convention, and every new P10 client component uses `apiFetch` (`season-management.tsx`, `repeat-review.tsx`, `bulk-repeat.tsx`, `repeat-order-button.tsx`). `components/admin/catalog-manager.tsx:32-39` defines its own `requestJson(url, init)` that re-implements fetch + Content-Type + error extraction. Two clients doing the same job is exactly the "one HTTP client — never two" rule. `catalog-manager.tsx` was touched this phase (replacement column), so this is in-scope drift, not legacy.

**M2 — Inconsistent date formatting (consistency: one date library / one pattern).**
Three different date-rendering approaches coexist in P10-touched files:
- `toISOString().slice(0, 16).replace("T", " ")` in `app/(admin)/admin/orders/[id]/page.tsx:102, 264, 310`
- `toLocaleDateString()` in `app/(storefront)/account/orders/page.tsx:58` and `account/orders/[id]/page.tsx:42`
- hand-rolled `toLocalInput` (pad year/month/day/hour/min) in `components/admin/settings/season-management.tsx:15-20`

No shared date helper exists. Pick one formatter for display and one for the datetime-local input, put them in `lib/`, and use them everywhere.

**M3 — `buildRepeatPlan` line-mapping block is a nested ~60-line god block.**
`lib/repeat.ts:161-222` is one `order.lines.map(...)` whose body has 3+ levels of nesting (map → if/else `same`/else → nested if `resolved.productId`/else → nested option/add-on filters), and which mutates `dropped`/`carryOptionIds`/`carryAddOns` declared with `let` outside the branches. The "same product" branch and the "replacement/unmapped" branch each deserve a named helper (`mapSameProductLine`, `mapReplacementLine`). Anti-AI-tics rule: "If a function has more than 3 levels of nesting, refactor it."

**M4 — `app/api/admin/seasons/route.ts` POST is a ~110-line god handler.**
`POST` (lines 22-134) inlines: schema validation, duplicate-name check, source-season existence check, two `db.product.findMany`/`db.addOn.findMany` fetches, then a `$transaction` containing a per-product copy loop (create product + create options + create inventory + link replacement) AND a per-add-on copy loop (create addOn + restrictions + inventory) AND the audit write. Extract `copySeasonCatalog(tx, sourceSeasonId, createdId)` (and probably `createProductCopy`) so the handler reads as policy, not mechanism.

### Minor

**m1 — `catalog-manager.tsx` mixes three concerns in one 337-line file.**
Products CRUD, add-ons CRUD, and season switching all live in one component. The file grew this phase (replacement picker column). Splitting `ProductsCard` and `AddOnsCard` into separate files (each with its own form state) would give each a single concern and let `replacementCandidates` flow only where it's needed.

**m2 — Back navigation on the repeat review page is hardcoded, not origin-aware.**
`app/(storefront)/account/orders/[id]/repeat/page.tsx:38` renders `← Back to {plan.orderLabel}` with a fixed `href={/account/orders/${order.id}}`. The user can arrive from either the orders list (`/account/orders`) or the order detail page, both of which link here. The clean-code UI rule: "back buttons go to where the user came from, not a hardcoded route." No exception is documented in the project README.

**m3 — `result` used as a standalone variable name in four files.**
`result` is on the banned-vague-names list. Occurrences:
- `components/account/repeat-review.tsx:58`
- `components/admin/repeat-order-button.tsx:18`
- `components/admin/bulk-repeat.tsx:30`
- `app/api/cron/season-flip/route.ts:15`

Name it after what it holds (`confirmResult`/`repeatResult`/`flipResult`/`cronResult`), or destructure `{ ok, body, error }` directly.

**m4 — `RepeatReview`'s `apiFetch` generic drifts from the server response shape.**
`components/account/repeat-review.tsx:58` calls `apiFetch<{ ok: boolean; added: number }>(...)`. The `ok` field is redundant (the `ApiResult` wrapper already carries `ok`), and the server (`app/api/repeat/route.ts:60`) actually returns `{ ok, added, unassigned }`. The generic should be `{ added: number; unassigned: number }`. As written, `result.body` is never read and `result.ok`/`result.error` come from the wrapper, so it works — but the type lies about the body shape. Compare `bulk-repeat.tsx:30`, which gets this right with `apiFetch<BulkSummary>`.

**m5 — `dropped` is computed for every line then overwritten in the "same" branch.**
`lib/repeat.ts:163-166` builds `dropped` from `line.options`/`line.addOns` unconditionally, but the `same`-product branch (lines 180-183) recomputes it from the inactive subset. The initial computation is dead work for same-product lines and misleads readers into thinking `dropped` is the final value. Move the initial `dropped` into the else branch, or compute it once from the active/inactive split.

### Nit

**n1 — `dueToOpen` "first wins" via `index === 0` is awkward.**
`app/api/cron/season-flip/route.ts:43-61` iterates `dueToOpen.entries()` and special-cases `index === 0`. Destructuring `const [winner, ...stale] = dueToOpen` (then close the stale ones) expresses the intent directly and removes the index branch.

**n2 — Duplicated datetime-local → ISO conversion.**
`components/admin/settings/season-management.tsx` converts `opens ? new Date(opens).toISOString() : null` in two places (`SeasonScheduleForm:56-58` and `NewSeasonCard:139-140`). A one-line `toIso(localInput)` helper next to `toLocalInput` would remove the duplication.

**n3 — `latestByCustomer` "keep first = latest" relies on an orderBy subtlety.**
`app/api/admin/repeat/bulk/route.ts:36-46` keeps the first row per customer because the query is ordered `finalizedAt desc, id desc`. That invariant is load-bearing but uncommented; a one-liner ("first seen wins because rows are pre-sorted latest-first") would stop a future refactor from re-ordering the query and silently changing which order gets repeated.

---

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| Major | 4 |
| Minor | 5 |
| Nit | 3 |
| **Total** | **12** |
