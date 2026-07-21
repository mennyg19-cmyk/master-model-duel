# P2 Rules Review — arm-03

Phase: P2 (Domain core: seasons, catalog schema, packages, payments, shipping schema, inventory engine)
Arm rules: ponytail, clean-code, workflow, vocabulary, codegraph
Scope: `arms/arm-03/workspace/` source for P2 (schema, `src/lib/orders/*`, `src/lib/inventory/reserve.ts`, `scripts/domain-p2.test.ts`, `scripts/seed.ts`).
Findings only. No model names.

## Critical

1. **XOR integrity lives only in raw migration SQL, not in `schema.prisma`.** `migration.sql:687` adds `InventoryItem_target_xor_check` (`CHECK` exactly-one of productId/addOnId), but `schema.prisma:587-601` declares the two nullable `@unique` fields with no annotation of the XOR rule. Prisma cannot re-apply a hand-written CHECK; `prisma migrate dev` / `db push` will silently drop it. clean-code § type/schema drift (single source of truth) + workflow § Security Basics. The constraint that EXPECTED #6 calls "XOR target integrity" is enforced by SQL the ORM does not model — app code can submit a both-set or both-null row and only the DB catches it as a raw 500.

2. **`finalizeOrder` claims the order number before the version-guarded order update.** `finalize.ts:46` calls `claimNextOrderNumber` (which `SELECT ... FOR UPDATE` then `UPDATE Season.nextOrderNumber = current+1`) and only then runs `order.update({ where: { version: order.version, status: DRAFT } })` at `:48`. Two concurrent finalizes of the **same** draft both pass `assertOrderTransition`, both serialize on the Season lock, and the loser's order-update throws P2027 — the whole transaction rolls back, so no number is burned. But the **winner** is whichever reads `order.version` first; the loser's number claim is undone, so the gap risk is contained. The real defect: the test (`domain-p2.test.ts:55-134`) finalizes **8 distinct drafts**, never two finalizes of the same order, so S4 ("concurrent finalizations → unique sequential numbers") is not actually exercised under contention — the version-guard branch is untested. workflow § Verification (tiered) expects the expectation item probed; the smoke passes without it.

## Major

3. **Three near-identical order-mutation functions duplicate the find → assert → version-guard → audit pattern.** `finalizeOrder` (`finalize.ts:34`), `discardDraft` (`:76`), and `transitionOrder` (`:116`) each re-fetch the order, call `assertOrderTransition`, `order.update({ where: { id, version } })`, then `auditLog.create`. Rule of 2 is met (3 call sites). clean-code § duplicated logic — extract one `mutateOrder(orderId, to, actorId, extraData, auditAction)` helper.

4. **`Customer.email` and `Customer.emailNorm` are both `@unique`.** `schema.prisma:140-141`. `email` stores original case, `emailNorm` the lowercased dedupe key. Postgres unique is case-sensitive, so `email` treats `Foo@x.com` and `foo@x.com` as distinct while `emailNorm` rejects the second — the weaker `email` unique can surface a confusing P2002 before the dedupe key does. Two sources of truth for "one customer per mailbox." clean-code § inconsistent patterns / type drift. Drop the `email` unique; keep `emailNorm` as the dedupe gate.

5. **`Season` carries two undifferentiated datetime pairs.** `opensAt`/`closesAt` and `scheduledOpenAt`/`scheduledCloseAt` (`schema.prisma:205-208`) with no comment explaining the split. EXPECTED #1 says "open/closed + optional scheduled auto-flip" — the relationship between actual and scheduled windows is non-obvious and undocumented. clean-code § comments (non-obvious intent) + magic values.

6. **Speculative P2 helpers shipped with no product call site.** `assertPackageTransition`/`canTransitionPackage` (`package-stages.ts`), `parseDraftRef` (`draft-wire.ts:8`), `reserveInventoryWithClient` (`reserve.ts:71`), `availableUnits` (`reserve.ts:78`), and the `AuditAction.PACKAGE_STAGE_CHANGED` enum value (`schema.prisma:37`) all have no P2 caller. Package-stage mutation is P7 scope per `phase-map.md`; shipping the state machine now is "boilerplate for later." ponytail § YAGNI / Rule of 2; clean-code § Anti-AI-Tics ("just in case" code).

## Minor

7. **`StripePaymentIntent.status` is `String`, not an enum.** `schema.prisma:517`. Stripe statuses are a closed set (`requires_payment_method`, `succeeded`, `canceled`, …). Raw string loses type safety and drifts from the source. clean-code § type/schema drift.

8. **`ShippingQuote.options` is untyped `Json`.** `schema.prisma:532`. No zod schema or TS type guards the rate-option shape. P2 is schema-only here, but the opaque blob invites drift in P8. clean-code § type/schema drift.

9. **`Payment.postedAt` and `Payment.createdAt` both default to `now()` and are identical on creation.** `schema.prisma:500-502`. Redundant timestamp; `voidedAt` already marks the void event. clean-code § dead/over-verbose.

10. **`claimNextOrderNumber` does `SELECT FOR UPDATE` then a separate `UPDATE`.** `finalize.ts:17-30`. A single `UPDATE "Season" SET "nextOrderNumber" = "nextOrderNumber" + 1 WHERE id = ? RETURNING "nextOrderNumber"` is one round trip and self-serializes. Nit-level efficiency, but it is the hot path of S4.

11. **`domain-p2.test.ts` is a script, not a framework test.** Uses `node:assert/strict` run via `tsx` (`package.json:18`). Same pattern as `permissions.test.ts` (flagged in P1). clean-code § "one test framework per project — there is none declared." Still unresolved in P2.

12. **`testInventoryRace` mutates shared seed state.** `domain-p2.test.ts:141-154` resets the seeded FAMILY-BOX inventory to `onHand=1` and leaves it there; later runs or later phases inherit corrupted stock. Test-hygiene smell; workflow § Dev Server Hygiene adjacent.

13. **`InventoryItem` XOR has no app-level guard.** Prisma client will happily submit a both-null or both-set row; only the raw CHECK rejects it as a 500. A zod/TS guard at the create boundary would surface the mistake earlier. clean-code § Error Handling (fail with expected state, not a DB 500).

## Summary

- Critical: 2
- Major: 4
- Minor: 7
- Total: 13
