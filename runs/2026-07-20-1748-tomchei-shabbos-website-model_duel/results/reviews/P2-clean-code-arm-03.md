# Reviewer specialist — Clean-code

**Arm:** `arm-03`
**Tree / phase:** P2 (Domain core: seasons, catalog, packages, payments, shipping schema, inventory engine)
**Output:** `results/reviews/P2-clean-code-arm-03.md`
**Rules:** `arms/arm-03/rules/clean-code.md`

Scope: `src/lib/orders/*`, `src/lib/inventory/reserve.ts`, `src/lib/customers.ts`, `src/lib/{result,normalize,phone,constants}.ts`, `prisma/schema.prisma`, `scripts/{seed,domain-p2.test}.ts`.

## Findings

### F1 — Duplicated error-extraction pattern vs existing `maskError`
`error instanceof Error ? error.message : String(error)` is inlined 4× — `finalize.ts:70`, `finalize.ts:110`, `finalize.ts:150`, `reserve.ts:65` — while `result.ts:16` already exports `maskError()` for this exact purpose. Two competing error-message approaches in one project, and the inline copies skip `maskError`'s production guard so raw exception text leaks in prod. Extract `errorToMessage(error)` (or reuse `maskError`) and call it from all four sites.

### F2 — `discardDraft` near-duplicates `transitionOrder`
`finalize.ts:76` (`discardDraft`) and `finalize.ts:116` (`transitionOrder`) share the findUnique → `assertOrderTransition` → version-guarded update → audit-log shape; `discardDraft` differs only by setting `discardedAt` and the `ORDER_DISCARDED` action. Route discard through `transitionOrder` (extend it to accept optional timestamp fields) or extract a shared `mutateOrderStatus(tx, order, to, patch, auditAction)` helper.

### F3 — Banned standalone name `item`
`reserve.ts:37`, `:54`, `:59`, `:78` use `item` as a standalone identifier (`const item = await …`, `availableUnits(item)`). `item` is on the naming-rule ban list. Rename to `inventoryItem` (or `inventoryItemRecord` for the row).

### F4 — Inconsistent error-handling approach across domain lib
`finalize.ts` and `reserve.ts` wrap every DB op in `try { … } catch { return err(...) }`. `customers.ts:6` returns `err(...)` for business failures but lets Prisma exceptions propagate raw — no try/catch around the `findUnique`/`update`/`create` calls. One project, two error strategies. Pick one (wrap-everything → Result, or let exceptions propagate) and apply it to `customers.ts` too.

### F5 — Inconsistent internal error-message style
`customers.ts:45` passes `"email belongs to staff"` (lowercase, no punctuation) as the internal `error` string, while every other internal message in `finalize.ts`/`reserve.ts` is a full sentence ("Order … not found", "Inventory reserve failed for …"). Internal error strings are grep-able contract surface — follow one convention.

### F6 — `state-machine.ts` and `package-stages.ts` are verbatim pattern clones
`orders/state-machine.ts` and `orders/package-stages.ts` have identical structure: `ALLOWED: Record<Enum, ReadonlySet<Enum>>` + `canTransition` + `assert…` with the same `Illegal … → …. Expected one of:` template. Two real call sites now — a `makeStateMachine<T>(allowed, label)` factory would remove the clone. (Borderline under the "leave stable dupes" rule, but the bodies are byte-for-byte parallel, not just similar.)

### F7 — Narration doc comment restates the function name
`grouping.ts:20` — `/** Stable key: recipient + address + fulfillment method + greeting. */` literally restates what `buildGroupingKey` does. Per the comment rule, if a comment only explains WHAT the code does, rewrite the code or drop it. The function name + `GroupingInput` type already convey this; drop the comment or promote it to a contract note (e.g. the XOR-style normalization rules).

### F8 — `groupLinesByKey` reinvents `Map` grouping
`grouping.ts:36` builds a `Map<string, T[]>` with manual get/push/set. The same `reduce`-into-`Map` (or a `groupBy` helper in `lib/`) is a single expression. Minor, but it's the kind of copy-paste pattern the anti-AI-tics rule flags. If a `groupBy` helper exists elsewhere in the project, reuse it; otherwise leave (Rule of 2 not met yet).

### F9 — `domain-p2.test.ts` uses banned standalone `results`
`domain-p2.test.ts:111`/`:112`/`:161`/`:162` split into `results` / `successes` / `failures` / `winners` / `losers`. `results` (plural of banned `result`) as a standalone collection name is borderline; `successes`/`failures` already describe the same partition twice. Rename `results` → `finalizeResults` / `reserveResults` for grepability.

### F10 — `maskError` dev/prod divergence is a latent inconsistency
`result.ts:16` returns a generic message in production but raw `error.message` in dev; the inline duplicates in `finalize.ts`/`reserve.ts` (F1) always return raw. So P2 domain code leaks raw exception text in prod while API routes mask it. Not a clean-code style issue alone — it's the consistency consequence of F1. Resolving F1 resolves this.

## Summary

10 findings. Severity counts:

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 (F1, F2) |
| Low | 6 (F3, F4, F5, F6, F7, F9) |
| Info | 2 (F8, F10) |

Strongest: F1 (duplicated error extraction + prod leak), F2 (`discardDraft`/`transitionOrder` clone), F3 (banned name `item`). F4/F5 are the same root cause (one error strategy per project). F10 is a downstream symptom of F1.
