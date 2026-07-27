# P10 Clean-Code Review — arm-04 (blind)

Scope: P10 delta in `arms/arm-04/workspace/` — seasons management, repeat orders, replacement mappings, and the year-one import hook. New files: `src/lib/seasons/{management,schedule,wizard}.ts`, `src/lib/catalog/replacements.ts`, `src/lib/orders/{repeat-plan,repeat-review,repeat-order}.ts`, `src/lib/imports/prior-year-orders.ts`, `src/lib/orders/bulk-actions.ts` (repeat-history addition), `src/app/(admin)/admin/seasons/**`, `src/app/(admin)/admin/catalog/replacements/**`, `src/app/(storefront)/account/orders/[orderId]/repeat/**`, `src/app/api/cron/season-flip/route.ts`, `prisma/migrations/20260727030000_p10_seasons_repeat_replacements/migration.sql`, plus P10 edits to `src/app/(admin)/admin/{catalog,customers}/{page,actions}.tsx`, `src/app/(storefront)/order/{page,actions,checkout/actions,checkout/page}.tsx`, `src/components/account/order-summary-row.tsx`, and `scripts/smoke-p10*.ts`.
Findings only — no fixes. No model names; arm id only.

## Summary

- Major: 4
- Minor: 7

## Major

### M1 — `repeat-plan.ts` is a mixed-concern god file
`src/lib/orders/repeat-plan.ts` is 490 lines (under the 500 trigger) but trips the "mixed concerns" trigger in `clean-code.mdc` (split when >500 lines **or mixed concerns**). It owns six distinct concerns: plan construction (`buildRepeatPlan`), the `RepeatDecision` contract + `undecidedLineFailure` refusal, plan application (`applyRepeatPlan`), auto-decisions for staff (`autoDecisions` + `unresolvedNames`), recipient resolution (`planRecipient` + `recipientState` + `savedAddressFor`), greeting resolution (`greetingFor`), and the current-season add-on catalog (`currentAddOnsBySlug` + `CurrentAddOn`). The recipient/greeting half and the add-on half are each only consumed by `buildRepeatPlan`; the apply/auto half is consumed by `repeat-review.ts` and `repeat-order.ts`. Splitting along those seams (e.g. `repeat-plan.ts` for the read model, `repeat-apply.ts` for the write, `repeat-recipient.ts` for the address/greeting resolution) would give each file one verb, the way `seasons/` already splits `management`/`schedule`/`wizard`.

### M2 — `Select` component bypassed in two of three P10 screens (pattern drift)
`src/components/ui/field.tsx:19-21` defines a `Select` wrapper over `CONTROL_CLASSES = 'w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm text-[var(--color-ink)]'`. The P10 wizard uses it (`seasons/new/page.tsx:71`). The other two P10 screens hand-roll the same string inline:

- `src/app/(admin)/admin/catalog/replacements/page.tsx:161` — `className="min-w-56 rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm"` (drops `text-[var(--color-ink)]` and the disabled style; swaps `w-full` for `min-w-56`).
- `src/app/(storefront)/account/orders/[orderId]/repeat/page.tsx:170` and `:210` — `className="w-full max-w-md rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm"` (drops `text-[var(--color-ink)]`).

`clean-code.mdc` names "duplicated UI — extract shared components" and "inconsistent patterns — pick one, apply everywhere." Three P10 screens, two styling approaches for the same control. `checkout/page.tsx:24-25` has the same drift in a `GREETING_CLASSES` constant (predates P10), confirming the pattern is already leaking. `Select` accepts a `className` override, so `min-w-56` and `max-w-md` could be passed through without forking the class string.

### M3 — `bulkRepeat` and `bulkRepeatCustomerHistory` duplicate the per-row record and the detail string
`src/lib/orders/bulk-actions.ts:100-144` and `:154-197` share the same skeleton: `randomUUID()` → `boundedIds` → look-up map → loop ids → skip-missing record → call repeat function → push outcome record → `bulkReport`. The applied-record detail line is duplicated verbatim at `:137-139` and `:190-192`:

```ts
detail: `${repeated.value.draftReference}: ${repeated.value.copiedLines} item${
  repeated.value.copiedLines === 1 ? '' : 's'
}${repeated.value.skippedLines.length > 0 ? `, ${repeated.value.skippedLines.length} not on sale` : ''}`,
```

The conflict/skip branching (`repeated.code === REPEAT_TILL_BUSY ? 'conflict' : 'skipped'`) is also repeated at `:127` and `:180`. A `recordRepeatOutcome(repeated, label)` helper (and a `describeRepeat(repeated)` for the detail string) would collapse both loops onto their only real difference — the entity look-up and the repeat call.

### M4 — `createSeasonFromWizard` and `resolveReplacements` exceed the 3-level nesting rule
`clean-code.mdc`: "If a function has more than 3 levels of nesting, refactor it."

