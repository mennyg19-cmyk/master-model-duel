# P8 Security Review — arm-04 (blind)

**Reviewer:** Security specialist (external, blind to model name)
**Scope:** `arms/arm-04/workspace/` P8 shipping — Shippo wrapper, margin engine, bin packing, label buy/void/track/validate, live checkout rates
**Phase ref:** `shared/phases/PHASE-P8-EXPECTED.md`
**Method:** Findings only — no fixes. Trust boundaries, auth, secrets, IDOR, injection on shipping/label/quote paths.
**Files reviewed:** `src/lib/shipping/{shippo-api,label-service,quote-service,margin,bin-packing,provider,local-provider,address-check,carriage-view}.ts`, `src/app/(admin)/admin/fulfillment/actions.ts`, `src/app/(admin)/admin/fulfillment/packages/[packageId]/page.tsx`, `src/app/(admin)/admin/fulfillment/batches/[batchId]/groups/[groupId]/[artifact]/route.ts`, `src/app/(admin)/admin/settings/actions.ts`, `src/components/admin/carriage-card.tsx`, `src/lib/checkout/{fees,checkout-summary}.ts`, `src/lib/orders/order-service.ts`, `src/lib/env-spec.ts`, `src/lib/env.ts`, `src/lib/audit.ts`, `src/lib/auth/staff.ts`, `prisma/schema/fulfillment.prisma`

## Summary

P8 is well-fenced. Every server action gates on `fulfillment.manage`; every package lookup is scoped by `boardScopeWhere(seasonId)` (active season + non-cancelled order); rate ids are produced inside the buy flow rather than trusted from the form, so a stale or foreign rate id cannot be slipped in. The local stand-in provider is refused off loopback by the env schema. No SQL, no shell, no template injection surfaces were found — Prisma parameterises, React escapes carrier-supplied strings, and the one place a user value lands in a URL path (`track`) uses `encodeURIComponent`.

The findings below are mostly about data that lives longer or travels wider than the code that produced it: addresses logged on carrier failure, carrier account ids not flagged as secrets, label URLs that stay valid after a void, and unbounded free-text columns written from form and carrier input.

## Findings

### M1 — Recipient address logged to stderr on carrier quote failure (PII in logs)

**Severity:** Medium
**File:** `src/lib/shipping/quote-service.ts:194-199`

`quoteOne` wraps the live `provider.quote` call in a `try/catch` whose `catch` does:

```ts
console.error(`Shipping quote for ${subject.key} failed, falling back to the settings rate`, error);
```

`subject.key` is the package grouping key (commonly derived from recipient name + address), and the thrown `error` from `shippo-api.ts:240-242` includes the full Shippo response payload. The request body sent to Shippo (`shippo-api.ts:84-101`) contains the recipient's `name`, `street1`, `street2`, `city`, `state`, `zip`, `country`, and `phone`. Shippo error responses echo the submitted `address_to` on validation failures. Net effect: a carrier outage or address-validation refusal writes the recipient's full shipping address (and the origin address, on `address_from` failures) to server stderr / whatever log drain is attached.

Shipping addresses are the personal data the application holds; logging them on a routine error path (carrier down, bad address) is broader exposure than the application's own audit trail, which deliberately omits addresses (`audit.ts:130-133` logs only `postalCode`).

### L1 — Carrier account ids not flagged as secrets in env-spec

**Severity:** Low
**File:** `src/lib/env-spec.ts:142-155`

`SHIPPO_FEDEX_ACCOUNT_ID` and `SHIPPO_UPS_ACCOUNT_ID` are declared without `secret: true`, so `renderEnvExample()` does not add the "Secret: rotate immediately if it ever leaves this machine" comment that other credentials get. These ids identify the org's own FedEx and UPS carrier accounts and are sent to Shippo as `carrier_accounts` on every quote (`shippo-api.ts:97-99`). They are not as sensitive as the API token, but they are account identifiers an attacker could reuse against Shippo's own OAuth flow for the same carriers. Marking them secret would at least keep them out of any future "non-secret env dump" diagnostic and align the `.env.example` comment with how they are treated operationally.

### L2 — Label URL is a long-lived bearer token, not rotated on void

**Severity:** Low
**File:** `src/components/admin/carriage-card.tsx:195-204`, `src/lib/shipping/shippo-api.ts:134-138`, `src/lib/shipping/label-service.ts:200-207`

`PurchasedLabel.labelUrl` is Shippo's hosted PDF URL, stored verbatim on `ShipmentBox.labelUrl` and rendered as a direct external link (`<a href={parcel.labelUrl} target="_blank" rel="noreferrer">`) for any staff member viewing the package. The URL is the only thing standing between the label PDF and the public — Shippo serves it to anyone who has it. Two issues compound this:

1. The link is rendered only when `parcel.status === 'PURCHASED'`, but the URL stays in the database after the parcel moves to `VOIDED`, and the carriage card still renders the parcel row (just without the link). The URL itself is not invalidated at Shippo on void — `voidLabel` calls `/refunds/`, which refunds the carrier charge but does not necessarily pull the PDF. Anyone who captured the URL before the void can still download the label.
2. No origin check on `labelUrl` before it is rendered as `href`. If Shippo ever returned a different host (compromised account, misconfigured test token, a future provider swap), the admin UI would link staff to an attacker-controlled URL with no warning. The local provider already demonstrates a non-`goshippo.com` host (`https://labels.invalid/...`), so the code path is host-agnostic today.

### L3 — Unbounded free-text columns written from form and carrier input

**Severity:** Low
**Files:** `src/app/(admin)/admin/fulfillment/actions.ts:220-232` (`reason`), `src/lib/shipping/shippo-api.ts:124-131,185-194` (`failureMessage`, `addressValidationNote`), `prisma/schema/fulfillment.prisma:112,190,200`

