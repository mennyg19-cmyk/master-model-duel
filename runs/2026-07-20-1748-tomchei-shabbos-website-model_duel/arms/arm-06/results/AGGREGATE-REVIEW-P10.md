# Aggregate Review — P10 — arm-06

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-06 (late join)
**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Inputs:** P10-security, P10-quality, P10-rules, P10-clean-code (arm-06, all blind)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings. Mixed-severity clusters resolve to the highest severity (Blocker > Major > Minor).

## Counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 13 |
| Minor | 23 |
| **Total** | **36** |

Source totals (pre-dedupe): security 7 (0B/1M/6m), quality 10 (0B/3M/7m), rules 14 (0B/6M/8m), clean-code 14 (0B/5M/9m) = 45. 9 clusters merged (M5: rules M1 + clean-code M4 → Major; M7: rules M3 + clean-code M5 → Major; M11: quality m3 + clean-code M1 → Major; M12: quality m1 + rules m4 + clean-code M2 → Major; M13: rules m1 + clean-code M3 → Major; m10: security m2 + rules m8 + clean-code m2 → Minor; m11: security m3 + clean-code m3 → Minor; m14: quality m6 + rules m5 → Minor; m15: rules m3 + clean-code m4 → Minor) → 9 duplicates removed → net 36 unique. No security blockers were raised by any specialist.

## Blockers (0)

None.

## Majors (13)

### M1 — Repeat `swap` `targetProductId` is not validated to be an active product in the open season (price-integrity bypass)
**Sources:** security Major 1
**Location:** `lib/repeat/create.ts:100-110` (`applyConfirmations`); `lib/orders/resolve-lines.ts:51-57` (`resolveDraftLines`); `lib/orders/drafts.ts:46-53` (`assertOpenSeason`); `lib/repeat/import-hook.ts:54-68` (legacy $0 stub); `app/api/admin/orders/[orderId]/repeat/route.ts` (staff path)
**Claim:** `applyConfirmations` takes the client-supplied `decision.targetProductId` on a `swap` and passes it straight through to `saveDraft` with no season/active check. `saveDraft` asserts the draft's season is OPEN, but `resolveDraftLines` batch-loads referenced products with `where: { id: { in: [...] } }` — no `seasonId` filter, no `active: true` filter. Any product id is accepted, and its `basePriceCents` is snapshotted as the line's unit price. The plan's own header ("the P4 draft engine re-snapshots all prices from the catalog, so nothing client-sent is trusted") is honoured for price but not for the identity of the swap target. A customer repeating their own order already holds prior-season product ids in their history; swapping a current discontinued line to a prior-season cheaper product, a `basePriceCents: 0` legacy-import stub, or an `active: false` product yields a mispriced or $0 checkoutable line. The same gap applies to the staff repeat path. Money-path integrity bypass on a customer-facing endpoint; Major rather than Blocker because the customer owns the source order and resulting draft (no unauthorized access). Fix lives in the engine: `resolveDraftLines` should reject products whose `seasonId !== draft.seasonId` or `active === false`.

### M2 — Bulk-history idempotency is check-then-act with no concurrency guard
**Sources:** quality Major 1
**Location:** `lib/repeat/bulk-history.ts:111-135` (`runBulkHistory`)
**Claim:** The idempotency claim rests on a read of `source.repeats` (the `repeatedFromOrderId` back-relation filtered to `seasonId: open.id, status: { not: "DISCARDED" }`) followed by `createDraftFromRepeat` in a separate operation. No transaction, no row lock on the source order, no unique constraint on `(repeatedFromOrderId, seasonId)` for non-discarded drafts. Two concurrent bulk-repeat batches (the plan targets 10+ concurrent staff at crunch) can both read `repeats.length === 0` for the same source and both create drafts. The status doc says "Bulk history is lineage-idempotent, not request-idempotent" — but the lineage marker is written inside `saveDraft` with no guard, so under concurrency the lineage is duplicated, not deduplicated. The phase's headline S2 check is "Bulk repeat + idempotency"; the smoke only asserts sequential idempotency (one caller, two runs). The cross-caller case — the realistic crunch scenario — is unguarded and untested.

### M3 — Repeat review endpoints allow repeating DRAFT orders; gate inconsistent with one-click path
**Sources:** quality Major 2
**Location:** `app/api/orders/[orderId]/repeat/route.ts:60-97`; `app/api/admin/orders/[orderId]/repeat/route.ts:53-86`; `lib/repeat/plan.ts:125-127`; `app/(storefront)/account/orders/[id]/page.tsx:67`; `app/(admin)/admin/orders/[orderId]/repeat/page.tsx:24`; `lib/orders/repeat.ts:90`
**Claim:** `buildRepeatPlan` accepts both `FINALIZED` and `DRAFT` sources. The customer repeat page only shows the repeat link for `FINALIZED` orders, but the customer repeat API checks ownership only, not status — a customer can POST directly against their own DRAFT id and get a second draft cloned from an in-progress order. The staff admin repeat page only blocks `DISCARDED`, so staff can repeat a DRAFT through the review page. The one-click `repeatOrder` correctly requires `FINALIZED`. The three entry points disagree on the gate. Repeating a draft is not dangerous (just another draft) but it is an inconsistency the spec doesn't call for and the smoke doesn't cover. The review-page path is the P10 addition; it loosened the status gate the one-click path enforces.

