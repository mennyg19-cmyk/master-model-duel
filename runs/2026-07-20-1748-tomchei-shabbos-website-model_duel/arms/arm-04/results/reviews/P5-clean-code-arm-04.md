# P5 Clean-Code Review — arm-04 (blind)

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Scope: P5 delta — checkout, delivery fees, hosted Stripe, webhook, POS, order lifecycle.
Reviewer: external clean-code specialist (blind). Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 4 |
| Minor | 9 |

## Major

### M1. Line-total formula duplicated across four call sites
`src/lib/checkout/checkout-summary.ts:243` (`lineTotal`), `src/lib/orders/order-service.ts:373` (inline in `chargeFulfillment`), `src/lib/orders/customer-orders.ts:126` (inline in `readOrderDetail`), `src/lib/orders/customer-orders.ts:144` (inline in `toSummary`)

All four compute `line.lineTotalCents + sumCents(line.addOns.map((addOn) => addOn.lineTotalCents))`. Rule of 2 met four times over. A `lineTotalWithAddOns(line)` helper in `lib/orders` would unify them; the checkout-summary copy even names the function `lineTotal`, the same word the customer-orders module uses for the concept, but they live in different files.

### M2. Fulfillment-method fetch + FeeSubject build duplicated
`src/lib/checkout/checkout-summary.ts:148` (`feeSubjects`), `src/lib/orders/order-service.ts:366` (`chargeFulfillment`)

Both collect method ids → `db.fulfillmentMethod.findMany` with the same select (`id, label, kind, feeBasis, baseFeeCents`) → build `Map<id, method>` → map packages to `FeeSubject[]` carrying `key`, `method`, and `destinationKey: deliveryDestinationKey(...)`. Same query, same select, same map-build, same subject assembly. Only the `key` differs (`groupingKey` vs `row.id`). The "method missing" throw is also duplicated: `methodOf` at `order-service.ts:401` and the inline `if (!method) throw` at `checkout-summary.ts:159`. A `feeSubjectsFrom(packages, keyOf)` helper would carry both.

### M3. `INVALID_GREETING` returned for delivery-day and recipient errors
`src/lib/checkout/greetings.ts:94`, `:98`

`setRecipientDeliveryDay` returns `INVALID_GREETING` when the day is not on the manager's list, and `GREETING_NOT_ALLOWED` when the recipient is not on the order. Both codes are greeting-named but the function handles delivery days too. A caller switching on `code` cannot tell whether the greeting or the day was wrong without parsing the message. The codes mislead; either rename to a neutral `INVALID_CHECKOUT_INPUT` or split delivery-day codes from greeting codes.

### M4. Destination-field list and adapter built twice
`src/lib/checkout/greetings.ts:148` (`LineDestination` type + `asDestination`), `src/lib/orders/grouping.ts:26` (`PACKAGE_DESTINATION_FIELDS` + `PackageDestination`), `src/lib/orders/grouping.ts:146` (`pickPackageDestination`)

`asDestination` in greetings rebuilds the same field set `PackageDestination` already describes, and `LineDestination` is a hand-written subset of it. The two adapters also disagree on defaults: `asDestination` substitutes `''` for missing `recipientName`/`fulfillmentMethodId`, `pickPackageDestination` substitutes `null`. The `''` path is defensive for a case `linesForRecipient` already filters out, so the drift is silent. One `toPackageDestination(line)` in `lib/orders/grouping` would remove the second field list and the divergent defaults.

## Minor

### m1. `isAssigned` / `isAssignedLine` type-guard duplicated
`src/lib/checkout/checkout-summary.ts:259` (`isAssigned`), `src/lib/orders/order-service.ts:189` (`isAssignedLine`)

Byte-identical: `return line.recipientName !== null && line.fulfillmentMethodId !== null`. Each narrows to its own local `AssignedLine`/`AssignedLineRow`. A shared guard `isLineAssigned(line): line is { recipientName: string; fulfillmentMethodId: string }` would let both callers intersect their own line type.

### m2. `findOwnedDraftOrder` reimplements `findOwnedDraft` with a different key
`src/lib/checkout/greetings.ts:144`

Local `findOwnedDraftOrder(owner, orderId)` does `db.order.findFirst({ where: { id: orderId, status: 'DRAFT', ...ownerFilter(owner) } })`. `draft-access.ts:109` already has `findOwnedDraft(owner, seasonId)` with the same shape keyed on `seasonId`. Could be one `findOwnedDraftBy(owner, key)` or a re-exported `findOwnedDraftById`.

