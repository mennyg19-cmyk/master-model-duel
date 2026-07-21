# Smoke checklist — run `2026-07-20-1748-tomchei-shabbos-website-model_duel`

Ports: arm-01 web **3101** db **4101** | arm-02 web **3102** db **4102**

## P2

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Migrate + seed | ✓ | ✓ (build) |
| S2 | Grouping engine tests | ✓ | ✓ (build) |
| S3 | State machine tests | ✓ | ✓ (build) |
| S4 | Concurrent order numbers | ✓ | ✓ (build) |
| S5 | Inventory race | ✓ | ✓ |

See `shared/phases/PHASE-P2-EXPECTED.md`. Both arms P2 **gated**.

## P3

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Storefront UX | ✓ | ✓ |
| S2 | Season gate | ✓ | ✓ |
| S3 | Newsletter round-trip | ✓ | ✓ |
| S4 | Media + catalog | ✓ | ✓ |
| S5 | Delivery ZIP | ✓ | ✓ |

See `shared/phases/PHASE-P3-EXPECTED.md`. Both arms P3 **gated**.

## P4

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Three-way assignment | ✓ | ✓ |
| S2 | Draft persistence | ✓ | ✓ |
| S3 | Address edit audit | ✓ | ✓ |

See `shared/phases/PHASE-P4-EXPECTED.md`. Both arms P4 **gated**.

## P5

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Stripe web checkout | ✓ | ✓ |
| S2 | Delivery fees + zip block | ✓ | ✓ |
| S3 | Stale price/stock | ✓ | ✓ |
| S4 | POS cash/check | ✓ | ✓ |
| S5 | Order lifecycle | ✓ | ✓ |

See `shared/phases/PHASE-P5-EXPECTED.md`. Both arms P5 **gated**.

## P6

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Ops hub | ✓ | ✓ |
| S2 | POS | ✓ | ✓ |
| S3 | Import | ✓ | ✓ |
| S4 | Scale | ✓ | ✓ |

See `shared/phases/PHASE-P6-EXPECTED.md`. Both arms P6 **gated**.

## P7

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Package split/group | ✓ | ✓ |
| S2 | Print vs status | ✓ | ✓ |
| S3 | Batch idempotency | ✓ | ✓ |

See `shared/phases/PHASE-P7-EXPECTED.md`. Both arms P7 **gated**.

## P8

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Margin math | ✓ | ✓ |
| S2 | Void + rebuy | ✓ | ✓ |
| S3 | Unshipped label guard | ✓ | ✓ |

See `shared/phases/PHASE-P8-EXPECTED.md`. Both arms P8 **gated**.

## P9

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Driver magic link | ✓ | ✓ |
| S2 | Maps + print fallback | ✓ | ✓ |
| S3 | Method switch + reroute | ✓ | ✓ |
| S4 | Bulk + day-of notify | ✓ | ✓ |
| S5 | Pickup + crons | ✓ | ✓ |

See `shared/phases/PHASE-P9-EXPECTED.md`. Both arms P9 **gated**.

## P10

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Repeat + replacement | ✓ | ✓ |
| S2 | Bulk repeat + auto-flip | ✓ | ✓ |
| S3 | Imported prior-year repeat | ✓ | ✓ |

See `shared/phases/PHASE-P10-EXPECTED.md`. Both arms P10 **gated**.

## P11

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Preferences + tokens | ✓ | ✓ |
| S2 | Campaign flow | ✓ | ✓ |
| S3 | Transactional + failure | ✓ | ✓ |
| S4 | Cron auth + overlap | ✓ | ✓ |
| S5 | Purge + test mode | ✓ | ✓ |

See `shared/phases/PHASE-P11-EXPECTED.md`. Both arms P11 **gated**.

## P12

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Reports + margin | ✓ | |
| S2 | Exports + reconciliation | ✓ | |
| S3 | Legacy import | ✓ | |
| S4 | Imported repeat | ✓ | |
| S5 | Dress rehearsal | ✓ | |

See `shared/phases/PHASE-P12-EXPECTED.md`. arm-01 P12 **gated** — Test 4 complete for arm-01.
