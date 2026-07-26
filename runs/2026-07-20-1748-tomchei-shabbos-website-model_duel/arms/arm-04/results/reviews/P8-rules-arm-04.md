# P8 Rules review — arm-04 (blind)

**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Tree:** `arms/arm-04/workspace/` (`src/lib/shipping/`, `src/lib/checkout/fees.ts`, `src/lib/checkout/checkout-summary.ts`, `src/lib/orders/order-service.ts`, `src/app/(admin)/admin/fulfillment/`, `src/app/(admin)/admin/settings/shipping/`, `src/components/admin/carriage-card.tsx`, `prisma/schema/fulfillment.prisma`, `prisma/migrations/20260727010000_p8_shipping_labels/`, `scripts/smoke-p8.ts`)
**Rules graded:** `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`
**Reviewer:** External, blind to model name. Findings only, no fixes.

## Summary

P8 is built cleanly and to spec. The five phase-expected items (Shippo wrapper, margin engine, bin packing, label create/void/track/validate, checkout live rates) are all present, audited, and covered by `smoke-p8.ts`. The ladder is applied honestly: `fetch` over the Shippo SDK with a one-line justification, `node:crypto` over a UUID dep, a volume/weight packer over a 3D solver. Audit rows exist for every P8 action; permission gates and season scoping are consistent with the rest of the app.

A handful of small clean-code nits: a defensive `??` for a state an upstream guard already excludes, a magic constant duplicated across three files, and a codegraph index that was never initialized so the deterministic-lookup guarantee the rule requires is absent.

## Findings

### M1 — Defensive `??` for an impossible state (clean-code: anti-AI-tics / no "just in case" code)

`src/lib/shipping/label-service.ts:132-133, 347`

```132:134:arms/arm-04/workspace/src/lib/shipping/label-service.ts
  const totals = {
    carrierCostCents: purchase.costCents,
    customerPriceCents: plan.customerPriceCents ?? purchase.costCents,
    marginCents: (plan.customerPriceCents ?? purchase.costCents) - purchase.costCents,
  };
```

`quoteFor` (line 326-331) already rejects any quote whose `source === 'FALLBACK'`, so by the time `plan` reaches `buyLabelForPackage` the quote is `LIVE` and `plan.customerPriceCents` is a number, never null. The `?? purchase.costCents` fallback is for a condition that cannot happen. Same pattern at line 347 in `claimParcels`:

```347:347:arms/arm-04/workspace/src/lib/shipping/label-service.ts
  const shares = allocateCustomerPrice(quote.customerPriceCents ?? purchase.costCents, quote.parcels.length);
```

`clean-code.mdc` bans "defensive code for conditions that can't happen" and "'just in case' code -- every line must have a reason." If the upstream guard ever relaxes, the `??` would silently bill the customer the carrier cost (margin = 0), which is the wrong failure mode — better to let the null throw.

### M2 — Grams-per-pound constant duplicated across three files (clean-code: magic values / duplicated logic)

The literal `453.59237` appears in:

- `src/lib/shipping/shippo-api.ts:30` — `const GRAMS_PER_POUND = 453.59237;`
- `src/lib/shipping/local-provider.ts` — not named, but the inverse conversion lives in `carriage-card.tsx`
- `src/components/admin/carriage-card.tsx:230-232`

```230:232:arms/arm-04/workspace/src/components/admin/carriage-card.tsx
function gramsToPounds(grams: number): string {
  return (grams / 453.59237).toFixed(1);
}
```

`clean-code.mdc` calls for "Magic values — named constants" and "Duplicated logic — pull into `lib/` helpers." The conversion belongs in one place (e.g. `lib/core/units.ts` or alongside `lib/core/money.ts`) and the three call sites should import it. Today a change to the constant would silently drift three displays apart.

### L1 — `codegraph` index never initialized (codegraph)

`arms/arm-04/workspace/.codegraph/` does not exist. `codegraph.mdc` hard rule: "Every session, before structural work: 1. Run `codegraph status`… 3. If `.codegraph/` missing and `codegraph` on PATH → `codegraph init` once, then use graph." P8 added nine new files under `src/lib/shipping/` plus a migration and a component — structural work — and the rule's deterministic-lookup guarantee (same query + same index = same result regardless of model) was not established for this arm.