`voidLabelAction` accepts `reason` from the form via `trimmedField` and writes it straight to `ShipmentBox.voidReason`. There is no length cap on the action side and the schema column is `String?` with no `@db.VarChar` limit. A staff member (or an automated form poster with a stolen session) can write an arbitrarily long string that is later rendered verbatim in `carriage-card.tsx:192` and in the audit trail. The same applies to `failureMessage` and `addressValidationNote`, which come from Shippo's response body and are stored unbounded — a hostile or buggy carrier response can grow the row.

None of these are XSS (React escapes), but unbounded server-stored strings from a network input are a cheap DoS and a reconciliation-report hazard. The audit detail for `shipping.label_voided` also embeds `reason` (`audit.ts:120-125`), so the audit row inherits the same unbounded input.

### L4 — `buyLabelForPackage` trusts rate ids from an in-function quote without an explicit ownership check

**Severity:** Low (defense-in-depth)
**File:** `src/lib/shipping/label-service.ts:59-90`

The buy flow re-quotes inside the function (`quoteFor(box)`) and then calls `provider.buyLabel(purchase.rateIds[index])`. The rate ids are not attacker-controlled via the form — the form only submits `packageId` and `seasonId` — so this is not directly exploitable. It is noted because there is no assertion that `purchase.rateIds[index]` was issued for this box's parcels; the only link is that the same function produced both. If `quoteFor` is ever refactored to accept a cached or caller-supplied quote, the buy step would silently accept a rate id quoted for a different box and buy a label against it, charging the org for someone else's shipment. A one-line check that the rate id was produced from this box's `quoteFor` call would close the gap.

### I1 — `voidLabelForPackage` silently skips parcels with no `providerTransactionId`

**Severity:** Informational
**File:** `src/lib/shipping/label-service.ts:193-208`

The void loop does `if (!parcel.providerTransactionId) continue;` for each PURCHASED parcel. A PURCHASED parcel without a transaction id should not exist (the buy path writes both atomically), so the skip is defensive. The function still returns success and reports `parcelCount: box.shipmentBoxes.length` regardless of how many were actually voided, so a partial-skip is invisible to the caller. Not a vulnerability — flagged only because the audit row's `parcelCount` and the returned `parcelCount` can disagree with the number of carrier calls actually made.

### I2 — Local provider `buyLabel` does not validate the full rate-id structure

**Severity:** Informational
**File:** `src/lib/shipping/local-provider.ts:65-80`

`buyLabel` splits the rate id on `:` and only checks the prefix. The `carrier` segment is then used in the tracking-number string. In this codebase the rate id is always produced by the same provider's `quote`, so `carrier` is one of the three constants in `CARRIERS`. Not exploitable today; noted because the validation is weaker than the real provider's (Shippo rejects unknown rate ids server-side), so a future caller that hands an arbitrary string to `local.buyLabel` would get a label with an attacker-influenced tracking number rather than a refusal.

## What was checked and found clean

- **Auth on every P8 server action:** `buyLabelAction`, `voidLabelAction`, `refreshTrackingAction`, `validateAddressAction` all call `requirePermission('fulfillment.manage')` before any shipping work. The print-artifact route (`batches/[batchId]/groups/[groupId]/[artifact]/route.ts`) gates the same way and validates `artifact` against `isPrintArtifact`.
- **IDOR / cross-season access:** every package lookup (`readShippable`, `voidLabelForPackage`, `refreshTrackingForPackage`, `validatePackageAddress`, `readCarriageCard`) scopes with `boardScopeWhere(seasonId)`, which filters to the active season and to non-cancelled order statuses. `packageId` is a UUID, not sequential, so cross-package guessing is not realistic.
- **Double-buy race:** `claimParcels` re-checks inside a transaction that no `ACTIVE_LABEL_STATUSES` parcel exists before creating PENDING rows, so two concurrent buys on the same box cannot both reach the carrier.
- **Carrier-refusal compensation:** on a buy failure, already-bought parcels in the same box are voided at the carrier before the error is raised (`compensate`), and the rows are marked `FAILED` with the carrier's message. No label is left bought without a row that knows about it.
- **Injection:** the only user/carrier value placed in a URL path is `carrier` + `trackingNumber` in `shippo-api.ts:165-172`, both `encodeURIComponent`-d. All other carrier calls are JSON bodies over `fetch`. No `eval`, no shell, no template strings reaching SQL.
- **Secrets at rest:** `SHIPPO_API_TOKEN` is read from `env` once at provider construction and sent only in the `Authorization` header to `api.goshippo.com`. It is not logged, not returned in any error to the browser, and not written to the DB. The env schema refuses `SHIPPING_PROVIDER=shippo` without it (`env-spec.ts:235-241`).
- **Local provider escape:** `SHIPPING_PROVIDER=local` is refused unless `APP_URL` is loopback (`env-spec.ts:245-253`), so a misconfigured production deploy cannot quote or issue fake labels to real customers.
- **Audit integrity:** every P8 action writes an audit row naming the real actor (not the impersonated one) via `recordAudit(actor, ...)).` The `shipping.label_failed` audit detail deliberately omits the carrier's failure message (kept on the box behind `fulfillment.manage`), consistent with the policy in `audit.ts:62-64`.
- **Checkout/finalize quote parity:** both `readCheckoutSummary` and `chargeFulfillment` call `quoteShippingBoxes` independently — checkout does not hand a quote to finalize; finalize re-asks. A quote the customer saw cannot be billed against a different rate.

## Counts by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 4 |
| Informational | 2 |
| **Total** | **7** |
