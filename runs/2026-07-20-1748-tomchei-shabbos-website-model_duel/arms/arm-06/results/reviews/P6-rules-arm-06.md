# P6 Rules review — arm-06 (blind)

**Phase:** P6 — Admin operations hub & POS (dashboard, Today queue, order list/detail + refund, POS, customer directory, CSV import, admin chrome, settings hub, bounded list + bulk actions)
**Rules checked:** `arms/arm-06/.cursor/rules/{clean-code,ponytail,workflow,vocabulary,codegraph}.mdc`
**Reference:** `shared/phases/PHASE-P6-EXPECTED.md` (6 must-be-true items, S1–S4 smoke)
**Scope:** `arms/arm-06/workspace/` — P6 deliverables only. Pages: `app/(admin)/admin/{page,orders,orders/[orderId],pos,customers,customers/[customerId],imports,imports/[batchId],settings,audit}/`. Lib: `lib/admin/{dashboard,order-list}.ts`, `lib/orders/{bulk,repeat}.ts`, `lib/imports/{engine,kinds,customers,products}.ts`, `lib/customers/directory.ts`. Routes: `app/api/admin/{orders,orders/[orderId]/payments,orders/bulk,customers,customers/[customerId],imports,imports/[batchId]/{commit,discard}}/**`. P3–P5 domain core read only for context.
**Method:** Findings only, no fixes. Blind to model name. Severity: Blocker / Major / Minor.

## Adherence summary (rules honored)

- **clean-code — one pattern per concern:** the P6 admin surface follows the documented README patterns — `apiFetch` for client mutations, `parseBody` + zod on every JSON body, `recordAudit` inside the same `$transaction` as the write (payment post, customer update, import stage/commit/discard, bulk action), integer cents via `lib/money.ts`, `requirePermission`/`requireApiPermission` gates, `BackLink`/`Sidebar`/`Badge`/`Card` chrome. List state is URL-as-truth with shared `clampPage`/`pageCount`/`parsePageSize` from `lib/admin/order-list.ts` (Rule of 2 honored — the customers directory reuses the order-list helpers rather than forking them).
- **clean-code — god files:** none. Largest P6 file is `order-actions.tsx` at 221 lines; `lib/imports/engine.ts` 203; `app/(admin)/admin/orders/page.tsx` 190; `pos-shell.tsx` 188; `lib/orders/repeat.ts` 127; `lib/admin/dashboard.ts` 120. All split by concern (dashboard queries, list params, bulk runner, repeat planner, import engine, per-kind handlers).
- **clean-code — comments:** comments carry non-obvious intent (R-IDs/G-IDs, the "URL is the source of truth" list rule, the "first occurrence keeps its verdict" in-file dedupe rule, the "fresh duplicate check inside the commit transaction" rationale, the "skipDuplicates is the atomic backstop" note, the "audit only genuine creates — an attach is the dedupe rule, not a write" note, the "Email anchors dedupe — it can't be edited inline" constraint). No narration, no change-explanation comments.
- **clean-code — error handling:** no swallowed errors. `BulkActionReport` records per-row skip reasons (`NotFoundError`/`DomainRuleError`/`IllegalTransitionError` downgraded to per-row conflicts, never a batch-killing 500); `commitImport` refuses re-commit with a domain error; customer PATCH maps `P2002` phone collision to a 409. Error messages state what failed and the expected state.
- **clean-code — anti-AI-tics:** no redundant try/catch around non-throwing code; the bulk runner's per-row catch is the documented conflict-reporting seam, not a wrapper. POS customer search uses a generation counter to discard stale responses (real concurrency concern), not a "just in case" branch.
- **clean-code — UI consistency:** admin chrome is one shape — dark `bg-brand-900` header with visit-store link, `Sidebar` (active-state via `cn`), season-closed banner in the layout, `BackLink` on every detail screen, `Card`/`CardTitle`/`Badge`/`OrderStatusBadge`/`PaymentStatusBadge` reused across dashboard/orders/customers/imports. See m-1 for the one exception on the list filter forms.
- **clean-code — anti-hallucination:** no invented APIs. Prisma `findMany`/`count`/`aggregate`/`createMany`/`updateMany`/`$transaction` are used per current schema; `skipDuplicates` on `createMany` is a real Prisma flag. The Stripe refund path reuses the P5 seam (no fabricated Stripe SDK calls).
- **ponytail — ladder:** no new runtime dependency for P6. `package.json` carries no import/CSV/bulk library — `parseCsv` is the existing `lib/csv.ts`, bulk is a sequential loop, dashboard is plain Prisma queries. Ladder respected.
- **workflow — expectation files / gate discipline:** every P6 EXPECTED item is covered by committed CI scripts. Bounded queries everywhere: dashboard `QUEUE_TAKE = 10`, order list `take: pageSize` + `skip`, customer history `take: 50`, audit `take: 25` (order) / `take: 200` (global), import recent `take: 20`, POS customer search hard-capped at `Math.min(Math.max(1, take), 25)`, bulk `BULK_ACTION_LIMIT = 100`, import `IMPORT_ROW_LIMIT = 2000`. G-024 (crunch-scale bounding) is satisfied across the surface.
- **workflow — security basics:** `.gitignore` now reads `.env*` + `!.env.example` (the P5 m-1 finding was fixed). Permission gates on every mutation; the imports preview page and commit/discard routes re-check `IMPORT_PERMISSION[batch.kind]` so a customers-only staff member cannot open or commit a products batch. Offline payment methods schema-refused on POS (UR-011).
- **codegraph:** `.codegraph/` present and healthy in `workspace/` (index db + wal + shm). Index grew with the P6 surface (admin pages, import engine, bulk runner, dashboard queries) — no regression flagged.
- **vocabulary:** no refactor/rebuild/redesign commands mis-scoped in P6. The 503 "card payment not configured" seam from P5 is unchanged; the repeat-flow "replacedBy suggestions are P10 scope" comment is an explicit scope boundary, not a silent skip.