### M4 — Season wizard catalog copy drops product media; copied season has no photos
**Sources:** quality Major 3
**Location:** `lib/seasons/manage.ts:46-110` (`createSeasonWizard`); `app/(storefront)/past-collections/page.tsx:20`
**Claim:** The source-season `include` selects `options`, `values`, and `allowedAddOns` but not `media`. Each copied `product.create` carries dims, inventory flags, options, and add-on restrictions — but no `media` rows. The new season's storefront and admin product cards render with no images. The wizard is the documented "new-season setup" path (R-097); a copied catalog landing without photos is a visible storefront regression for every season after the first. The archive page eagerly renders `product.media[0]?.url` — a copied-then-closed season shows blank tiles.

### M5 — `RepeatReview` re-declares the plan types instead of `import type` (type drift)
**Sources:** rules Major 1, clean-code Major 4
**Location:** `components/repeat/repeat-review.tsx:15-72`; `lib/repeat/plan.ts`; `lib/repeat/matcher.ts`
**Claim:** `components/repeat/repeat-review.tsx` hand-copies every server plan interface (`ReviewSuggestion`, `ReviewAddOn`, `ReviewLine`, `ReviewRecipient`, `ReviewPlan`) as byte-for-byte duplicates of `PriceSuggestion`, `RepeatPlanAddOn`, `RepeatPlanLine`, `RepeatPlanRecipient`, `RepeatReviewPlan`. The client cannot `import` those modules at runtime (they pull `@/lib/db`), but `import type { ... }` erases at compile time and ships zero server code to the client bundle. Today the two sets are in sync by hand; the next field added to `RepeatPlanLine` will silently not reach the review page. Violates: type/schema drift, single source of truth, duplicated logic.

### M6 — Chain preview renders the source product twice
**Sources:** rules Major 2
**Location:** `lib/repeat/chain.ts:63-77` (`replacementChainPreview`); `app/(admin)/admin/products/[id]/page.tsx:144`
**Claim:** `replacementChainPreview` builds `names = [start.name, ...chain.hops.map(h => h.name)]` then pushes `chain.final.name`. `resolveReplacementChain` records the FROM product at each hop, so for a direct map A→B, `hops=[A]` and `final=B`, yielding `[A, A, B]` → "A → A → B". For A→B→C the preview is "A → A → B → C". The start product is duplicated because `hops[0]` IS the start. The admin product page renders this string verbatim as `data-chain-preview`. Smoke S2 "chain preview resolves forward" passes because it checks the final name appears, not the exact string, so the defect is latent. Violates: correctness, anti-AI-tics (claim vs behavior).

### M7 — Forward-only replacement invariant enforced by string comparison on season names
**Sources:** rules Major 3, clean-code Major 5
**Location:** `app/(admin)/admin/products/[id]/page.tsx:77-79`; `lib/repeat/chain.ts:5-7`
**Claim:** `replacementOptions` filters candidates with `candidate.season.name > productSeasonName`. Season names are free-form strings ("Purim 2026", "SMOKE-P10-OLD", "Legacy 2024"); lexicographic comparison is not a valid recency ordering. `"Spring 2026" > "Winter 2025"` is `false` (S < W), so a Spring season is hidden from a Winter product's replacement picker, while `"Purim 2027" > "Purim 2026"` happens to work only because the prefixes match. The chain comment asserts "Mappings are forward-only (the product editor refuses a replacement in the same or an older season)" — but the editor only filters by name string, not by `createdAt`/season order. A replacement link to an older season can be created if the names compare favorably, silently breaking the forward-only assumption the visited-set loop guard relies on. The rest of the codebase orders seasons by `createdAt`. Violates: magic values (name string doing double duty as an order key), pattern drift, correctness.

### M8 — One-click staff repeat cannot repeat a prior-season order (R-057 scope)
**Sources:** rules Major 4
**Location:** `app/(admin)/admin/orders/[orderId]/order-actions.tsx:92-106`; `lib/orders/bulk.ts:44-48`
**Claim:** The one-click "Repeat as new draft" button posts to `/api/admin/orders/bulk` with `action: "repeat"`. `lib/orders/bulk.ts:44-48` scopes the bulk action to `seasonId: season.id` (the open season) and skips any id not in scope as "not an order in the open season". So the button on a prior-season finalized order silently fails with a skip reason, while the "Repeat with review…" link (which calls `buildRepeatPlan` directly, no season scope) works cross-season. The button label promises a repeat it cannot perform for the cross-season case that is P10's primary repeat scenario. Violates: workflow § "verify in the running app" gap; R-057 scope.