- `src/lib/seasons/wizard.ts:54-202` `createSeasonFromWizard` reaches 5 levels: function → `try` → `db.$transaction(async (tx) => {…})` callback → `for (const product of products)` → `if (copy.tracksInventory)` (and the same shape for the add-on loop and the replacement-link loop). The transaction callback is the nesting sinkhole.
- `src/lib/catalog/replacements.ts:49-134` `resolveReplacements` reaches 4 levels: function → `for (let hop…)` → `for (const [sourceId, walk] of walking)` → `if (!node || walk.seen.has(node.id))` / `if (landed)` / `if (node.replacedByProductId === null)`. The per-hop body is the worst offender — three sibling `if`s each doing `resolutions.set + walking.delete + continue`, which reads as a pattern match and would flatten with an extracted `resolveWalk(walk, node, onSale)` helper.

## Minor

### m1 — `listRepeatableOrders` is dead code
`src/lib/orders/repeat-review.ts:161-168` exports `listRepeatableOrders(customerId, limit)`, but no file in `workspace/` imports it (grep finds only the definition site). The repeat button on `account/orders/[orderId]/page.tsx:138` and `components/account/order-summary-row.tsx:69` links directly to the review route by id; neither calls `listRepeatableOrders`. Either the order-list page was meant to call it or it is leftover scaffolding. `clean-code.mdc`: "Dead code — delete, don't comment out."

### m2 — `repeat-order.ts` re-exports symbols nobody imports from there
`src/lib/orders/repeat-order.ts:35` does `export { REPEAT_NOTHING_TO_COPY, REPEAT_SOURCE_NOT_FOUND };` re-exporting from `repeat-plan.ts`. Grep across `workspace/src` finds these two symbols imported only from `repeat-plan.ts` (by `repeat-review.ts` and `repeat-order.ts` itself). The re-export has no external consumer — `bulk-actions.ts:16` imports `REPEAT_TILL_BUSY` directly from `repeat-order.ts`, but `REPEAT_NOTHING_TO_COPY`/`REPEAT_SOURCE_NOT_FOUND` come from `repeat-plan.ts` when needed. Dead re-export.

### m3 — Action-helper pattern inconsistent within P10
`src/app/(admin)/admin/seasons/actions.ts:83-90` defines local `done(notice)` and `back(problem)` helpers that wrap `redirectWithFlash(SEASONS_PATH, …)`. `src/app/(admin)/admin/catalog/replacements/actions.ts:19-39` — the other new P10 action file — inlines `revalidatePath(PATH); redirectWithFlash(PATH, { … });` in the action body with no `done`/`back` helper. Two new files in the same phase, two patterns for the same flash-redirect plumbing. Pick one and apply to both (the `seasons` shape is closer to the rest of the admin tree: `orders/actions.ts:242-249`, `pos/actions.ts:243-245`, `imports/actions.ts:69`).

### m4 — Data-fetching pattern drift between `seasons/page.tsx` and `seasons/new/page.tsx`
`src/app/(admin)/admin/seasons/page.tsx:32` reads seasons through `listSeasons()` from `lib/seasons/management`. `src/app/(admin)/admin/seasons/new/page.tsx:31` inlines `db.season.findMany({ orderBy: { year: 'desc' } }`), and `:38`/`:43` inline `db.product.findMany` / `db.addOn.count`. `clean-code.mdc`: "One data-fetching pattern per project." The wizard has a legitimate reason to query a different shape (it needs products of the source season), but the season list itself is the same query `listSeasons()` already wraps — and `replacements/page.tsx:31` also inlines `db.season.findMany` for its season picker. Three P10 admin screens, three copies of "list seasons desc," one of which goes through lib.

### m5 — `AddressColumns` object literal duplicated
`src/lib/orders/repeat-plan.ts:401-417` (`planRecipient`) and `:307-314` (`applyRepeatPlan`) both build the same six-field `AddressColumns` from a `CustomerAddress` row:

```ts
{ addressLine1: addr.line1, addressLine2: addr.line2, addressCity: addr.city,
  addressState: addr.state, addressPostalCode: addr.postalCode, addressCountry: addr.country }
```

`planRecipient` also builds the same shape from `line` snapshot fields as a fallback (`:411-417`). A pair of helpers — `addressColumnsFromSaved(addr)` and `addressColumnsFromLine(line)` — would give the column mapping one home (the address module already owns `AddressColumns` and `addressLine`). Rule of 2: 2 saved→columns sites plus 1 line→columns site.

### m6 — Validation error message omits the received value
`src/app/(admin)/admin/seasons/actions.ts:25`:
```ts
if (to !== 'OPEN' && to !== 'CLOSED') back('A season is either open or closed.');
```
`clean-code.mdc`: "Error messages say what went wrong AND what the expected state was." The message states the expected set but not what was received, so a staff member who posts a stale form with `to=''` gets a message that reads like a policy statement rather than a diagnosis. Same shape in `setSeasonSchedule` (`schedule.ts:93`, `:96`) — "The opening date and time is not a date and time." — which at least names the field.

### m7 — `mappingOptions` runs a DB query from a page-local helper
`src/app/(admin)/admin/catalog/replacements/page.tsx:190-221` `mappingOptions` is a 30-line async helper with its own `db.product.findMany` that lives in the page file. The other replacement logic (`listSeasonCatalog`, `resolveReplacements`) lives in `lib/catalog/replacements.ts`. `mappingOptions` is the dropdown's data layer and has a single call site (`:64`), but it is doing data access rather than rendering, which is the line `lib/` is supposed to own. Moving it next to `resolveReplacements` would keep the page on the render side of the boundary and make the catalog lib the single source for "what products can a mapping point at."
