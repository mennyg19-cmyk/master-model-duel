# P2 Security Review — arm-03

**Phase:** P2 — Domain schema + engines (seasons, catalog, customers, orders, packages, payments, shipping, inventory)
**Scope:** `prisma/schema.prisma`, `prisma/migrations/20260721174000_p2_domain/`, `src/lib/orders/*`, `src/lib/inventory/reserve.ts`, `src/lib/customers.ts`, `src/lib/normalize.ts`, `src/lib/phone.ts`, `scripts/seed.ts`, `scripts/domain-p2.test.ts`
**Evidence:** `arms/arm-03/workspace/.scratch/PHASE-P2-SMOKE.md` (S1–S5 PASS), `shared/phases/PHASE-P2-EXPECTED.md`

## Summary

- **Medium** — No DB-level CHECK constraints for non-negative money/quantities/counts (`onHand`, `reserved`, `quantity`, `basePriceCents`, `amountCents`, `priceAdjustmentCents`, `priceCents`, `nextOrderNumber`, `weightOz`, `maxWeightOz`). Integrity rests solely on app code; any bypass (admin SQL, import, future bug) can create negative stock or negative money. Only the `InventoryItem_target_xor` CHECK exists.
- **Medium** — Domain engines (`finalizeOrder`, `discardDraft`, `transitionOrder`, `reserveInventory`) perform no authorization or ownership checks and trust caller-supplied `actorId` for the audit trail; any route that wires these without an authz gate creates IDOR / forged-actor audit. Acceptable for P2 (API layer out of scope) but must be enforced before any caller ships.
- **Low** — `finalizeOrder` claims the order number (`SELECT … FOR UPDATE` on Season) *before* the optimistic order update; if the optimistic update fails (concurrent discard/transition), the claimed number is burned → permanent gaps in the per-season sequence. Claim should happen after the CAS succeeds, or be rolled back on CAS failure.
- **Low** — No engine releases reserved inventory on `CANCELLED`/`DISCARDED`. `transitionOrder` happily moves PLACED→CANCELLED while reserved units stay pinned → inventory leak / denial-of-inventory until manual correction.
- **Low** — `StripePaymentIntent.clientSecret` stored as a plaintext column. The client secret is client-facing but persisting it long-term expands credential exposure; store the PI id + status only and re-fetch the secret on demand.
- **Low** — `groupingKey` is a denormalized, indexed, lowercase concatenation of recipient + full address + greeting, duplicated on `OrderLine` and `Package` (both indexed). This enlarges the PII surface and complicates redaction/erasure; consider hashing or storing the key without rebuilding it from raw PII on read.
- **Low** — `normalizeEmail` only `trim().toLowerCase()` — no format validation, no dots/plus-addressing folding. Dedupe is weak: `a@x.com` / `a.b@x.com` / `a+tag@x.com` create distinct customers, defeating the emailNorm unique intent.
- **Info** — `draftRef` suffix is 8 chars and entropy depends entirely on the caller-supplied `uniqueSuffix` (`formatDraftRef` slices the last 8 alphanumerics). If a future caller passes a low-entropy value, draft refs become enumerable; draftRef is the unique draft handle.
- **Info** — `Customer.email` unique is case-sensitive while `emailNorm` unique is case-insensitive. The pair works (emailNorm catches case variants) but the raw `email` unique is misleading and could mask duplicates that only emailNorm catches; consider dropping the raw `email` unique.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 5 |
| Info | 2 |
| **Total** | **9** |

## What is solid

- Inventory reserve uses a single atomic `UPDATE … WHERE (onHand - reserved) >= qty` with parameterized `$executeRaw` (no injection) and a rows-affected guard — correct atomic decrement without a separate read/lock window.
- `finalizeOrder`/`discardDraft` use optimistic versioning (`where: { id, version, status: DRAFT }`) on the order mutation.
- `InventoryItem` XOR CHECK enforces exactly one of `productId`/`addOnId` at the DB level.
- State-machine + package-stage transitions are pure functions with explicit allow-lists and throw on illegal transitions; tests cover illegal `PLACED → DRAFT` and the concurrent-finalize / last-unit race.
- `linkOrCreateCustomer` rejects email collisions with `StaffUser` to keep customers out of the staff table.

## Out of scope (not scored)

- Storefront/cart/checkout routes, admin catalog UI, POS, printing, shipping labels — no P2 API routes exist yet, so engine-level authz gaps are noted, not penalized.
- BOM/ingredient/assembly tables are schema-only per UR-016; no review of business logic.
