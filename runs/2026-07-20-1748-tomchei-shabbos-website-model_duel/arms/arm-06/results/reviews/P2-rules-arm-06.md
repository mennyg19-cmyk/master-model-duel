# P2 Rules Review — arm-06 (blind)

- Scope: `arms/arm-06/workspace/` — Test 4 / P2 (domain core: schema, orders, packages, inventory, payments, fulfillment).
- Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph (per `arms/arm-06/.cursor/rules/`).
- Findings only — no fixes. Severity bands: Blocker / Major / Minor.
- Method: full read of new P2 files (`lib/customers/dedupe.ts`, `lib/inventory/reserve.ts`, `lib/orders/{create-draft,numbers,state-machine}.ts`, `lib/packages/{grouping,stages}.ts`, `lib/payments/post.ts`, `lib/phone.ts`, `lib/seasons.ts`, `prisma/schema.prisma`, `prisma/migrations/20260728164419_domain_core/migration.sql`); call-site evidence via `codegraph callers` after `codegraph sync`; README § Patterns; `.scratch/PHASE-P2-STATUS.md`; test scripts in `scripts/`.

## Summary

| Band | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 4 |

## Adherence notes (what held)

- **clean-code structure / naming / comments:** New files are small, single-concern, well-named (`findOrCreateCustomer`, `reserveStock`/`releaseStock`, `createDraftOrder`, `claimOrderNumber`/`claimDraftRef`, `finalizeOrder`/`discardOrder`, `postPayment`/`voidPayment`, `advancePackageStage`, `buildGroupingKey`/`groupPackageInputs`, `normalizePhone`, `getOpenSeason`, `recomputePaymentStatus`). Booleans read as yes/no (`canTransition`, `canAdvanceStage`). Comments explain non-obvious intent only (R-ref tags, concurrency notes, XOR integrity) — no narration, no docblocks restating signatures.
- **clean-code dependency discipline:** No new packages added in P2; `package.json` pins stay exact (no floating ranges). No convenience packages.
- **clean-code consistency (data model):** Money in cents everywhere (`*Cents`), optimistic `version` column reused from P1 on `Order`/`Package`/`InventoryItem`, sequential counters on `Season` for order numbers + draft refs. XOR integrity on `inventory_items` enforced by a hand-added CHECK in the migration (verified), not just app code.
- **workflow gate discipline:** `.scratch/PHASE-P2-STATUS.md` walks the EXPECTED items with evidence; `.scratch/PHASE-P2-SMOKE.md` present; `.scratch/run-state.md` updated; unit + race tests wired into `npm run ci`.
- **codegraph:** P1 Major 2 (no index) is resolved — `.codegraph/codegraph.db` exists and `codegraph status` is healthy (58 files · 420 nodes). Index was stale relative to the 19 new P2 files until a `sync`, but the index itself is present and maintained.
- **vocabulary:** No refactor/rebuild/aggressive-refactor commands were in scope for P2 (greenfield domain build), so the vocabulary triggers that mandate `codegraph_impact` first were not activated.
- **ponytail chat/code anti-slop:** Code identifiers and error strings stay exact; status doc prose is direct.

## Findings

### Major 1 — Dead domain functions with zero callers, against the README's own commitment (ponytail Rule of 2 + clean-code "no just-in-case" + anti-hallucination)

Four P2 domain functions ship with **no callers and no test exercise** (verified via `codegraph callers` after `codegraph sync`, and `rg` over the tree):

- `lib/seasons.ts` — `getOpenSeason` (zero callers)
- `lib/payments/post.ts` — `postPayment` (zero callers), `voidPayment` (zero callers)
- `lib/packages/stages.ts` — `advancePackageStage` (zero callers)

`README.md:48` explicitly states: "`lib/` holds only modules with live callers. Money/id/phone/date helpers land with the phase that first uses them (P2+), not before." P2 is the phase that *introduces* these concerns, yet the payment and stage-advance entry points have no consumer — not even a test. The unit scripts (`scripts/test-*.mts`) cover grouping, state-machine, order-numbers, inventory-race, permissions — none cover payments, stage advance, or `getOpenSeason`.

`ponytail.mdc`: "Rule of 2: needs 2+ real call sites right now. Not 'might be useful later.'" and "No boilerplate 'for later.'" `clean-code.mdc`: "No 'just in case' code — every line must have a reason." `clean-code.mdc` Anti-Hallucination: "Do not claim 'fixed/passed/working' without tool output or running-app evidence." `PHASE-P2-STATUS.md` rows 5 and 8 mark payments and stage advance as **DONE** with the only evidence being the lib file itself — no runtime evidence exists.

(The engine-phase defense is real for functions exercised by tests/seed — `createDraftOrder`, `finalizeOrder`, `reserveStock`, `groupPackageInputs` all have at least one test or seed caller. The four listed above have neither.)

Cited rule: `ponytail.mdc` (Rule of 2, "no boilerplate for later"), `clean-code.mdc` (Anti-AI-Tics, Anti-Hallucination), README § Patterns line 48.

### Major 2 — Inconsistent error-handling in the `lib/` engine (clean-code consistency)

Within the new P2 domain code, some domain failures raise typed error classes (so callers can `instanceof`-branch) and others raise plain `Error`:

