# P2 fix notes — arm-01

Date: 2026-07-20  
Pass: single P2 fix pass

## Fixed

- **A1/A3/A9:** Replaced in-memory order-number and inventory-race tests with
  tests against `finalizeOrder` and `reserveInventory` using two Prisma clients.
  Added database coverage for draft discard, package stage version conflicts,
  and package audit creation. Removed both production-only stub classes.
- **A4:** Enforced one package per `(orderId, groupingKey)` in Prisma and the
  database.
- **A2:** Added database CHECK constraints for order totals, payments, Stripe
  intents, and shipping quotes.
- **A6:** Deleted four unreferenced `lib/` modules and the unused
  `normalizePhone` export.

## Verified without change

- **A5:** The aggregate review swapped the two models. `StaffUser.clerkUserId`
  is nullable in both schema and migration; `CustomerAccount.clerkUserId` is
  required in both. There is no drift to fix.

## Deferred

- **A7** and lower-priority consistency findings were not changed in this
  single pass.

## Verification

- `npx prisma migrate deploy`: pass
- `npm run db:seed`: pass
- S1-S5: pass
- `npm test`: 13/13 pass
- `npm run lint`: pass
- `npm run typecheck`: pass