## Findings

### m-1 — Hand-rolled `<input>`/`<select>` on admin list pages while sibling components use the kit (clean-code: UI Consistency)
**Severity:** Minor
**Where:** `app/(admin)/admin/orders/page.tsx:95–155` (1 `<input>` + 3 `<select>`, inline classes `mt-1 … rounded-md border border-stone-300 bg-white px-3 py-2 text-sm`, no focus ring) and `app/(admin)/admin/customers/page.tsx:57–63` (1 `<input>`, same inline classes). Compare the same page's `OrderListTable` (`app/(admin)/admin/orders/order-list-table.tsx:9,76`) which imports and uses `<Select>` from `components/ui/select`, and the other P6 client components (`ImportUpload`, `OrderActions`, `CustomerEditor`, `PosShell`) which use `<Input>`/`<Select>`/`<Button>`/`<Label>` from `components/ui/`.
**Rule:** `clean-code.mdc` "UI Consistency — one styling approach per project" and "If a new screen looks different from the rest of the app, that's a bug." The kit `Select`/`Input` apply `focus:border-brand-600 focus:ring-1 focus:ring-brand-600`; the hand-rolled versions omit the focus ring, so the filter controls visibly differ from every other input on the admin surface. `Select`/`Input` are `forwardRef` components with no `useState`/`useEffect`, so they render fine from server components — there's no technical reason the list pages hand-roll them.
**Detail:** Cosmetic, no functional impact. Either adopt `<Input>`/`<Select>` on the two filter forms (drop the inline classes) or record a README § Rule Preferences entry narrowing the kit to client components with a reason. The current state is two styling approaches for the same element on the same screen.

### m-2 — README not updated for P6 (workflow: Keep README current; clean-code: one pattern per concern documented)
**Severity:** Minor
**Where:** `workspace/README.md:1` title still reads "… (arm-06, phase P5)"; sections stop at "What P5 ships" (`:45`); the "Patterns (one per concern — clean-code rule)" table (`:77–92`) lists no P6 pattern.
**Rule:** `workflow.mdc` "Keep README current" and "When starting a new project, pick these patterns in the first session and document in README." `clean-code.mdc` "Consistency — one pattern per concern … document in README." P6 introduced four new pattern choices — staged-atomic import engine (`lib/imports/engine.ts`), bounded bulk runner with deterministic per-row report (`lib/orders/bulk.ts`), dashboard query module (`lib/admin/dashboard.ts`), shared list-controls helpers (`lib/admin/order-list.ts`) — none are registered in the Patterns table.
**Detail:** A future session touching imports/bulk/dashboard has no README entry naming the chosen pattern, which is the exact gap the "one pattern per concern" registry exists to prevent. Add a "What P6 ships" section and four rows to the Patterns table. Low blast radius (the code itself is consistent), hence Minor.

