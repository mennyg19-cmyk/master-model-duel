# Reviewer specialist — Rules — P10 — arm-06 (blind)

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Tree:** arms/arm-06/workspace/
**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Plan ref:** shared/phases/PHASE-P10-EXPECTED.md, shared/MERGED-BUILD-PLAN.md § P10
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph (.cursor/rules/*.mdc)
**Reviewer:** rules specialist, blind to model name
**Scope:** adherence to this arm's selected catalog rules only. Findings only, no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 6 |
| Minor | 8 |
| **Total** | **14** |

Phase coverage against PHASE-P10-EXPECTED.md is complete (all four "must be true" items have code + smoke evidence; see STATUS/SMOKE). The findings below are rule-adherence defects, not missing features.

---

## Major

### M1. Type drift: repeat plan redeclared in the client component (clean-code § "type/schema drift — single source of truth")
`components/repeat/repeat-review.tsx:15-72` re-declares `ReviewSuggestion`, `ReviewAddOn`, `ReviewLine`, `ReviewRecipient`, and `ReviewPlan` as structural duplicates of `lib/repeat/plan.ts`'s `PriceSuggestion`, `RepeatPlanAddOn`, `RepeatPlanLine`, `RepeatPlanRecipient`, and `RepeatReviewPlan`. The server ships the `RepeatReviewPlan` shape over the wire; the client maintains its own copy. When the server adds/renames a field, the client type silently drifts with no compiler error — exactly the "single source of truth" violation. The client should import the canonical types (or a shared types module) instead of forking them.

### M2. Chain preview renders the source product twice (clean-code § correctness / anti-AI-tics: claim vs behavior)
`lib/repeat/chain.ts:63-77` `replacementChainPreview` builds `names = [start.name, ...chain.hops.map(h => h.name)]` then pushes `chain.final.name`. `resolveReplacementChain` records the FROM product at each hop, so for a direct map A→B, `hops=[A]` and `final=B`, yielding `[A, A, B]` → "A → A → B". For A→B→C the preview is "A → A → B → C". The start product is duplicated because `hops[0]` IS the start. The admin product page (`app/(admin)/admin/products/[id]/page.tsx:144`) renders this string verbatim as `data-chain-preview`. Smoke S2 "chain preview resolves forward" passes because it checks the final name appears, not the exact string, so the defect is latent.

### M3. Forward-only replacement invariant enforced by string comparison on season names (clean-code § "magic values" + correctness)
`app/(admin)/admin/products/[id]/page.tsx:78` filters replacement candidates with `candidate.season.name > productSeasonName`. Season names are free-form strings ("Purim 2026", "SMOKE-P10-OLD", "Legacy 2024"); lexicographic comparison is not a valid recency ordering. `lib/repeat/chain.ts:5-7` asserts "Mappings are forward-only (the product editor refuses a replacement in the same or an older season)" — but the editor only filters by name string, not by `createdAt`/season order. A replacement link to an older season can be created if the names compare favorably, silently breaking the chain's forward-only assumption that the visited-set loop guard relies on.

### M4. One-click staff repeat cannot repeat a prior-season order (workflow § "verify in the running app" gap; R-057 scope)
`app/(admin)/admin/orders/[orderId]/order-actions.tsx:92-106` "Repeat as new draft" posts to `/api/admin/orders/bulk` with `action: "repeat"`. `lib/orders/bulk.ts:44-48` scopes the bulk action to `seasonId: season.id` (the open season) and skips any id not in scope as "not an order in the open season". So the one-click button on a prior-season finalized order silently fails with a skip reason, while the "Repeat with review…" link (which calls `buildRepeatPlan` directly, no season scope) works cross-season. The button label promises a repeat it cannot perform for the cross-season case that is P10's primary repeat scenario.

### M5. Legacy import creates FINALIZED orders with `totalCents: 0` regardless of line totals (clean-code § "type/schema drift" / data integrity)
`lib/repeat/import-hook.ts:118` creates the order with `totalCents: 0`, then lines are created with `lineTotalCents: product.basePriceCents * qty` (line 152). The order total is never recomputed from the lines. The customer order detail (`app/(storefront)/account/orders/[id]/page.tsx:45,126`) renders `formatCents(order.totalCents)` → "$0.00" for a populated legacy order. The repeat plan reads line-level prices so repeat works, but the stored order total is structurally wrong for imported history.

### M6. Legacy import: stub products written outside the transaction (clean-code § error handling / transactional integrity)
`lib/repeat/import-hook.ts:110-159` wraps `order`/`draftRecipient`/`orderLine` creation in `prisma.$transaction(async (tx) => …)`, but `stubProduct` (line 54-69, called at line 142) uses the global `prisma.product.upsert`, not `tx`. The stub product is committed immediately; if the transaction rolls back, the order/lines vanish but the stub product remains. The upsert-by-slug makes this recoverable on retry, but the transaction boundary is wrong: writes intended to be atomic are split across the global client and `tx`, violating the file's own "persists legacy rows as FINALIZED orders" atomicity intent.

---

## Minor

### m1. `planRepeat` shell retained only by a self-licking test (clean-code § "dead code — delete, don't comment out")
`lib/orders/repeat.ts:28-85` exports `planRepeat`, `RepeatPlan`, `RepeatCatalog`, `RepeatSkip`. Production no longer calls `planRepeat` — `repeatOrder` (line 87-103) now rides `buildRepeatPlan`/`autoConfirmPlan`, and `lib/orders/bulk.ts` calls `repeatOrder`. The only remaining consumer is `scripts/test-p6.mts` testing `planRepeat` in isolation. The shell is orphaned by production but kept alive by its own test.

### m2. `RepeatSourceOrder` exported, never imported (clean-code § dead code)
`lib/repeat/plan.ts:274` `export type { SourceOrder as RepeatSource }` has no consumer anywhere in the workspace.

### m3. `targetName` holds a raw product id (clean-code § naming conventions)
`lib/repeat/create.ts:108` sets `targetName = decision.targetProductId` (a uuid), then `summary.swapped.push({ from, to: targetProductId })` (line 110), and the id is rewritten to the real name only later at lines 184-185 via a separate `prisma.product.findMany`. A variable named `targetName` carrying a uuid is misleading; the name resolution is split across the apply step and a post-hoc lookup.

### m4. Double plan build on the one-click and bulk paths (ponytail § "shortest working diff")
`lib/orders/repeat.ts:97-98` and `lib/repeat/bulk-history.ts:134-135` both call `buildRepeatPlan(orderId)` to read `unmappedCount`, then call `createDraftFromRepeat(...)` which calls `buildRepeatPlan` again internally (line 175). For bulk history this is 2N plan builds for N orders. The already-built plan could be passed through to avoid the rebuild.

### m5. Redundant start-product fetch in chain preview (ponytail § ladder)
`lib/repeat/chain.ts:68-72` `replacementChainPreview` fetches the start product's name, then `resolveReplacementChain`'s first loop iteration fetches the same product again. The start name could be carried from the first hop.

### m6. `suggestByPrice` loads the entire open-season catalog into memory (clean-code § "no 'just in case' code")
`lib/repeat/matcher.ts:27-31` fetches every active product in the target season with no `take`/pagination, then sorts in JS. Fine for a small catalog, scales poorly; the function only needs the nearest-priced few.

### m7. No slug-collision guard on wizard catalog copy (clean-code § error handling)
`lib/seasons/manage.ts:74-108` stamps copied slugs via `copiedSlug(source.slug, year)` and creates each product with `prisma.product.create`. A second wizard copying the same source into the same year produces a duplicate slug and throws a Prisma unique-constraint 500 instead of a clean `DomainRuleError`. The wizard already guards the season name (line 42-43) but not the copied product slugs.

### m8. Cron flip audit reuses `season_schedule` action for a flip (clean-code § "one pattern per concern")
`lib/seasons/manage.ts:242-248` records the cron flip under `action: "season_schedule"` with a `cron: "season-flip"` metadata flag, the same action used by `setSeasonSchedule` (line 186). Manual schedule edits and cron flips become indistinguishable in the audit log without inspecting metadata. The status doc lists `season_open`/`season_close` as distinct actions; the cron path doesn't use them.

---

## Rule coverage notes (no finding)

- **codegraph.mdc**: structural lookups in the new `lib/repeat/*` and `lib/seasons/manage.ts` modules were not grepped-for-symbols in this review (reviewer is a subagent without the MCP); findings are based on Read. No codegraph violation is asserted.
- **workflow.mdc § Spec gate / expectation files**: `.scratch/PHASE-P10-STATUS.md` and `PHASE-P10-SMOKE.md` are present and walked item-by-item; expectation-file discipline is satisfied.
- **workflow.mdc § Gate discipline**: lint/typecheck/migration-guard/test:unit/test:domain/build all reported green; smoke 40/0 with idempotent rerun.
- **ponytail.mdc § anti-slop**: comments across the new modules are non-obvious intent (chain forward-only rationale, unmapped-is-a-decision law, single-open invariant), not narration. No sycophancy or stock vocab in code comments.
- **vocabulary.mdc**: no refactor/tidy/rebuild commands in scope this phase; "add" (new features) followed existing patterns (Card/Button/Input/Select, apiFetch, recordAudit, DomainRuleError).

## Out of scope

- Full P12 migration import pipeline (year-one repeat gated until P12) — explicitly out of scope per PHASE-P10-EXPECTED.md.
- Email/SMS platform (P11), reporting/launch polish (P12).
