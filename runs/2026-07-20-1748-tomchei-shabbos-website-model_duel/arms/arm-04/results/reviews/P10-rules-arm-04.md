# P10 Rules Review — arm-04 (blind)

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Arm rules graded:** ponytail, clean-code, workflow, vocabulary, codegraph
**Scope:** `arms/arm-04/workspace/` P10 additions (`prisma/migrations/20260727030000_p10_seasons_repeat_replacements`, `prisma/schema/{catalog,orders}.prisma`, `src/app/(admin)/admin/{seasons,catalog/replacements,customers}`, `src/app/(storefront)/account/orders/[orderId]/{,repeat/}`, `src/app/(storefront)/order/{,checkout/}`, `src/app/api/cron/season-flip`, `src/lib/{seasons,catalog,orders/repeat-*,orders/bulk-actions,imports/prior-year-orders,http/store-gate,cron}`, `src/components/account/order-summary-row.tsx`, `scripts/smoke-p10*.ts`)
**Method:** Findings only, no fixes. Blind to model name.

## Summary by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 4 |
| Info | 2 |

## High

### H1 — `setSeasonSchedule` throws on a missing season instead of returning a `Result`, breaking the page's own error contract
`src/lib/seasons/schedule.ts:102-105` (called from `src/app/(admin)/admin/seasons/actions.ts:44`)

`setSeasonStatus` (same module family, `management.ts:42-43`) does `findUnique` first and returns `failure(SEASON_ALREADY, 'That season no longer exists.')` when the row is gone. `setSeasonSchedule` skips that check and calls `db.season.update({ where: { id: input.seasonId } })` directly, which throws `PrismaClientKnownRequestError P2025` when the id is stale. The action handler `setSeasonScheduleAction` only inspects `saved.ok` — it never sees the throw, so a manager who deletes a season in a second tab and then saves its schedule gets a 500 instead of the same flash-message failure shape every other season action returns. `createSeasonFromWizard` (`wizard.ts:197-201`) and `saveAddOn` (`admin.ts:237-243`) deliberately catch `P2002`/`P2025` and turn them into `failure(...)`; `setSeasonSchedule` is the outlier in the same package. This is a real consistency break in the rule the arm itself established this phase.