### M9 — Legacy import creates FINALIZED orders with `totalCents: 0` regardless of line totals
**Sources:** rules Major 5
**Location:** `lib/repeat/import-hook.ts:118`; `lib/repeat/import-hook.ts:152`; `app/(storefront)/account/orders/[id]/page.tsx:45,126`
**Claim:** `importLegacyOrders` creates the order with `totalCents: 0`, then lines are created with `lineTotalCents: product.basePriceCents * qty`. The order total is never recomputed from the lines. The customer order detail renders `formatCents(order.totalCents)` → "$0.00" for a populated legacy order. The repeat plan reads line-level prices so repeat works, but the stored order total is structurally wrong for imported history. Violates: type/schema drift, data integrity.

### M10 — Legacy import: stub products written outside the transaction
**Sources:** rules Major 6
**Location:** `lib/repeat/import-hook.ts:110-159`; `lib/repeat/import-hook.ts:54-69` (called at line 142)
**Claim:** `importLegacyOrders` wraps `order`/`draftRecipient`/`orderLine` creation in `prisma.$transaction(async (tx) => …)`, but `stubProduct` uses the global `prisma.product.upsert`, not `tx`. The stub product is committed immediately; if the transaction rolls back, the order/lines vanish but the stub product remains. The upsert-by-slug makes this recoverable on retry, but the transaction boundary is wrong: writes intended to be atomic are split across the global client and `tx`, violating the file's own "persists legacy rows as FINALIZED orders" atomicity intent. Violates: error handling, transactional integrity.