### m3. `mergeInventoryDemand` and `stockConflicts` build the same demand map
`src/lib/orders/order-service.ts:227` (`mergeInventoryDemand`), `src/lib/checkout/validation.ts:122` (`stockConflicts`)

Both walk lines + addOns, filter on `tracksInventory`, and accumulate into a `Map<string, number>` keyed by `product:${productId}` / `addon:${addOnId}`. One produces demand for reservation, the other for conflict reporting. Same key scheme, same filter, same accumulation. A shared `inventoryDemand(lines)` returning the map would let each caller do its own thing with it.

### m4. `LOCAL_PAY_UNAVAILABLE` conflates two failure modes
`src/lib/payments/local-hosted.ts:67` (provider not local), `:101` (signed-event POST failed)

Same code for a configuration error and a transient POST failure. The messages differ but a caller logging the code cannot distinguish.

### m5. `CHECKOUT_NOT_READY` conflates "no draft" and "blocked"
`src/lib/checkout/checkout-service.ts:54` (no draft found), `:57` (summary not payable)

Same code for "your order was not found on this browser" and "your order has unassigned items / conflicts / no delivery day." The messages differ but the code does not.

### m6. Redirect-with-query-param helper forked three ways
`src/app/(storefront)/order/checkout/actions.ts:100` (`back` → uses `builderHref`), `src/app/(storefront)/order/confirmation/actions.ts:26` (`confirmationHref` → inline `URLSearchParams`), `src/app/(admin)/admin/orders/actions.ts:103` (`done`/`back` → inline template strings)

Three patterns for "redirect to a path with one or two query params." `builderHref` is the shared helper for builder routes; the other two build URLs by hand. Shapes differ (one param vs two vs encoded) so this is soft, but the pattern is repeated.

### m7. `order-service.ts` is 414 lines with mixed concerns
`src/lib/orders/order-service.ts`

Holds state transitions (`finalizeOrder`, `transitionOrder`, `discardDraft`, `claimOrderStatus`), inventory reservation (`reserveInventoryFor`, `releaseInventoryFor`, `mergeInventoryDemand`, `reservationTarget`), package creation (`createPackages`), fee charging (`chargeFulfillment`, `methodOf`), and settings reading (`readRateRules`). Under the 500-line threshold, but the P4 review flagged it as "worth watching" and P5 added `readRateRules` and grew `chargeFulfillment`. The inventory half is a self-contained concern that could live in `lib/orders/inventory.ts`.

### m8. `transitionOrder` does not re-check staff permission; money services do
`src/lib/orders/order-service.ts:124` (`transitionOrder` trusts the route's `requirePermission`), `src/lib/payments/offline-payments.ts:217` (`requireMoneyPermission` re-checks)

The money services re-check `orders.manage` (documented in `admin/orders/actions.ts:22` as "the service decides who may move money"). `transitionOrder` is also called from a staff action (`changeOrderStatusAction`) but performs no permission re-check — it only filters by owner (null for staff). A future POS screen calling `transitionOrder` directly would inherit no permission gate. The pattern is inconsistent: money re-checks, status does not.

### m9. `freePhone` returns an opaque partial spread under a boolean-sounding name
`src/lib/checkout/checkout-service.ts:200`

`freePhone` returns `{}` or `{ phone, normalizedPhone }`, spread into `db.customer.create({ data: { ... } })`. The name reads as "is this phone free?" (boolean) but it returns a partial of the customer create input. `claimablePhoneFields` or `phoneFieldsIfFree` would describe what it returns.

## Notes (not findings)

- `trimmedField` in `src/lib/forms/form-data.ts` is the shared helper that resolved P4's M1; P5 uses it consistently across checkout, confirmation, and admin order actions. Good.
- `recordAudit` call shape (actor, input, tx) is consistent across `webhook-service.ts`, `offline-payments.ts`, `order-service.ts`, and `checkout-service.ts`. The `actor: null` convention for system/webhook-initiated rows matches the audit type map in `audit.ts`.
- `recomputeOrderPaymentStatus` is called with `tx` inside transactions and with no client from tests; the optional-`DbClient` pattern is consistent.
- `smoke-p5.ts` is 769 lines but is a smoke driver, not product code; not a clean-code target.
- The hosted checkout page at `src/app/checkout/hosted/[sessionId]/page.tsx` lives outside the `(storefront)` and `(admin)` route groups, which is correct: it is a standalone payment page with neither chrome.