**Rules:** clean-code (Consistency — one error-handling approach per project; Error Handling — error messages say what went wrong AND expected state), ponytail (the ladder's "minimum code" is fine, but reusing the sibling's `findUnique`+`failure` pattern is the same line count and the rule it breaks is the arm's own).

## Medium

### M1 — "Is this order repeatable?" is expressed three different ways with subtly different semantics
`src/components/account/order-summary-row.tsx:29` (`REPEATABLE = new Set(['PLACED','IN_FULFILLMENT','COMPLETED'])`), `src/app/(storefront)/account/orders/[orderId]/page.tsx:137` (`isDraft || status === 'CANCELLED' || status === 'DISCARDED' ? null : …`), `src/lib/orders/repeat-review.ts:163` (`listRepeatableOrders` uses `notIn: ['DRAFT','DISCARDED']`), `src/lib/orders/repeat-review.ts:43` (`confirmRepeat` refuses only `DRAFT`)

The row component allowlists `PLACED/IN_FULFILLMENT/COMPLETED`. The order detail page denylists `DRAFT/CANCELLED/DISCARDED` — same set, opposite pattern. `listRepeatableOrders` uses a third, looser filter (`notIn: ['DRAFT','DISCARDED']`) that *includes* `CANCELLED`, so the query feeds the screen orders the row then refuses to show a repeat button for. `confirmRepeat`'s server gate refuses only `DRAFT`, so a `CANCELLED` order — hidden on both screens — is still repeatable by direct URL. Three patterns, three semantics, one business rule. The shared `REPEATABLE` set already exists in `order-summary-row.tsx`; the detail page and `listRepeatableOrders` should both use it (or a single helper in `lib/orders/`), and `confirmRepeat` should refuse anything outside it.

**Rules:** clean-code (Consistency — one pattern per concern; Inconsistent patterns; Refactor categories — duplicated logic), ponytail (Rule of 2 satisfied — 3+ call sites for "is repeatable").

### M2 — `requireOpenStore` was silently re-homed from `@/lib/store-state` to `@/lib/http/store-gate` across four storefront files
`src/app/(storefront)/order/{page,actions,checkout/page,checkout/actions}.tsx`

The P10 diff changes the import in four files from `@/lib/store-state` to `@/lib/http/store-gate`. The new module is clean (`store-gate.ts` owns the 403, `store-state.ts` keeps the read), and the split is well-explained in the new file's header. But the move is done as a side effect of P10 with no DECISION-LOG entry, no README § Rule Preferences note, and no `codegraph impact` run before re-pointing the four call sites — the arm's own `codegraph.mdc` makes `codegraph_impact` mandatory before "rename / delete / signature change / refactor command." A function moving modules is a structural change to every caller. The new home is correct; the process that put it there skipped the arm's own rule. (No `.codegraph/` index is present in this workspace, so the CLI could not have run — but the rule says "if MCP and CLI both unavailable after that attempt, use Read/grep fallback for this run only," and there is no evidence of either the attempt or the fallback being used to confirm callers before the move.)

**Rules:** codegraph (mandatory `codegraph_impact` before structural moves), workflow (DECISION-LOG for non-trivial structural choices; Gate discipline).

### M3 — `applyScheduledSeasonFlips` closes every open season when one is due to open, ignoring `closesAt`
`src/lib/seasons/schedule.ts:53-60`

When `opening.length > 0`, the `closed` `updateMany` drops the `closesAt: { lte: now }` filter and closes *all* other open seasons unconditionally. The comment justifies this on the "only one season open" invariant, which is correct for the currently-open season. But the sweep runs in a single transaction with no re-read of `opensAt`/`closesAt` between the `due` query and the `updateMany`, so a manager who set a `closesAt` two minutes from now on the open season and a `opensAt` one minute from now on the new one loses the right to have the old season close on its own schedule — it closes the instant the new one opens. The manual `setSeasonStatus` path has the same behaviour (opening closes the other), so this is consistent with the manual switch. The finding is that the *scheduled* path silently overrides a future `closesAt` the manager typed, where the manual path at least has a button press behind it. Consider: when a due-open is found, close only the currently-open season (which the invariant requires) and leave any `closesAt` on it alone — or surface "the schedule on the closed season was overridden" in the run detail.

**Rules:** workflow (Never silently choose business logic — calculations, domain rules; log in DECISION-LOG and flag), clean-code (Error Handling — error messages say what went wrong AND expected state; here the "expected state" is the manager's schedule, which is silently discarded).

## Low

### L1 — `confirmRepeat` reuses the plan read outside its write transaction, so a product deactivated between GET and POST is still written
`src/lib/orders/repeat-review.ts:78-140`

`readRepeatReview` builds the plan (including `catalog` from `listSeasonCatalog`, which filters `isActive: true`). `confirmRepeat` calls `readRepeatReview` again, then inside `runInTransaction` passes that same in-memory `plan` to `applyRepeatPlan`. `applyRepeatPlan` validates `decision.productId` against `plan.catalog` (in-memory Map), not against the live DB. If a product is deactivated between the plan read and the transaction commit, the repeat still writes a line for it. The snapshot columns mean the order is internally consistent, but a now-retired item lands on a draft the customer will be asked to pay for. The open-cart check is correctly inside the transaction; the catalog freshness check is not.

**Rules:** clean-code (Consistency — `setSeasonStatus`/`startRoute` put state-changing reads inside the transaction; Anti-AI-Tics — "just in case" code is forbidden, but the inverse — a stale read that should have been re-read — is the same class of gap), workflow (Verify in the running app — never mark done from code alone; the TOCTOU is invisible from the tree).

### L2 — `resolveReplacements` runs uncached on every render of the replacements page
`src/lib/catalog/replacements.ts:49-134` called from `src/app/(admin)/admin/catalog/replacements/page.tsx:52-65`

Every render of `/admin/catalog/replacements` calls `listSeasonCatalog(target)` + `db.product.findMany` for the source season + `resolveReplacements(allSourceProductIds, target)`, and the latter runs up to `MAX_CHAIN_HOPS` (8) `db.product.findMany` queries. Every `revalidatePath` bounce from a `setMappingAction` save re-runs the whole walk. At Purim scale (a few hundred products across a couple of seasons) this is bounded, and the page is manager-only, so it is not the P9 `nearbySuggestions` problem. Flagging only because the same shape was M2 last phase and the fix (cache the resolution per source season + short TTL, or move it behind a button) is the same.

**Rules:** ponytail (ladder — repeated work on every render is the cost the ladder flags), clean-code (Consistency — other admin list pages gate expensive queries behind a filter form).

### L3 — `importPriorYearOrder` upserts addresses by `addressKey`, so the second recipient at the same street is filed under the first one's name
`src/lib/imports/prior-year-orders.ts:221-256`

`upsertAddresses` keys on `customerId_addressKey`. When two lines share an address (same line1/city/state/postal) but different `recipientName`, the first one wins the address-book row's `recipientName`; the second line's order row still carries its own `recipientName`, so the order is correct, but the address book entry the review page offers names only the first recipient. A customer repeating the import gets one address-book row for two people. The `lastGreeting` update is guarded on `line.greetingMessage`, but the `recipientName` is not. Minor — the import is a year-one hook, not a hot path — but it is a silent data choice the comment does not call out.

**Rules:** ponytail ("Never silently choose business logic"), clean-code (Naming — the address-book row's `recipientName` no longer names the recipient).

### L4 — `closestPricedProduct` falls back to the whole catalog when the source category is empty, but not when it is merely non-empty and far away
`src/lib/catalog/replacements.ts:145-165`

`pool = category !== null && sameCategory.length > 0 ? sameCategory : candidates`. A donor who spent $54 on a "Baskets" item is offered the only other basket at $200, never the $46 box that is $8 away — because the same-category pool is non-empty, so the cross-category fallback never runs. The comment says "a wine basket rather than the cheapest thing in the shop," which is the intent, but the rule gives no escape valve when the same-category pick is wildly off-price. The smoke test (S1b) only exercises the happy path where the same-category item is also the closest. Not a bug; a silent product decision the comment does not fully defend.

**Rules:** workflow (Never silently choose business logic — the category-only tiebreak is a domain rule with no DECISION-LOG entry), ponytail ("Never silently choose business logic").

## Info

### I1 — `codegraph` adherence not verifiable from artifacts alone
The `codegraph.mdc` rule forbids Grep/SemanticSearch for structural lookups when a `.codegraph/` index exists. No `.codegraph/` directory exists in this workspace, so the rule's fallback ("Read/grep fallback for this run only") applies. The P10 code reuses existing helpers consistently (`recordAudit`, `runInTransaction`, `runCronJobBody`, `findOwnedOrder`, `createDraftReference`, `readStoreState`, `boundedIds`/`bulkReport`), which suggests the contestant understood the existing structure rather than reimplementing it. No structural evidence of a grep-for-symbol violation (no competing reimplementations of indexed helpers, no "I grepped the tree" comments). The M2 finding above is the only codegraph-adjacent concern, and it is about the *process* (no `impact` run before a move), not the *tool choice*.

**Rules:** codegraph (unverifiable from artifacts).

### I2 — `vocabulary` and `clean-code UI Consistency` not flagged
- **vocabulary:** No `refactor`/`tidy`/`rebuild`/`redesign` commands were issued mid-phase; the new screens are "add" (new feature, existing patterns) and the `requireOpenStore` move is a structural side-effect, not a vocabulary command. Command words used in comments ("build", "switch", "flip", "save", "schedule", "import", "repeat", "carry") match the vocabulary table. No finding.
- **clean-code UI Consistency:** New admin pages reuse `Card`, `CardTitle`, `CardDescription`, `Button`, `Badge`, `FlashMessages`, `Input`, `Label`, `Select`, `SeasonSelectForm`, `ListSearch`, `Pagination` from the existing library. Header pattern (`text-2xl font-semibold` on admin, `text-3xl font-semibold` on storefront) matches every other screen. The repeat review page uses the storefront weight, the seasons page uses the admin weight — correct per the existing split. Back navigation on the wizard (`← Seasons`) and on the replacements page (`Catalog`) matches the `BackLink` pattern used elsewhere. No finding.
- **clean-code God files:** Largest P10 file is `repeat-plan.ts` at 490 lines — just under the 500 trigger, and it owns one concern (the plan). `bulk-actions.ts` at 214 lines, `prior-year-orders.ts` at 257, `replacements.ts` at 166. No file has badly mixed concerns. No finding.
- **clean-code Dependency Discipline:** No new packages added for P10. Hashing uses `node:crypto` (`randomUUID`, `createHash`, `timingSafeEqual`); the cron gate reuses the existing `runCronJob`/`runCronJobBody` pair. Versions pinned. No finding.
- **clean-code Anti-Hallucination:** No invented library APIs observed. Prisma `updateMany`/`upsert`/`findFirst` signatures match current client types. Next `revalidatePath(path, 'layout')` matches the documented overload. No finding.
- **workflow Security Basics:** `.env.example` already carries `CRON_SECRET` (P9). The new `season-flip` route goes through `runCronJob`, which refuses every request when the secret is empty and uses `timingSafeEqual` on SHA-256 digests. No secrets hardcoded or logged. The `importPriorYearOrder` hook is server-only and writes no secrets. No finding.
- **workflow Shell execution:** No PowerShell written by the contestant in P10 (all `.ts`/`.tsx`/`.sql`). N/A.
- **workflow Expectation Files:** `.scratch/phase-plan.md` is gitignored and not in the tree; cannot verify the pre-build EXPECTED blocks. The smoke script `scripts/smoke-p10.ts` encodes verifiable expectations per check (S1a–S4e, P10-1–P10-5) and is green by construction. No finding from artifacts.
