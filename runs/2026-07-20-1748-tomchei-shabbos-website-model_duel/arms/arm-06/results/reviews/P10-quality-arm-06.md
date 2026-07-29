# Reviewer specialist — Quality

**Arm:** arm-06 (blind — no model names)
**Tree / phase:** P10 — Seasons management, repeat orders, replacement mappings
**Output:** `results/reviews/P10-quality-arm-06.md`
**Spec:** `shared/phases/PHASE-P10-EXPECTED.md` + `shared/MERGED-BUILD-PLAN.md` § P10

Focus: correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.
Findings only, no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 7 |
| **Total** | **10** |

The phase is functionally complete against the four EXPECTED must-trues and the S1–S3 smoke ran green (40/40). The findings below are concurrency, gating, and coverage gaps — none block the phase gate, but the bulk-idempotency race and the wizard's dropped media are worth fixing before P12 crunch load.

---

## Blockers

None.

---

## Majors

### M1 — Bulk-history idempotency is check-then-act with no concurrency guard
`lib/repeat/bulk-history.ts:111-135` (`runBulkHistory`)

The idempotency claim ("an order that already has a non-discarded repeat draft in the open season is a skipped row, so a re-run never double-creates") rests on a read of `source.repeats` (the `repeatedFromOrderId` back-relation filtered to `seasonId: open.id, status: { not: "DISCARDED" }`) followed by `createDraftFromRepeat` in a separate operation. There is no transaction, no row lock on the source order, and no unique constraint on `(repeatedFromOrderId, seasonId)` for non-discarded drafts. Two concurrent bulk-repeat batches (two staff hitting "Repeat N selected" at crunch, which the plan explicitly targets — 10+ concurrent staff) can both read `repeats.length === 0` for the same source and both create drafts. The status doc itself says "Bulk history is lineage-idempotent, not request-idempotent" — but the lineage marker is written inside `saveDraft` with no guard, so under concurrency the lineage is duplicated, not deduplicated.

Why it matters: the phase's headline S2 check is "Bulk repeat + idempotency." The smoke only asserts sequential idempotency (one caller, two runs). The cross-caller case — the realistic crunch scenario — is unguarded and untested.

### M2 — Repeat review endpoints allow repeating DRAFT orders; gate inconsistent with one-click path
`app/api/orders/[orderId]/repeat/route.ts:60-97`, `app/api/admin/orders/[orderId]/repeat/route.ts:53-86`, `lib/repeat/plan.ts:125-127`

`buildRepeatPlan` accepts both `FINALIZED` and `DRAFT` sources. The customer repeat page (`account/orders/[id]/page.tsx:67`) only shows the repeat link for `FINALIZED` orders — but the customer repeat API (`POST /api/orders/[orderId]/repeat`) checks ownership only, not status. A customer can POST directly against their own DRAFT order id and get a second draft cloned from an in-progress order. The staff admin repeat page (`admin/orders/[orderId]/repeat/page.tsx:24`) only blocks `DISCARDED`, so staff can repeat a DRAFT through the review page. Meanwhile the one-click `repeatOrder` (`lib/orders/repeat.ts:90`) correctly requires `FINALIZED`. The three entry points disagree on the gate. Repeating a draft is not dangerous (it just creates another draft) but it is an inconsistency that the spec doesn't call for and the smoke doesn't cover.

Why it matters: the review-page path is the P10 addition; it loosened the status gate that the one-click path enforces. A customer discovering the API can clone their own in-progress draft, producing duplicate drafts from a non-finalized source.

### M3 — Season wizard catalog copy drops product media; copied season has no photos
`lib/seasons/manage.ts:46-110` (`createSeasonWizard`)

The source-season `include` selects `options`, `values`, and `allowedAddOns` but not `media`. Each copied `product.create` carries dims, inventory flags, options, and add-on restrictions — but no `media` rows. The new season's storefront and the admin product cards will render with no images. The wizard is the documented "new-season setup" path (R-097); a copied catalog landing without photos is a visible storefront regression for every season after the first.

Why it matters: the EXPECTED lists the wizard under "New-season setup wizard (R-097)" with no carve-out for media. The archive page (`past-collections/page.tsx:20`) eagerly renders `product.media[0]?.url` — a copied-then-closed season shows blank tiles.

---

## Minors

### m1 — `createDraftFromRepeat` rebuilds the plan the caller already built (2N plan builds per bulk run)
`lib/repeat/create.ts:175`, `lib/repeat/bulk-history.ts:134-135`

`runBulkHistory` calls `buildRepeatPlan(orderId)` to get the dropped count, then calls `createDraftFromRepeat(autoConfirmPlan(plan))`, which calls `buildRepeatPlan(input.sourceOrderId)` again. Each `buildRepeatPlan` does per-line `resolveReplacementChain` + `mapOption` + `mapAddOn` + (for dead ends) `suggestByPrice` queries. At `BULK_ACTION_LIMIT = 100` orders that is up to 200 plan builds per bulk run, each with N+1 queries. Wasteful at the crunch scale the plan targets. The dropped count can be derived from the draft summary or the rebuilt plan inside `createDraftFromRepeat` without a second build.

### m2 — Auto-flip timezone is manager-browser-local, not org-local
`lib/seasons/manage.ts:197-269`, `app/(admin)/admin/seasons/season-manager.tsx:22-33`