### m-3 — Dead `GET` handler on `/api/admin/imports` (clean-code: dead code)
**Severity:** Minor
**Where:** `app/api/admin/imports/route.ts:22–44` (`GET`). The imports page (`app/(admin)/admin/imports/page.tsx:21–25`) queries `prisma.importBatch.findMany` directly in the server component; `ImportUpload` only POSTs to the same route. No client or test calls `GET /api/admin/imports` (grep for `/api/admin/imports` and `apiFetch … "/api/admin/imports"` returns only the POST in `import-upload.tsx:31`).
**Rule:** `clean-code.mdc` "Dead code — delete, don't comment out." The `GET` export duplicates the page's own query and has zero callers.
**Detail:** Either delete the `GET` export or wire the page to it (and drop the page's direct Prisma call) so the list query has one home. Carrying both is the kind of "two data-fetching patterns" drift the clean-code consistency rule warns against. Minor because the dead handler is harmless and gated by the same permission checks.

### m-4 — Imports recent-list over-scopes product batch metadata to customers-only staff (clean-code: Consistency; P6 EXPECTED item 1 permission-aware)
**Severity:** Minor
**Where:** `app/(admin)/admin/imports/page.tsx:22` — `where: canCustomers ? {} : { kind: "PRODUCTS" }`. The page comment (`:13–14`) claims "The kinds a staff user sees follow their permissions (customers vs catalog)."
**Rule:** `clean-code.mdc` "Consistency" and P6 EXPECTED item 1 ("permission-aware admin dashboard"). The logic is correct for two of three cases but wrong for `canCustomers=true && canCatalog=false`: a customers-only staff member sees ALL batches including `PRODUCTS` rows (filename, row counts, status) in the recent list. The preview page (`imports/[batchId]/page.tsx:27`) and the commit/discard routes re-gate on `IMPORT_PERMISSION[batch.kind]` = `catalog.manage`, so the leaked rows cannot be opened or committed — the blast radius is metadata only.
**Detail:** The correct filter is `canCustomers && canCatalog ? {} : canCustomers ? { kind: "CUSTOMERS" } : { kind: "PRODUCTS" }`. The page comment promises permission-scoping the code doesn't deliver for the customers-only case. Minor because the actual row data is gated downstream and the leaked fields are filename + counts.

### m-5 — Defensive `["-"]` fallback in order-detail audit query (clean-code: anti-AI-tic "just in case")
**Severity:** Minor
**Where:** `app/(admin)/admin/orders/[orderId]/page.tsx:43` — `{ targetType: "Payment", targetId: { in: paymentIds.length > 0 ? paymentIds : ["-"] } }`.
**Rule:** `clean-code.mdc` "No 'just in case' code — every line must have a reason." In Prisma, `in: []` already matches no rows, which is the intent when there are no payments. The `["-"]` fallback is a guard for a condition the ORM already handles.
**Detail:** Drop the ternary and pass `paymentIds` directly (`in: paymentIds`). Harmless, but it's the kind of redundant defensive branch the anti-AI-tic rule targets. Very minor.

### m-6 — Redundant `|| DEFAULT_PAGE_SIZE` in `parseCustomerListParams` (clean-code: anti-AI-tic / dead branch)
**Severity:** Minor
**Where:** `lib/customers/directory.ts:22` — `pageSize: parsePageSize(searchParams.size) || DEFAULT_PAGE_SIZE`.
**Rule:** `clean-code.mdc` "No redundant type assertions the compiler already guarantees" / dead branch. `parsePageSize` (`lib/admin/order-list.ts:33–36`) already returns `DEFAULT_PAGE_SIZE` as its fallback for any unrecognized value, and never returns `0` or `NaN` (the only falsy numbers it could produce are excluded by the `includes` check). The `|| DEFAULT_PAGE_SIZE` can never fire.
**Detail:** Drop the `|| DEFAULT_PAGE_SIZE` — `parsePageSize(searchParams.size)` alone is correct. Trivial, but it's a dead branch that reads as if `parsePageSize` could return something falsy, which it can't.

## Severity counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 6 |

No rule violation blocks the P6 gate. All six findings are Minor consistency/dead-code/cosmetic gaps: hand-rolled `<input>`/`<select>` on the two admin list filter forms while sibling components use the `components/ui/` kit (m-1); the README still titled "phase P5" with no "What P6 ships" section and no P6 rows in the Patterns table (m-2); a dead `GET /api/admin/imports` handler duplicated by the page's own Prisma query (m-3); the imports recent-list showing product-batch metadata to customers-only staff despite a comment claiming permission-scoping (m-4, gated downstream so metadata-only); a `["-"]` fallback in the order-detail audit query that duplicates `in: []` semantics (m-5); and a redundant `|| DEFAULT_PAGE_SIZE` in `parseCustomerListParams` that `parsePageSize` already guarantees (m-6). The arm's P6 tree otherwise honors its selected catalog rules: one pattern per concern documented and followed, no god files, no new deps (ponytail ladder), bounded queries at every list/queue/search/bulk/import surface (G-024), permission gates on every mutation with the import preview re-checking the kind's permission, audited writes inside the same transaction as the change, codegraph healthy and grown with the phase, and the P5 `.gitignore` fix landed. The P6 EXPECTED items (permission-aware dashboard + Today queue, searchable order list + detail with refund, POS reusing the cart-first builder + find-or-create, customer directory + staged atomic CSV import with preview/audit, admin chrome, bounded bulk actions with deterministic per-row conflict reporting) are all present and rule-conformant.