- Typed: `InsufficientStockError` (`lib/inventory/reserve.ts`), `IllegalTransitionError` (`lib/orders/state-machine.ts`), `IllegalStageTransitionError` + `PackageConcurrencyError` (`lib/packages/stages.ts`).
- Plain `Error`: `throw new Error("Season not found: …")`, `throw new Error("Season … is closed")` (`create-draft.ts`); `throw new Error("Inventory item not found: …")`, `throw new Error("qty must be positive")` (`reserve.ts`); `throw new Error("Order not found: …")` (`state-machine.ts`); `throw new Error("amountCents must be positive")`, `throw new Error("Payment not found or already voided: …")` (`post.ts`); `throw new Error("Package not found: …")` (`stages.ts`).

`clean-code.mdc` Consistency: "One error-handling approach per project." The README § Patterns table declares an error pattern only for API routes (inline `NextResponse.json({ error }, { status })`); there is no declared pattern for the domain engine, and the engine itself mixes two approaches. A caller that wants to distinguish "not found" from "illegal transition" can `instanceof` the latter but not the former.

Cited rule: `clean-code.mdc` (Consistency — one error-handling approach per project; Error Handling).

### Major 3 — Misleading error message in `finalizeOrder` race loser (clean-code error handling)

`lib/orders/state-machine.ts:47-49`: when the conditional `updateMany` returns `count === 0` (a concurrent finalizer won the race), the code throws `new IllegalTransitionError("FINALIZED", "FINALIZED")`, whose message renders as "Illegal order transition: FINALIZED → FINALIZED". The real condition is "another transaction already moved this order out of DRAFT" — the message names the wrong from-state and the wrong transition, so a caller reading the error is misled about what happened.

`clean-code.mdc` Error Handling: "Error messages say what went wrong AND what the expected state was." A dedicated `OrderConcurrencyError` (mirroring `PackageConcurrencyError` in `stages.ts`) or a message that names the race would satisfy this; the current reuse of `IllegalTransitionError` does not.

Cited rule: `clean-code.mdc` (Error Handling), and inconsistent with `PackageConcurrencyError` in the same phase.

### Minor 1 — `lib/season.ts` (singular) vs `lib/seasons.ts` (plural): split domain concern (clean-code consistency + naming)

Two files cover the same domain concern under confusingly similar names: `lib/season.ts` (`getSeasonYear`, used by seed) and `lib/seasons.ts` (`getOpenSeason`, zero callers — see Major 1). `clean-code.mdc` Abstraction Discipline: "Split files by concern, not by line count." The season concern is split across a singular and a plural file with no stated reason, and a reader has to check both to know where the season helpers live. (If `getOpenSeason` is dropped per Major 1, the plural file goes away and the issue resolves.)

Cited rule: `clean-code.mdc` (Consistency, Abstraction Discipline — split by concern).

### Minor 2 — Redundant `as <Model>` non-null assertions after `findUnique` (clean-code anti-AI-tics)

Three P2 functions call `findUnique`, then immediately assert the result non-null with `as`:

- `lib/orders/state-machine.ts:50-51` — `const finalized = await tx.order.findUnique({ where: { id: orderId } }); return finalized as Order;`
- `lib/payments/post.ts:37-39` — `const payment = await tx.payment.findUnique({ where: { id: paymentId } }); … (payment as Payment).orderId … return payment as Payment;`
- `lib/packages/stages.ts:74-75` — `const reloaded = await tx.package.findUnique({ where: { id: input.packageId } }); return reloaded as Package;`

`clean-code.mdc` Anti-AI-Tics: "No redundant type assertions the compiler already guarantees." `findUnique` returns `T | null`; the `as T` assertion does not narrow `null` — it silences the compiler without a runtime check. In each case a prior `updateMany`/guard has effectively proven the row exists, so a `!` or a null check + throw would be honest; the bare `as` hides the (tiny) null possibility from the type system.

Cited rule: `clean-code.mdc` (Anti-AI-Tics — redundant type assertions).

### Minor 3 — Nested ternary in `recomputePaymentStatus` (clean-code readability)

`lib/payments/post.ts:54-55` computes `PaymentStatus` in a single three-level nested ternary:

```ts
const status: PaymentStatus =
  paidCents <= 0 ? "UNPAID" : paidCents < order.totalCents ? "PARTIAL" : paidCents === order.totalCents ? "PAID" : "OVERPAID";
```

`clean-code.mdc` Anti-AI-Tics: "If a function has more than 3 levels of nesting, refactor it." This is three levels of conditional on one line; a small `if` chain or a helper would read more clearly and keep the OVERPAID branch visible.

Cited rule: `clean-code.mdc` (Anti-AI-Tics — nesting / over-verbose one-liners).

### Minor 4 — Undocumented "MM-" magic prefix in `formatWireFormat` (clean-code magic values)

`lib/orders/numbers.ts:8-10` builds the wire format as `MM-${seasonName}-${NNNN}`. The "MM-" prefix is a magic string with no constant and no comment explaining what "MM" denotes (likely "Mishloach Manot" given the Purim domain, but a reader cannot tell from the code). `clean-code.mdc` Abstraction Discipline lists "magic values" as a refactor category; `ponytail.mdc` allows one-line comments for non-obvious intent. A named constant (`WIRE_FORMAT_PREFIX`) or a one-line comment would fix the readability without violating Rule of 2.

Cited rule: `clean-code.mdc` (Abstraction Discipline — magic values), `ponytail.mdc` (comments for non-obvious intent).

## Out of scope / not graded

- Storefront/admin UI for orders, packages, payments — explicitly out of P2 (merge boundary per `PHASE-P2-STATUS.md`); their absence is correct.
- Geocoder job and cron runner — schema + table only by design (UR-016 / R-163), documented as deferred; not a rule violation.
- BOM / ingredient / assembly-batch UI — schema-only by design per UR-016/G-009.
- Live Clerk integration — already an allowed P1 deviation, carried forward.