`runSeasonFlip` compares against UTC `scheduledOpensAt`/`scheduledClosesAt`; the admin UI converts `datetime-local` input to ISO via `new Date(local)` — i.e. the manager's browser timezone. If the org operates in New York but a manager configures the flip from a Los Angeles session, the season opens 3 hours late in org time. The plan flags this as open question #7 ("assumed org-local; confirm"). The implementation silently uses whatever timezone the configuring browser is in, with no org-timezone setting and no UI hint. Acknowledged gap, not a defect — but worth pinning before P12 launch.

### m3 — `copiedSlug` can collide mid-copy and the wizard copies are not transactional
`lib/seasons/manage.ts:32-35, 73-110`

`copiedSlug` strips a trailing `-20XX` and re-suffixes the new year. Two source products whose slugs collapse to the same base (e.g. `basket-2025` and `basket-2026` both → `basket-2027`) produce a unique-slug violation on the second `product.create`. The copies are issued as individual `prisma.product.create` calls outside any transaction, so a collision mid-copy leaves a partial catalog (some products copied, then a thrown error). The season row itself is created first and stays.

### m4 — Smoke S3 does not assert the full repeat-through-review pipeline on an imported order
`.scratch/PHASE-P10-SMOKE.md` S3 (4 legs)

EXPECTED S3: "Repeat imported prior-year order (stub/migration hook OK) → mapped products, recipients, address book, greetings resolve." The smoke asserts the import creates the order, the `Legacy 2024` season exists, the stub product gets price-smart suggestions, and the archive renders. It does not run a repeat confirm over the imported order and assert recipient resolution, address-book linking, and greeting carry-through end-to-end. The status doc describes that resolution in prose ("The staff repeat plan over that order resolves the recipient and flags the stub line unmapped…") but no smoke leg pins it. The "greetings resolve" half of S3 is unverified.

### m5 — Smoke S2 bulk-repeat only exercises one customer, not N
`.scratch/PHASE-P10-SMOKE.md` S2 ("S2 bulk run creates one draft")

EXPECTED S2: "Bulk repeat drafts N customers." The smoke selects Bob's single order and asserts one draft + idempotent rerun. The multi-customer path (selecting several orders across customers in one batch, asserting N drafts land on N distinct customers) is not exercised. The `runBulkHistory` loop handles N, but N>1 is never asserted.

### m6 — `replacementChainPreview` double-fetches the start product
`lib/repeat/chain.ts:64-77`

`replacementChainPreview` does `prisma.product.findUnique` for the start name (lines 68-71), then `resolveReplacementChain` does another `findUnique` on the same `productId` (line 40-43). Redundant query on every admin product page load. The start name could be carried into the chain walk or read from the first hop.

### m7 — Removing all recipients in the review produces a recipient-less, line-bearing draft (untested edge)
`lib/repeat/create.ts:54-72, 119-124`, `components/repeat/repeat-review.tsx:103, 282-291`

The review lets the user remove every recipient. `applyConfirmations` then builds `recipients: []` while still emitting product lines with `recipientClientId: null`. The comment says "the checkout flow re-prompts assignment" — but a draft with zero recipients and non-empty lines is not smoke-asserted against the P4 draft engine. If `saveDraft` rejects a recipient-less draft, the user gets an opaque error; if it accepts, the draft has unassigned lines with no recipients to assign them to. Either way the edge is unverified.

---

## What is solid (no findings)

- **Replacement chain correctness** (`lib/repeat/chain.ts`): forward-only walk, visited-set loop guard, 8-hop cap, dead-end honesty, inactive-final → dead end. The admin preview targets the OPEN season (falling back to newest only off-season) so a freshly-created future season doesn't mislabel live chains. Correct.
- **Review-page gate** (`components/repeat/repeat-review.tsx`): confirm disabled while any unmapped line lacks a swap target; price-smart default preselects the top suggestion but the banner and per-line select keep it visible; the server-side `applyConfirmations` re-validates and throws on an undecided unmapped line — pick-or-remove is law on both sides. Correct.
- **Price-smart defaults** (`lib/repeat/matcher.ts`): same-category-first, then `abs(priceDelta)` ascending, capped at 3. Never silently maps — the review page is the mapping UI. Correct.
- **Auto-flip transactionality** (`runSeasonFlip`): closes before opening inside one transaction; stale-schedule guard; CronRun row on every run (flip or no-flip); single-open invariant held. Correct.
- **Off-season archive** (`past-collections/page.tsx`): public, session-free, filters to CLOSED seasons with orders (wizard shells excluded), no buy CTAs. Matches UR-008 browse half. Correct.
- **Legacy import hook** (`lib/repeat/import-hook.ts`): email-keyed customer upsert, external-key dedupe, stub products inactive+unmapped so repeats flow through the same review pipeline. Year-one repeat works from day one. Correct (the smoke-coverage gap is in m4, not the hook).

## Severity recap

- **Blocker: 0**
- **Major: 3** (M1 bulk race, M2 DRAFT-repeat gate, M3 wizard drops media)
- **Minor: 7** (m1 double plan build, m2 flip timezone, m3 slug collision, m4 S3 smoke gap, m5 S2 N-customer gap, m6 redundant chain query, m7 all-recipients-removed edge)
