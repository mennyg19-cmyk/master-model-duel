# P10 Clean-code review — arm-06

**Phase:** P10 — Seasons management, repeat orders, replacement mappings (per `shared/phases/PHASE-P10-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P10)
**Rule source:** `arms/arm-06/.cursor/rules/clean-code.mdc`
**Scope:** new and modified files under `arms/arm-06/workspace/` for P10 (commit `6343a73`): `lib/repeat/{plan,create,chain,matcher,bulk-history,import-hook}.ts`, `lib/seasons/manage.ts`, `lib/orders/repeat.ts`, `lib/orders/drafts.ts`, `lib/audit.ts`, `components/repeat/repeat-review.tsx`, `app/(admin)/admin/{seasons,repeat-bulk,orders/[orderId]/repeat,products/[id]}/*`, `app/(storefront)/account/orders/[id]/repeat/page.tsx`, `app/(storefront)/account/orders/page.tsx`, `app/(storefront)/past-collections/page.tsx`, `app/api/admin/{seasons,repeat-bulk,orders/[orderId]/repeat,import/legacy-orders}/route.ts`, `app/api/orders/[orderId]/repeat/route.ts`, `app/api/cron/season-flip/route.ts`, `prisma/schema.prisma` + migration.
**Mode:** findings only, no fixes. Blind to model name.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 5 |
| Minor | 9 |

## Major

### M1 — `createSeasonWizard` breaks the file's own transaction invariant (pattern drift)
`lib/seasons/manage.ts` opens with: "every write here runs in a transaction so a failed flip never leaves two seasons half-open." `setSeasonStatus` and `runSeasonFlip` honor that — both wrap in `prisma.$transaction`. `createSeasonWizard` does not:

```37:69:arms/arm-06/workspace/lib/seasons/manage.ts
  const year = getSeasonYear(new Date());
  const season = await prisma.season.create({
    data: { name, status: "CLOSED", scheduledOpensAt: ..., scheduledClosesAt: ... },
  });

  let copiedProducts = 0;
  if (source) {
    for (const product of source.products) {
      await prisma.product.create({ data: { ... slug: copiedSlug(product.slug, year) ... } });
      copiedProducts++;
    }
  }
```

The season row is committed, then each copied product is a separate `prisma.product.create` (not `tx`). A failure midway through the catalog copy leaves a CLOSED season with a half-copied catalog and no audit row — exactly the "half-built catalog" the docstring claims the wizard avoids. Either wrap season+copies in one transaction, or drop the invariant claim from the file header. Violates: inconsistent patterns, anti-AI-tics (claim the code can't back).

### M2 — `buildRepeatPlan` runs twice per order on the server (duplicated work)
Both server-side repeat callers build the plan, then hand off to `createDraftFromRepeat`, which rebuilds the same plan internally:

```133:135:arms/arm-06/workspace/lib/repeat/bulk-history.ts
    const plan = await buildRepeatPlan(orderId);
    const { draft } = await createDraftFromRepeat(autoConfirmPlan(plan));
    const dropped = plan.unmappedCount;
```

```97:98:arms/arm-06/workspace/lib/orders/repeat.ts
  const plan = await buildRepeatPlan(orderId);
  const { draft } = await createDraftFromRepeat(autoConfirmPlan(plan));
```

`createDraftFromRepeat` calls `buildRepeatPlan(input.sourceOrderId)` again at `lib/repeat/create.ts:175`. `buildRepeatPlan` is N+1 per source line (chain walk + `mapOption` + `mapAddOn` + `product.findUnique` per line, plus `suggestByPrice` per dead end), so the bulk-history path doubles the DB load for every order in a 100-order batch. The "don't trust the client" rebuild is correct for the POST review-confirm path; for these two server-only callers the plan is already in hand. Pass the built plan into `createDraftFromRepeat` (or split the confirm path into `confirmFromPlan(plan, input)` + a thin `createDraftFromRepeat` that builds then delegates) so server callers pay once. Violates: duplicated logic, anti-AI-tics ("just in case" rebuild).

### M3 — `planRepeat` / `RepeatPlan` / `RepeatCatalog` are dead production code
`lib/orders/repeat.ts` keeps the P6-era pure planning function and its types:

```28:85:arms/arm-06/workspace/lib/orders/repeat.ts
export function planRepeat(order: DraftWithContents, catalog: RepeatCatalog): RepeatPlan {
  // ... ~58 lines ...
}
```

After P10, the only production caller in this file (`repeatOrder`) goes through `buildRepeatPlan` + `autoConfirmPlan` + `createDraftFromRepeat` and never touches `planRepeat`. A repo-wide grep confirms `planRepeat` / `RepeatPlan` / `RepeatCatalog` are referenced only by `scripts/test-p6.mts` — a stale test keeping dead production code on life support. `RepeatSkip` is still live (returned by `repeatOrder`). Delete `planRepeat`, `RepeatPlan`, `RepeatCatalog`; either delete the P6 test or rewrite it against the new pipeline. Violates: dead code (clean-code rule: "Dead code — delete, don't comment out").

### M4 — `RepeatReview` re-defines the plan types instead of `import type` (type drift)
`components/repeat/repeat-review.tsx` hand-copies every server plan interface:

```15:72:arms/arm-06/workspace/components/repeat/repeat-review.tsx
export interface ReviewSuggestion { ... }
export interface ReviewAddOn { ... }
export interface ReviewLine { ... }
export interface ReviewRecipient { ... }
export interface ReviewPlan { ... }
```

These are byte-for-byte the shapes of `PriceSuggestion`, `RepeatPlanAddOn`, `RepeatPlanLine`, `RepeatPlanRecipient`, `RepeatReviewPlan` in `lib/repeat/plan.ts` + `lib/repeat/matcher.ts`. The client cannot `import` those modules at runtime (they pull `@/lib/db`), but `import type { RepeatReviewPlan, RepeatPlanLine, ... }` erases at compile time and ships zero server code to the client bundle. Today the two sets are in sync by hand; the next field added to `RepeatPlanLine` (e.g. a `note` string) will silently not reach the review page. Violates: type/schema drift, duplicated logic.

### M5 — `replacementOptions` filters "strictly newer seasons" by season-name string compare (pattern drift / correctness)
`app/(admin)/admin/products/[id]/page.tsx`:

```77:79:arms/arm-06/workspace/app/(admin)/admin/products/[id]/page.tsx
  const replacementOptions = otherProducts
    .filter((candidate) => candidate.season.name > productSeasonName)
    .map((candidate) => ({ id: candidate.id, name: candidate.name }));
```

The comment says "Replacement links point forward only ... the editor offers products from strictly newer seasons." Lexical compare on free-form season names does not establish chronological order: `"Spring 2026" > "Winter 2025"` is `false` (S < W), so a Spring season is hidden from a Winter product's replacement picker, while `"Purim 2027" > "Purim 2026"` happens to work only because the prefixes match. The rest of the codebase orders seasons by `createdAt` (`lib/seasons/manage.ts`, the seasons list pages). Compare on `season.createdAt` (or a `year` field), not on `name`. Violates: magic values (the name string doing double duty as an order key), pattern drift (one ordering rule elsewhere, another here).

## Minor

### m1 — `runBulkHistory` is a third copy of the bounded-bulk scaffold
`lib/repeat/bulk-history.ts` (`runBulkHistory`) re-implements the same shape as `lib/orders/bulk.ts` (`runBulkOrderAction`) and (per the P7 review) `lib/packages/bulk.ts`: limit check → `seen` set → trim/dedupe → scoped `findUnique` → per-row try/catch with `DomainRuleError` allow-list → count by outcome. The P7 review (m1) already flagged the orders/packages pair as extractable; P10 adds a third instance instead of extracting `runBoundedBulkAction`. Left Minor because the three are stable and a honest abstraction needs generics over id type, error allow-list, and per-row step.

### m2 — `runSeasonFlip` audit action collides with manual schedule saves
`lib/seasons/manage.ts`:

```242:247:arms/arm-06/workspace/lib/seasons/manage.ts
    if (closed.length > 0 || opened.length > 0) {
      await recordAudit({
        actor: null,
        action: "season_schedule",
        targetType: "Season",
        metadata: { cron: "season-flip", at: now.toISOString(), closed, opened },
      });
    }
```

`setSeasonSchedule` (manual manager save) also logs `action: "season_schedule"`. The only way to tell a cron flip from a manual schedule save is the `metadata.cron` key. The audit enum already has `season_open` / `season_close` for the manual flip; the cron flip should log a distinct action (e.g. `season_auto_flip`) so audit readers don't have to introspect metadata to separate automated from manual state changes. Violates: naming (one action, two semantics).

### m3 — `runSeasonFlip` opens multiple due seasons in one tick and reports a misleading trail
`lib/seasons/manage.ts`:

```221:238:arms/arm-06/workspace/lib/seasons/manage.ts
      const toOpen = await tx.season.findMany({
        where: { status: "CLOSED", scheduledOpensAt: { lte: now } },
        orderBy: { scheduledOpensAt: "asc" },
      });
      for (const season of toOpen) {
        if (season.scheduledClosesAt && season.scheduledClosesAt <= now) continue;
        const stillOpen = await tx.season.findFirst({ where: { status: "OPEN" } });
        if (stillOpen) {
          await tx.season.update({ where: { id: stillOpen.id }, data: { status: "CLOSED" } });
          closed.push(stillOpen.name);
        }
        await tx.season.update({ where: { id: season.id }, data: { status: "OPEN", scheduledOpensAt: null } });
        opened.push(season.name);
      }
```

If two seasons are due in the same tick, iteration 1 closes A and opens B; iteration 2 re-queries `stillOpen`, finds B (just opened), closes B, then opens C. The DB ends with only C open (the `seasons_single_open` partial unique index is respected because each iteration closes before opening), but the returned `opened=[B,C]` / `closed=[A,B]` and the audit row claim B was opened when it was actually opened-then-closed in the same transaction. The manual `setSeasonStatus` path handles one flip per call; the cron path should follow the same "one flip per tick" discipline (break after the first open, or pick the single earliest due season). Violates: pattern drift (manual vs cron flip differ), inconsistent reporting vs final DB state.

### m4 — `targetName` local in `applyConfirmations` swap branch is dead
`lib/repeat/create.ts`:

```102:110:arms/arm-06/workspace/lib/repeat/create.ts
    let targetName = planLine.targetName;
    let optionValueId = planLine.optionValueId;
    if (action === "swap") {
      if (!decision?.targetProductId) { ... }
      targetProductId = decision.targetProductId;
      targetName = decision.targetProductId; // display name resolved by the draft engine
      optionValueId = null; // source option rarely survives a manual swap; engine validates
      summary.swapped.push({ from: planLine.sourceName, to: targetProductId });
    } else {
      summary.kept.push(planLine.sourceName);
    }
```

`targetName` is assigned (twice) but never read — `productInputs` only carries `productId`, `optionValueId`, `qty`, `recipientClientId`, and `summary.swapped.to` uses `targetProductId`, not `targetName`. The `let targetName` declaration and both assignments are dead. Violates: dead code.

### m5 — Banned standalone name `result` in `repeat-bulk-picker.tsx`
`app/(admin)/admin/repeat-bulk-picker.tsx`:

```119:123:arms/arm-06/workspace/app/(admin)/admin/repeat-bulk-picker.tsx
            {report.map((result) => (
              <li key={result.orderId} className={result.outcome === "skipped" ? "text-amber-800" : "text-green-800"}>
                {result.outcome === "skipped" ? "Skipped" : `Repeated → ${result.draftRef}`}
                {result.reason ? ` — ${result.reason}` : ""}
              </li>
            ))}
```

`result` is on the banned list (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`). Rename to `row` or `runRow`. Violates: naming conventions.

### m6 — `RunResult` / `CandidateRow` / `SeasonRow` duplicate server types (type drift)
`app/(admin)/admin/repeat-bulk-picker.tsx` defines `CandidateRow` and `RunResult` mirroring `BulkHistoryRow` and `BulkItemResult` from `lib/repeat/bulk-history.ts` / `lib/orders/bulk.ts`; `app/(admin)/admin/seasons/season-manager.tsx` defines `SeasonRow` mirroring the seasons API response. All three could be `import type` from their lib modules (the page already serializes Date→ISO at the boundary). Same drift category as M4, lower severity because these are local to one page each.

### m7 — Magic `take: 500` in `listBulkHistoryCandidates`
`lib/repeat/bulk-history.ts`:

```63:64:arms/arm-06/workspace/lib/repeat/bulk-history.ts
    orderBy: [{ customer: { name: "asc" } }, { orderNumber: "asc" }],
    take: 500,
```

No named constant, no comment explaining why 500 (the picker is capped at `BULK_ACTION_LIMIT=100` per run, but the candidate list pulls 500). Either name it (`HISTORY_CANDIDATE_LIMIT`) or document the cap. Violates: magic values.

### m8 — `copiedSlug` regex assumes 2000–2099
`lib/seasons/manage.ts`:

```32:35:arms/arm-06/workspace/lib/seasons/manage.ts
function copiedSlug(sourceSlug: string, year: number): string {
  const base = sourceSlug.replace(/-20\d{2}$/, "");
  return `${base}-${year}`;
}
```

`-20\d{2}$` only strips a `20XX` suffix. A slug ending `-1999` or `-2101` keeps its year suffix and the new season's slug becomes `foo-1999-2027` / `foo-2101-2027`. The function is called once per copied product, so a stale suffix cascades through the copied catalog. Either match any 4-digit year (`/-\d{4}$/`) or strip by the source season's known year. Violates: magic values.

### m9 — `targetSeason` lookup is two sequential awaits where one query suffices
`app/(admin)/admin/products/[id]/page.tsx`:

```65:68:arms/arm-06/workspace/app/(admin)/admin/products/[id]/page.tsx
  const targetSeason =
    (await prisma.season.findFirst({ where: { status: "OPEN" } })) ??
    (await prisma.season.findFirst({ orderBy: { createdAt: "desc" } }));
```

Two round-trips for a single fallback. `prisma.season.findFirst({ where: { OR: [{ status: "OPEN" }, {}] }, orderBy: [{ status: "desc" }, { createdAt: "desc" }] })` (or a `CASE`-ordered query) gets it in one. Minor because it runs once per product-edit page load. Violates: pattern drift (the rest of the codebase uses single bounded queries for "open or latest" — e.g. `getOpenSeason`).

## Notes (not findings)

- The two staff repeat paths (one-click via `/api/admin/orders/bulk` action=`repeat`, and review via `/admin/orders/[id]/repeat`) are intentional per the plan; the one-click path uses `autoConfirmPlan` and the review path uses `applyConfirmations`. Both set `repeatedFromOrderId`, so the bulk-history idempotency check (`repeats` relation) treats them uniformly. Good.
- `lib/orders/drafts.ts` adds `repeatedFromOrderId` to `saveDraft` with patch semantics (only on create, not on replace) — consistent with the existing `guestTokenHash` pattern in the same function.
- `lib/audit.ts` extends `AuditAction` with the P10 members in lockstep with the comment discipline established for P8/P9. Good.
- `runSeasonFlip` correctly records a `CronRun` row on both OK and FAILED paths, matching the other crons (P7 nightly-print, P8 label-purge, etc.).
- `components/repeat/repeat-review.tsx` correctly reuses `Button`, `Card`, `apiFetch`, `formatCents` — no rogue styling or competing HTTP client.
- The `past-collections/page.tsx` change (`orders: { some: {} }`) is a one-line, well-commented filter that matches the docstring's "earns its archive slot by running" rule.