### M11 — `createSeasonWizard` breaks the file's own transaction invariant; copies are non-transactional and `copiedSlug` can collide mid-copy
**Sources:** quality Major 3, clean-code Major 1
**Location:** `lib/seasons/manage.ts:32-35` (`copiedSlug`); `lib/seasons/manage.ts:37-69` (wizard body); `lib/seasons/manage.ts:73-110` (product copy loop)
**Claim:** `lib/seasons/manage.ts` opens with: "every write here runs in a transaction so a failed flip never leaves two seasons half-open." `setSeasonStatus` and `runSeasonFlip` honor that — both wrap in `prisma.$transaction`. `createSeasonWizard` does not: the season row is committed, then each copied product is a separate `prisma.product.create` (not `tx`). A failure midway through the catalog copy leaves a CLOSED season with a half-copied catalog and no audit row — exactly the "half-built catalog" the docstring claims the wizard avoids. Separately, `copiedSlug` strips a trailing `-20XX` and re-suffixes the new year; two source products whose slugs collapse to the same base (e.g. `basket-2025` and `basket-2026` both → `basket-2027`) produce a unique-slug violation on the second `product.create`, and because the copies are non-transactional the collision leaves a partial catalog. Either wrap season+copies in one transaction, or drop the invariant claim from the file header. Violates: inconsistent patterns, anti-AI-tics (claim the code can't back), error handling.

### M12 — `buildRepeatPlan` runs twice per order on the server (duplicated work)
**Sources:** quality Minor 1, rules Minor 4, clean-code Major 2
**Location:** `lib/repeat/bulk-history.ts:133-135`; `lib/orders/repeat.ts:97-98`; `lib/repeat/create.ts:175`
**Claim:** Both server-side repeat callers build the plan, then hand off to `createDraftFromRepeat`, which rebuilds the same plan internally at `lib/repeat/create.ts:175`. `buildRepeatPlan` is N+1 per source line (chain walk + `mapOption` + `mapAddOn` + `product.findUnique` per line, plus `suggestByPrice` per dead end), so the bulk-history path doubles the DB load for every order in a 100-order batch (up to 200 plan builds per bulk run, each with N+1 queries). The "don't trust the client" rebuild is correct for the POST review-confirm path; for these two server-only callers the plan is already in hand. Pass the built plan into `createDraftFromRepeat` (or split the confirm path into `confirmFromPlan(plan, input)` + a thin `createDraftFromRepeat` that builds then delegates) so server callers pay once. Violates: duplicated logic, anti-AI-tics ("just in case" rebuild), ponytail § shortest working diff. Quality rates Minor; rules rates Minor; clean-code rates Major — highest wins.

### M13 — `planRepeat` / `RepeatPlan` / `RepeatCatalog` are dead production code
**Sources:** rules Minor 1, clean-code Major 3
**Location:** `lib/orders/repeat.ts:28-85`
**Claim:** `lib/orders/repeat.ts` keeps the P6-era pure planning function and its types. After P10, the only production caller in this file (`repeatOrder`) goes through `buildRepeatPlan` + `autoConfirmPlan` + `createDraftFromRepeat` and never touches `planRepeat`. A repo-wide grep confirms `planRepeat` / `RepeatPlan` / `RepeatCatalog` are referenced only by `scripts/test-p6.mts` — a stale test keeping dead production code on life support. `RepeatSkip` is still live (returned by `repeatOrder`). Delete `planRepeat`, `RepeatPlan`, `RepeatCatalog`; either delete the P6 test or rewrite it against the new pipeline. Violates: dead code (clean-code rule: "Dead code — delete, don't comment out"). Rules rates Minor; clean-code rates Major — highest wins.

## Minors (23)

### m1 — Import-hook trusts manager input to mint FINALIZED + PAID $0 orders on any customer account
**Sources:** security Minor 1
**Location:** `lib/repeat/import-hook.ts:100-104, 110-160, 163-168`; `app/(storefront)/account/orders/page.tsx:44`
**Claim:** `importLegacyOrders` creates orders with `status: "FINALIZED"`, `paymentStatus: "PAID"`, `totalCents: 0`, and upserts a `Customer` by email with no verification that the row corresponds to a real prior system. A manager holding `catalog.manage` can inject arbitrary "Legacy <year>" orders for any email; the customer then sees `legacy-import:...` in their order history. The imported rows are treated as first-class FINALIZED history with no audit link to a source system, and the $0 PAID status is a money-path assertion the platform never verified. Manager is a trusted role, so this is a trust-boundary note, not a privilege escalation — but combined with M1, a single manager import seeding a $0 stub on a customer's history makes the customer self-checkout-at-$0 path reachable with no further manager involvement. The import audit (`legacy_import`) records only aggregate counts, not per-row customer emails, so the injected rows are not individually attributable after the fact.

### m2 — `runSeasonFlip` `toOpen` loop wastes the first open when multiple seasons are due, and never clears stale `scheduledOpensAt`
**Sources:** security Minor 3
**Location:** `lib/seasons/manage.ts:221-238`
**Claim:** For each due CLOSED season, the loop closes the currently-OPEN season (which may be the one opened earlier in the same loop) before opening the next, so only the last-iterated due season ends OPEN; the audit `opened` array nonetheless lists all of them, so the audit overstates what the DB settled on. Separately, seasons skipped by the `scheduledClosesAt <= now` guard keep their past `scheduledOpensAt` forever, so every future cron re-evaluates and re-skips them — a dead-schedule accumulation that also keeps them re-appearing as `CLOSED` candidates with a stale open time. The partial unique index guarantees the single-OPEN invariant regardless, so this is an operational/audit-fidelity gap, not a corruption risk.

### m3 — `setSeasonSchedule` writes the season update and audit row non-transactionally
**Sources:** security Minor 4
**Location:** `lib/seasons/manage.ts:183-194`
**Claim:** `prisma.season.update` then `recordAudit` (no `tx`). A crash between the two leaves a schedule change with no audit trail. `setSeasonStatus` (manage.ts:129-167) correctly wraps both in `$transaction`. The schedule edit is a manager-only (`catalog.manage`) mutation that drives the auto-flip cron, so losing its audit row weakens attribution for a season-lifecycle change. Minor audit-durability gap.

### m4 — Legacy import dedup check is a non-transactional `findFirst` outside the per-row transaction
**Sources:** security Minor 5
**Location:** `lib/repeat/import-hook.ts:91-98`
**Claim:** The `wireFormat: marker` duplicate check runs before the `$transaction` (import-hook.ts:110) that creates the order. Two concurrent imports of the same `externalKey` (or same email+year) can both pass the check and both create FINALIZED orders. Manager-only, so it is a concurrency/idempotency gap, not an authz one; the `seasons_single_open` partial index is unaffected. The `wireFormat` column has no unique constraint to backstop it.

### m5 — Replacement-chain "forward-only" invariant is enforced only in the UI, not the schema
**Sources:** security Minor 6
**Location:** `lib/repeat/chain.ts:24-61`; `app/(admin)/admin/products/[id]/page.tsx:77-79`
**Claim:** `lib/repeat/chain.ts` walks `replacedById` until `product.seasonId === targetSeasonId`. The product editor only offers replacement targets from "strictly newer seasons" by string-comparing season names, but the DB has no constraint preventing a `replacedById` from pointing at a same- or older-season product. A hand-edited or imported mapping (the chain comment explicitly acknowledges "hand-edited or imported loop") can point a product's `replacedById` at an older-season product, and the walker will follow it. The `seen` set and `maxHops=8` bound the walk and degrade the result to "dead end" rather than a wrong resolution, so the integrity outcome is safe — but the "forward-only" invariant the repeat flow relies on is a UI convention, not a guaranteed property of the data. A unique/partial-check constraint (or a server-side reject in the product save path) would make the invariant trustworthy regardless of how the row was written. (The string-comparison defect itself is M7; this finding is about the missing schema constraint.)

### m6 — Auto-flip timezone is manager-browser-local, not org-local
**Sources:** quality Minor 2
**Location:** `lib/seasons/manage.ts:197-269`; `app/(admin)/admin/seasons/season-manager.tsx:22-33`
**Claim:** `runSeasonFlip` compares against UTC `scheduledOpensAt`/`scheduledClosesAt`; the admin UI converts `datetime-local` input to ISO via `new Date(local)` — i.e. the manager's browser timezone. If the org operates in New York but a manager configures the flip from a Los Angeles session, the season opens 3 hours late in org time. The plan flags this as open question #7 ("assumed org-local; confirm"). The implementation silently uses whatever timezone the configuring browser is in, with no org-timezone setting and no UI hint. Acknowledged gap, not a defect — but worth pinning before P12 launch.

### m7 — Smoke S3 does not assert the full repeat-through-review pipeline on an imported order
**Sources:** quality Minor 4
**Location:** `.scratch/PHASE-P10-SMOKE.md` S3 (4 legs)
**Claim:** EXPECTED S3: "Repeat imported prior-year order (stub/migration hook OK) → mapped products, recipients, address book, greetings resolve." The smoke asserts the import creates the order, the `Legacy 2024` season exists, the stub product gets price-smart suggestions, and the archive renders. It does not run a repeat confirm over the imported order and assert recipient resolution, address-book linking, and greeting carry-through end-to-end. The status doc describes that resolution in prose but no smoke leg pins it. The "greetings resolve" half of S3 is unverified.

### m8 — Smoke S2 bulk-repeat only exercises one customer, not N
**Sources:** quality Minor 5
**Location:** `.scratch/PHASE-P10-SMOKE.md` S2 ("S2 bulk run creates one draft")
**Claim:** EXPECTED S2: "Bulk repeat drafts N customers." The smoke selects Bob's single order and asserts one draft + idempotent rerun. The multi-customer path (selecting several orders across customers in one batch, asserting N drafts land on N distinct customers) is not exercised. The `runBulkHistory` loop handles N, but N>1 is never asserted.

### m9 — Removing all recipients in the review produces a recipient-less, line-bearing draft (untested edge)
**Sources:** quality Minor 7
**Location:** `lib/repeat/create.ts:54-72, 119-124`; `components/repeat/repeat-review.tsx:103, 282-291`
**Claim:** The review lets the user remove every recipient. `applyConfirmations` then builds `recipients: []` while still emitting product lines with `recipientClientId: null`. The comment says "the checkout flow re-prompts assignment" — but a draft with zero recipients and non-empty lines is not smoke-asserted against the P4 draft engine. If `saveDraft` rejects a recipient-less draft, the user gets an opaque error; if it accepts, the draft has unassigned lines with no recipients to assign them to. Either way the edge is unverified.

### m10 — `runSeasonFlip` cron audit reuses the `season_schedule` action with `actor: null` and no `targetId`
**Sources:** security Minor 2, rules Minor 8, clean-code Minor 2
**Location:** `lib/seasons/manage.ts:242-248` (cron flip); `lib/seasons/manage.ts:184-194` (manual schedule save)
**Claim:** The cron-driven flip is recorded as `{ actor: null, action: "season_schedule", targetType: "Season", metadata: { cron: "season-flip", closed, opened } }` — no `targetId`. The same `season_schedule` action is used for manager schedule edits, which carry a real `ctx` actor and a `targetId`. For a security-relevant mutation (the season open/close is the year flip), the audit trail cannot distinguish a manager schedule edit from a cron flip except by inspecting `metadata.cron` and the null actor — attribution falls to out-of-band log correlation. The status doc lists `season_open`/`season_close` as distinct actions; the cron path doesn't use them. A dedicated `season_flip_cron` action (or at minimum a non-null `targetId` on the cron row) would keep the actor classes separable in the audit log. Violates: one-pattern-per-concern, naming (one action, two semantics).

### m11 — `runSeasonFlip` opens multiple due seasons in one tick and reports a misleading trail
**Sources:** security Minor 3, clean-code Minor 3
**Location:** `lib/seasons/manage.ts:221-238`
**Claim:** If two seasons are due in the same tick, iteration 1 closes A and opens B; iteration 2 re-queries `stillOpen`, finds B (just opened), closes B, then opens C. The DB ends with only C open (the `seasons_single_open` partial unique index is respected because each iteration closes before opening), but the returned `opened=[B,C]` / `closed=[A,B]` and the audit row claim B was opened when it was actually opened-then-closed in the same transaction. The manual `setSeasonStatus` path handles one flip per call; the cron path should follow the same "one flip per tick" discipline (break after the first open, or pick the single earliest due season). Violates: pattern drift (manual vs cron flip differ), inconsistent reporting vs final DB state. (Overlaps m2 on the same loop; m2 is the stale-schedule accumulation, m11 is the misleading audit trail — both come from the same code block but are distinct claims.)

### m12 — `RepeatSourceOrder` exported, never imported
**Sources:** rules Minor 2
**Location:** `lib/repeat/plan.ts:274`
**Claim:** `export type { SourceOrder as RepeatSource }` has no consumer anywhere in the workspace. Dead export. Violates: dead code.

### m13 — `targetName` holds a raw product id (naming)
**Sources:** rules Minor 3
**Location:** `lib/repeat/create.ts:108, 110, 184-185`
**Claim:** `targetName = decision.targetProductId` (a uuid), then `summary.swapped.push({ from, to: targetProductId })`, and the id is rewritten to the real name only later via a separate `prisma.product.findMany`. A variable named `targetName` carrying a uuid is misleading; the name resolution is split across the apply step and a post-hoc lookup. Violates: naming conventions.

### m14 — `replacementChainPreview` double-fetches the start product
**Sources:** quality Minor 6, rules Minor 5
**Location:** `lib/repeat/chain.ts:64-77` (preview fetch); `lib/repeat/chain.ts:40-43` (chain walk first hop)
**Claim:** `replacementChainPreview` does `prisma.product.findUnique` for the start name, then `resolveReplacementChain` does another `findUnique` on the same `productId`. Redundant query on every admin product page load. The start name could be carried into the chain walk or read from the first hop. Violates: ponytail § ladder. (Distinct from M6 — M6 is the duplicate render in the preview string; m14 is the redundant DB fetch.)

### m15 — `targetName` local in `applyConfirmations` swap branch is dead
**Sources:** rules Minor 3, clean-code Minor 4
**Location:** `lib/repeat/create.ts:102-110`
**Claim:** `targetName` is assigned (twice) but never read — `productInputs` only carries `productId`, `optionValueId`, `qty`, `recipientClientId`, and `summary.swapped.to` uses `targetProductId`, not `targetName`. The `let targetName` declaration and both assignments are dead. Violates: dead code. (Overlaps m13 on the same variable — m13 is the misleading-name concern while it is still "live" in intent; m15 is the fact that the assignments are never read. Both stand: even if renamed, the variable is dead.)

### m16 — `suggestByPrice` loads the entire open-season catalog into memory
**Sources:** rules Minor 6
**Location:** `lib/repeat/matcher.ts:27-31`
**Claim:** Fetches every active product in the target season with no `take`/pagination, then sorts in JS. Fine for a small catalog, scales poorly; the function only needs the nearest-priced few. Violates: anti-AI-tics ("just in case" code).

### m17 — No slug-collision guard on wizard catalog copy (inter-run)
**Sources:** rules Minor 7
**Location:** `lib/seasons/manage.ts:74-108`
**Claim:** The wizard stamps copied slugs via `copiedSlug(source.slug, year)` and creates each product with `prisma.product.create`. A second wizard copying the same source into the same year produces a duplicate slug and throws a Prisma unique-constraint 500 instead of a clean `DomainRuleError`. The wizard already guards the season name (line 42-43) but not the copied product slugs. Violates: error handling. (Distinct from M11's intra-run collision — m17 is two wizard runs into the same year.)

### m18 — `runBulkHistory` is a third copy of the bounded-bulk scaffold
**Sources:** clean-code Minor 1
**Location:** `lib/repeat/bulk-history.ts` (`runBulkHistory`); cf. `lib/orders/bulk.ts` (`runBulkOrderAction`), `lib/packages/bulk.ts`
**Claim:** Re-implements the same shape as the orders/packages bulk runners: limit check → `seen` set → trim/dedupe → scoped `findUnique` → per-row try/catch with `DomainRuleError` allow-list → count by outcome. The P7 review (m1) already flagged the orders/packages pair as extractable; P10 adds a third instance instead of extracting `runBoundedBulkAction`. Left Minor because the three are stable and an honest abstraction needs generics over id type, error allow-list, and per-row step. Violates: duplicated logic.

### m19 — Banned standalone name `result` in `repeat-bulk-picker.tsx`
**Sources:** clean-code Minor 5
**Location:** `app/(admin)/admin/repeat-bulk-picker.tsx:119-123`
**Claim:** `result` is on the banned list (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`). Rename to `row` or `runRow`. Violates: naming conventions.

### m20 — `RunResult` / `CandidateRow` / `SeasonRow` duplicate server types (type drift)
**Sources:** clean-code Minor 6
**Location:** `app/(admin)/admin/repeat-bulk-picker.tsx` (`CandidateRow`, `RunResult`); `app/(admin)/admin/seasons/season-manager.tsx` (`SeasonRow`); cf. `lib/repeat/bulk-history.ts` (`BulkHistoryRow`, `BulkItemResult`)
**Claim:** All three could be `import type` from their lib modules (the page already serializes Date→ISO at the boundary). Same drift class as M5, lower severity because these are local to one page each. Violates: type/schema drift.

### m21 — Magic `take: 500` in `listBulkHistoryCandidates`
**Sources:** clean-code Minor 7
**Location:** `lib/repeat/bulk-history.ts:63-64`
**Claim:** No named constant, no comment explaining why 500 (the picker is capped at `BULK_ACTION_LIMIT=100` per run, but the candidate list pulls 500). Either name it (`HISTORY_CANDIDATE_LIMIT`) or document the cap. Violates: magic values.

### m22 — `copiedSlug` regex assumes 2000–2099
**Sources:** clean-code Minor 8
**Location:** `lib/seasons/manage.ts:32-35`
**Claim:** `-20\d{2}$` only strips a `20XX` suffix. A slug ending `-1999` or `-2101` keeps its year suffix and the new season's slug becomes `foo-1999-2027` / `foo-2101-2027`. The function is called once per copied product, so a stale suffix cascades through the copied catalog. Either match any 4-digit year (`/-\d{4}$/`) or strip by the source season's known year. Violates: magic values.

### m23 — `targetSeason` lookup is two sequential awaits where one query suffices
**Sources:** clean-code Minor 9
**Location:** `app/(admin)/admin/products/[id]/page.tsx:65-68`
**Claim:** Two round-trips for a single fallback (`findFirst OPEN ?? findFirst orderBy createdAt desc`). A single `OR`-ordered query gets it in one. Minor because it runs once per product-edit page load. Violates: pattern drift (the rest of the codebase uses single bounded queries for "open or latest" — e.g. `getOpenSeason`).

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| M5 | rules Major 1 ; clean-code Major 4 (Major + Major → Major) |
| M7 | rules Major 3 ; clean-code Major 5 (Major + Major → Major) |
| M11 | quality Major 3 ; clean-code Major 1 (Major + Major → Major) |
| M12 | quality Minor 1 ; rules Minor 4 ; clean-code Major 2 (Minor + Minor + Major → Major) |
| M13 | rules Minor 1 ; clean-code Major 3 (Minor + Major → Major) |
| m10 | security Minor 2 ; rules Minor 8 ; clean-code Minor 2 |
| m11 | security Minor 3 ; clean-code Minor 3 |
| m14 | quality Minor 6 ; rules Minor 5 |
| m15 | rules Minor 3 ; clean-code Minor 4 |

All other aggregate IDs are single-source. No new findings introduced.

Related-but-distinct pairs kept separate:
- **M1 vs m1** (security): both touch the import hook + $0 stub — M1 is the swap-target price-integrity bypass in the repeat engine (`resolveDraftLines`), m1 is the manager trust-boundary on `importLegacyOrders` minting FINALIZED+PAID $0 orders. Different locations and claims; m1 notes it composes with M1 to make the $0 self-checkout path reachable.
- **M7 vs m5** (rules/clean-code + security): both touch the forward-only replacement invariant — M7 is the string-comparison defect in the editor filter, m5 is the missing schema constraint that lets a hand-edited/imported `replacedById` point backwards. Different defects; m5 explicitly carves out that the string-compare issue is M7.
- **M9 vs m1** (rules + security): both touch legacy import rows — M9 is the `totalCents: 0` data-integrity bug (order total never recomputed), m1 is the trust-boundary concern (manager can inject arbitrary FINALIZED+PAID history on any customer). Different claims.
- **M10 vs m4** (rules + security): both touch `importLegacyOrders` transaction boundaries — M10 is the stub-product written outside `tx` (atomicity of the order write), m4 is the non-transactional dedup `findFirst` (concurrency/idempotency). Different locations within the same function.
- **M11 vs m17** (quality/clean-code + rules): both touch wizard slug collisions — M11 is the intra-run collision (two source slugs collapse to the same base within one copy) plus the non-transactional copies, m17 is the inter-run collision (two wizard runs into the same year). Different scenarios.
- **M6 vs m14** (rules + quality/rules): both touch `replacementChainPreview` — M6 is the duplicate render in the preview string, m14 is the redundant DB fetch. Different defects.
- **m13 vs m15** (rules + rules/clean-code): both touch `targetName` in `applyConfirmations` — m13 is the misleading name (uuid in a `*Name` variable), m15 is the fact that the assignments are never read (dead). Both stand: even if renamed, the variable is dead.
- **m2 vs m11** (security + security/clean-code): both touch the `runSeasonFlip` `toOpen` loop — m2 is the stale `scheduledOpensAt` accumulation + first-open-wasted, m11 is the misleading audit trail (opened/closed arrays overstate the final DB state). Different claims from the same code block.

## Pass notes (not counted)

- **Customer repeat IDOR on the source order** (security PASS): `app/api/orders/[orderId]/repeat/route.ts` GET and POST both load the order and reject `order.customerId !== gate.ctx.customer.id` with 404; the storefront repeat page does the same. A customer cannot repeat another customer's order. No finding.
- **Staff repeat acting on any customer's order** (security PASS): R-057/R-058 specify staff repeat of customer history. `payments.manage` gating + `createDraftFromRepeat` reloading `source.customerId` (not client input) means the draft lands on the source customer's account. No finding. (M8 is the one-click path's cross-season scope gap, raised separately.)
- **Bulk-history `orderIds` IDOR** (security PASS): `runBulkHistory` validates each id: exists, `FINALIZED`, `seasonId !== open.id`, not already repeated. Staff bulk-repeat of any customer's prior order is the specified R-058 behavior. No finding. (M2 is the concurrency gap, raised separately.)
- **Season-flip cron CSRF on GET-with-bearer** (security PASS): the Authorization header is the CSRF guard; browsers do not attach it cross-origin without credentials, and a headerless `<img>`-style GET hits the 401 before any mutation. No finding.
- **`CRON_SECRET` length oracle** (security PASS): `lib/cron-auth.ts` hashes both sides before `timingSafeEqual` (the P9 m3 fix); no length pre-check remains. No finding.
- **Single-open-season race** (security PASS): the `seasons_single_open` partial unique index (P2 fix migration) makes a double-open throw and roll back; `setSeasonStatus` and `runSeasonFlip` both transact. No finding. (m2/m11 are audit-fidelity gaps within the transacted loop, raised separately.)
- **Customer repeat of a DRAFT** (security PASS): `buildRepeatPlan` accepts `FINALIZED` or `DRAFT`; repeating a draft creates a new draft on the same customer's account. No cross-customer exposure. No finding. (M3 is the gate inconsistency between entry points, raised separately.)
- **Replacement chain correctness** (quality PASS): forward-only walk, visited-set loop guard, 8-hop cap, dead-end honesty, inactive-final → dead end. The admin preview targets the OPEN season (falling back to newest only off-season). Correct. (The forward-only *enforcement* defects are M7 and m5, raised separately.)
- **Review-page gate** (quality PASS): confirm disabled while any unmapped line lacks a swap target; price-smart default preselects the top suggestion but the banner and per-line select keep it visible; the server-side `applyConfirmations` re-validates and throws on an undecided unmapped line — pick-or-remove is law on both sides. Correct.
- **Price-smart defaults** (quality PASS): same-category-first, then `abs(priceDelta)` ascending, capped at 3. Never silently maps — the review page is the mapping UI. Correct.
- **Auto-flip transactionality** (quality PASS): closes before opening inside one transaction; stale-schedule guard; CronRun row on every run (flip or no-flip); single-open invariant held. Correct. (m2/m11 are within this transacted loop, raised separately.)
- **Off-season archive** (quality PASS): public, session-free, filters to CLOSED seasons with orders (wizard shells excluded), no buy CTAs. Matches UR-008 browse half. Correct.
- **Legacy import hook** (quality PASS for the hook itself): email-keyed customer upsert, external-key dedupe, stub products inactive+unmapped so repeats flow through the same review pipeline. Year-one repeat works from day one. Correct. (The smoke-coverage gap is m7, the transactional/trust/total defects are M9/M10/m1/m4, raised separately.)
- **Coverage** (rules PASS): all four P10 EXPECTED checklist items and all smoke checks (S1–S3) have corresponding code paths; smoke 40/0. No stubs; the seams are honest. (Smoke-coverage gaps are m7/m8, raised separately.)
- **Codegraph rule** (rules PASS): the arm's `.codegraph/` index exists; init obligation met.
- **Vocabulary rule** (rules PASS): no command-scope words in the reviewed artifacts.
- **No secrets committed** (rules PASS): `.env` is gitignored; `.env.example` carries placeholders only.

## Bottom line

No Blockers, no Critical. P10 arm-06 is functionally complete against EXPECTED (all four must-trues implemented, smoke S1–S3 pass 40/0, lint/typecheck/migration-guard/test:unit/test:domain/build green). The 13 Majors cluster on: the repeat-swap price-integrity bypass (M1 — engine accepts any product id as a swap target, enabling $0/prior-season checkout), the bulk-history concurrency race (M2), the DRAFT-repeat gate inconsistency (M3), the wizard dropping product media (M4), client/server plan-type drift (M5), the duplicated chain-preview render (M6), the string-compare forward-only invariant (M7), the one-click staff repeat's cross-season failure (M8), the legacy-import $0 order total (M9), the stub-product-outside-tx (M10), the wizard's broken transaction invariant + intra-run slug collision (M11), the double plan build (M12), and dead `planRepeat` production code (M13). The 23 Minors are trust-boundary/audit-attribution gaps (m1, m3, m10), concurrency/idempotency (m4), schema-constraint gaps (m5), smoke-coverage gaps (m7, m8), untested edges (m9), duplication (m18), type drift (m20), magic values (m21, m22), naming (m13, m19), dead code (m12, m15), performance (m16), error-handling (m17, m23), and operational/timezone cleanups (m6, m2, m11, m14). The P9 m3 `CRON_SECRET` length-oracle fix held; the P8 m16 `AuditAction` drift is not re-flagged this phase (P10's audit additions are in lockstep). M1 + m1 compose into a $0-self-checkout path that is the most urgent P11/P12 fix; M2, M8, and m4 tee up P12 crunch-load hardening.