If the `codegraph` CLI was not on PATH in the contestant environment this is moot (the rule allows Read/grep fallback "for this run only" after one init attempt). The artifact alone cannot prove CLI availability, so this is logged low rather than medium.

### L2 — Defensive `?? ''` for a state the `where` clause excludes (clean-code: anti-AI-tics)

`src/lib/shipping/label-service.ts:259`

```258:260:arms/arm-04/workspace/src/lib/shipping/label-service.ts
  for (const parcel of box.shipmentBoxes) {
    const update = await provider.track(parcel.carrier ?? '', parcel.trackingNumber ?? '');
```

The query at line 241 filters `trackingNumber: { not: null }`, so `parcel.trackingNumber` is guaranteed non-null inside the loop. The `?? ''` for trackingNumber is "just in case" code the rule bans. `parcel.carrier` is genuinely nullable in the schema, so its `?? ''` is real defense at a trust boundary and is fine.

## What was checked and clean

- **ponytail ladder:** `fetch` over Shippo SDK (`shippo-api.ts:18-25`), `node:crypto.randomBytes` over a UUID dep (`local-provider.ts:3,71,74`), volume/weight packer over a 3D solver (`bin-packing.ts:6-9`). All justified in one-line comments, no `ponytail:` shortcuts taken that need a ceiling note.
- **YAGNI:** `allocateCustomerPrice`, `combineParcelRates`, `VOID_PENDING`, `ShippingQuoteOption` all have real call sites driven by multi-parcel boxes or carrier refund latency — not speculative.
- **God files:** `label-service.ts` is 423 lines (under 500) with one concern (label lifecycle); `quote-service.ts` is 343. No split needed.
- **Naming:** No banned standalone names (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`). `box` is domain-meaningful for a `Package` row, not on the banned list.
- **Comments:** Explain "why" (carrier latency, trust boundary, snapshot reasoning), not "what". No narration, no change-explanation.
- **Error handling:** `shippo-api.ts` `call()` throws with status + payload; `voidLabel` distinguishes ERROR vs SUCCESS vs PENDING/QUEUED with a real sentence; `buyLabel` surfaces carrier messages. No swallowed errors.
- **Trust boundary:** `shippo-api.ts` Zod-parses every carrier response. `env-spec.ts` enforces loopback guard for `SHIPPING_PROVIDER=local` and requires `SHIPPO_API_TOKEN` for `shippo`. R-183/R-184 honored.
- **workflow audit:** `shipping.label_purchased`, `shipping.label_voided`, `shipping.label_failed`, `shipping.tracking_refreshed`, `shipping.address_validated` all declared in `audit.ts` and written from the service layer. Money rows carry no carrier transaction id (comment at `audit.ts:107-108`).
- **workflow gates:** `requirePermission('fulfillment.manage')` on buy/void/track/validate; `boardScopeWhere(seasonId)` on every query; smoke S3d confirms a driver is 403'd from the box screen.
- **workflow verify-in-app:** `smoke-p8.ts` exercises the real HTTP flow — quote → buy → double-buy refusal → track → validate → void → rebuy → sent-locks-void — plus unit-test citations and `npm run ci`.
- **workflow carrier-during-tx:** `order-service.ts:54-59` quotes shipping before opening the transaction so the carrier HTTP call doesn't hold the season's number-counter lock. Good awareness.
- **R-175 compensation:** `label-service.ts:103-114, 396-422` — on a later-parcel failure, already-bought labels (including the one whose row write failed) are voided at the carrier before the error is raised.
- **vocabulary:** No refactor/tidy/etc. commands in scope; the phase is an "add" and the code follows existing patterns (server actions, `Result<T>`, `boardScopeWhere`, `recordAudit`, `redirectWithFlash`).
- **Migration:** `20260727010000_p8_shipping_labels/migration.sql` backfills `updatedAt` from `createdAt` (not `now()`) and stamps pre-existing rows as `PURCHASED`/`VOIDED` rather than `PENDING`. Honest about history.

## Severity counts

- **High:** 0
- **Medium:** 2 (M1, M2)
- **Low:** 2 (L1, L2)
- **Total:** 4
