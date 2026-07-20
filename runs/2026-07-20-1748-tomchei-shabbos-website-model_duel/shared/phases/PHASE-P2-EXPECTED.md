# Phase EXPECTED — P2

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine.

## Must be true when phase is done

1. [ ] Prisma schema: Season (open/closed + optional scheduled auto-flip), Product (dims, kinds, inventory flags), options with price adjustments, restricted add-ons, replacement links
2. [ ] Customer model with normalized phone/email dedupe + saved addresses with geocode fields
3. [ ] Order → OrderLine → add-ons tree with price snapshots, sequential per-season order numbers, draft reference numbers + wire format, cached payment status
4. [ ] **Package entity**: recipient/address/method/greeting grouping key; optional stages New → Printed → Packed → Sent/Picked-Up; package-level audit; fulfillment methods data-driven
5. [ ] Payments (stripe/cash/check/comp, posted/voided); Stripe PaymentIntent model; shipping quotes with expiring options; pickup locations; package types + shipment boxes
6. [ ] Unified versioned inventory (products + add-ons) with XOR target integrity constraints; geocode cache with TTLs; cron run log
7. [ ] BOM/ingredient + assembly-batch tables (schema only — no UI; UR-016 hidden at launch)
8. [ ] Order state machine + finalize + discard; concurrency via row-level locking / optimistic versioning on inventory and package mutations
9. [ ] Migration harness passes; seed creates season + catalog + customer + order
10. [ ] Unit tests: grouping key combines same recipient/address/method/greeting and splits differing greeting; state machine rejects illegal transitions; concurrent finalizations don't double-claim an order number
11. [ ] Race test: two checkouts for the last finished package (reserve engine) — only one commits

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Migrations + seed | `npx prisma migrate deploy` + seed → season, catalog, customer, order exist |
| S2 | Grouping engine | Unit test: same key merges; different greeting splits |
| S3 | State machine | Unit test: illegal transition rejected |
| S4 | Order numbers | Unit test: concurrent finalizations → unique sequential numbers |
| S5 | Inventory race | Unit/integration test: two concurrent reservations for last unit → one wins |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P2-SMOKE.md`

## Out of scope this phase

- Storefront UI, admin catalog UI, cart/checkout, POS, printing, shipping labels, routes/drivers, email campaigns
- Season management wizard, repeat orders, replacement mapping admin (P10)
- BOM/ingredient UI (schema only; managers enable later per UR-016)
