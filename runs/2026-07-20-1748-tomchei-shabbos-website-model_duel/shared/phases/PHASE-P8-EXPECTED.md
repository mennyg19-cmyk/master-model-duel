# Phase EXPECTED — P8

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P8 — Shipping: Shippo, rate margin, labels.

## Must be true when phase is done

1. [ ] Shippo wrapper (rate/buy/void/track/validate — R-173) with org FedEx + UPS accounts; typed optional-provider env handling (R-183, R-184)
2. [ ] **Margin engine** (UR-003, G-006): quote eligible carriers (+USPS where applicable), charge customer the highest quoted rate, buy label on the cheaper eligible carrier, record spread for reconciliation
3. [ ] Bin packing + shipment planning against package types/boxes (R-081)
4. [ ] Label create/void from order detail and package board (R-055); label-failure compensation (R-175); tracking refresh (R-176); Shippo address validation (R-177)
5. [ ] Checkout shipping rates use live Shippo quotes (replace P5 placeholder path where applicable)

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Margin math | Shippo fixtures where carriers differ: customer charge = highest quote, purchased label = cheaper eligible quote, stored margin exact |
| S2 | Void + rebuy | Void a label and buy again; checkout rate-resolution honors live quotes |
| S3 | Unshipped label guard | Printed-but-unshipped label remains voidable before route assignment (P9 hook stub acceptable) |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P8-SMOKE.md`

## Out of scope this phase

- Delivery routes, driver magic links, map reroute (P9)
- Pickup / bulk delivery scheduling (P9)
- Email/SMS notifications (P11)
- Margin reconciliation reporting UI (P12)
