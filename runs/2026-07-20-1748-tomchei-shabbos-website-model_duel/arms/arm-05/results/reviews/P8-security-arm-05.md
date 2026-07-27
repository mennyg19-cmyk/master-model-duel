# P8 Security Review — arm-05 (blind)

**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Scope:** Shippo credential handling, label buy/void authz, IDOR on shipments/labels, margin data exposure, checkout rate trust.
**Method:** Findings only — no fixes. P8 scope only.

## Summary

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 3 |
| Low | 3 |
| **Total** | **8** |

---

## HIGH-1 — Margin data leaked to customer via draft `wireFormat`

**Location:** `lib/checkout.ts` `saveCheckoutDetails` (lines 127–152) writes `shippingQuotes` into `order.wireFormat.checkout`; `lib/order-builder.ts` `serializeDraft` (lines 379–390) returns `wireFormat` verbatim to the draft owner via `GET /api/order/drafts/[draftId]`.

**Claim:** After `startCheckout` runs `saveCheckoutDetails`, the draft's `wireFormat.checkout.shippingQuotes` array contains `marginCents`, `purchasedRateCents`, and `providerMode` for each `SHIP` recipient. `serializeDraft` exposes `wireFormat` unfiltered, so the draft owner (customer or guest) can read the internal margin spread between the customer charge and the carrier cost.

**Evidence:**
- `lib/checkout.ts:132` — `const shippingQuotes = await quoteCheckoutShipping(shippingAddresses);`
- `lib/checkout.ts:134` — `quote.customerChargeCents` (charge) and `quote.marginCents` (spread) are computed.
- `lib/checkout.ts:135` — `const checkout = { ...parsed, rules: {...}, shippingQuotes };` then stored into `wireFormat` at line 144.
- `lib/shipping.ts:131–142` — `quoteCheckoutShipping` returns objects with `customerChargeCents`, `purchasedRateCents`, `marginCents`, `carrier`, `service`, `providerMode`.
- `lib/order-builder.ts:386` — `wireFormat: draft.wireFormat` returned in `serializeDraft`.
- `app/api/order/drafts/[draftId]/route.ts:12` — `NextResponse.json({ draft: serializeDraft(draft) })` to the draft owner.

Per UR-003 / G-006, the margin spread is internal reconciliation data reported in P12; exposing it to the customer defeats the confidentiality premise of the margin engine.

---

## HIGH-2 — Margin data leaked to customer via account orders

**Location:** `lib/order-builder.ts` `getAccount` (lines 329–339) returns customer `orders` with all scalar fields including `wireFormat`; `app/api/account/route.ts` returns it to the authenticated customer.

**Claim:** For finalized orders, `wireFormat.checkout.shippingQuotes` (with `marginCents`, `purchasedRateCents`, `providerMode`) is readable by the owning customer through their account endpoint, persisting the HIGH-1 leak past finalization.

**Evidence:**
- `lib/order-builder.ts:332–338` — `prisma.customer.findUnique({ include: { orders: { orderBy: ..., include: { lines: true } } } })`. No `select` is used, so every scalar on `Order` (including `wireFormat`) is returned.
- `app/api/account/route.ts:5–7` — `getAccount(request)` returned directly as `{ account }` to the signed-in customer.
- `lib/checkout.ts:144` — `wireFormat: { ...(order.wireFormat as object), checkout }` persists the `checkout.shippingQuotes` (with margin) onto the finalized order.

The account view is the customer-facing order history surface; margin fields survive finalization and remain customer-readable indefinitely.

---

## MEDIUM-1 — Admin order detail exposes margin to all `orders.read` staff

**Location:** `app/api/admin/orders/[orderId]/route.ts` GET (lines 8–27) returns `shipmentBoxes` including `chargedCents`, `labelCostCents`, `marginCents` to any staff with `orders.read`.

**Claim:** The `orders.read` permission is granted to both `MANAGER` and `STAFF` roles (`lib/permissions.ts:19`), but UR-003 / G-006 scope margin capture as internal reconciliation reported in P12. Returning `chargedCents` / `labelCostCents` / `marginCents` to non-manager staff over-exposes the carrier-cost side of the margin to roles who only need the customer-facing charge.

**Evidence:**
- `app/api/admin/orders/[orderId]/route.ts:9` — `authorize(request, "orders.read")`.
- `app/api/admin/orders/[orderId]/route.ts:18–22` — `packages: { include: { shipmentBoxes: { orderBy: { createdAt: "desc" } } } }` with no field selection; `ShipmentBox` scalar fields `chargedCents`, `labelCostCents`, `marginCents` are returned.
- `lib/permissions.ts:17–21` — `STAFF: ["orders.read", "orders.write", "customers.read", "customers.write"]` includes `orders.read`.

---

## MEDIUM-2 — Package shipping summary exposes margin to all `orders.read` staff

**Location:** `app/api/admin/packages/[packageId]/shipping/route.ts` GET (lines 12–17) → `lib/shipping.ts` `packageShippingSummary` (lines 238–257).

**Claim:** The dedicated shipping summary endpoint selects `chargedCents`, `labelCostCents`, `marginCents` explicitly and returns them to any staff with `orders.read` (MANAGER + STAFF). Same over-exposure as MEDIUM-1, on the per-package shipping surface that powers the order detail page's label UI.

**Evidence:**
- `app/api/admin/packages/[packageId]/shipping/route.ts:13` — `authorize(request, "orders.read")`.
- `lib/shipping.ts:243–255` — `select: { chargedCents: true, labelCostCents: true, marginCents: true, ... }` returned verbatim.

---

## MEDIUM-3 — Checkout quote parcel does not match label-purchase parcel

**Location:** `lib/shipping.ts` `quoteCheckoutShipping` (lines 110–143) vs `parcelForPackage` (lines 61–96).

**Claim:** Checkout rates (the customer's charge) are quoted using the first active `PackageType` ordered by `createdAt` with `maxWeightOunces` as the parcel weight, while label purchase bin-packs against the actual measured contents and selects the smallest box that fits. The customer charge and the purchased label can therefore be quoted for different parcels, so the persisted `marginCents = charge − cost` is not a faithful margin and can go negative (customer charged less than label cost) — undermining the UR-003 margin guarantee at the trust boundary between checkout and label purchase.

**Evidence:**
- `lib/shipping.ts:121–130` — `const packageType = await prisma.packageType.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } })` and `weightOunces: Number(packageType.maxWeightOunces)` — a single, smallest, max-capacity parcel used for every checkout quote regardless of order contents.
- `lib/shipping.ts:77–81` — `parcelForPackage` bin-packs by `boxVolume(box) >= packageDimensions.volume && Number(box.maxWeightOunces) >= packageDimensions.weight` and picks the smallest fitting box, with weight from actual product dimensions.
- `lib/shipping.ts:178–179` — `chargedCents: quoted.selection.charge.amountCents`, `labelCostCents: quoted.selection.purchase.amountCents` are persisted on the `ShipmentBox`, but the two selections come from different parcel inputs.

The customer cannot inject a rate (server-side fetch, address ownership checked in `saveCheckoutDetails`), so this is a trust/correctness gap in the rate pipeline rather than a rate-injection vector.

---

## LOW-1 — `providerMode` ("fixture" | "live") disclosed to customer

**Location:** `lib/shipping.ts:140` (`providerMode: client.mode`) → stored in `wireFormat.checkout.shippingQuotes` → exposed via HIGH-1 / HIGH-2 paths.

**Claim:** The customer can observe whether the org is running Shippo in fixture or live mode, leaking shipping-provider configuration state to buyers. Combined with HIGH-1, this is reachable from the draft and account surfaces.

**Evidence:**
- `lib/shipping.ts:140` — `providerMode: client.mode` included in each returned quote.
- `lib/checkout.ts:135` — quotes stored into `wireFormat.checkout.shippingQuotes`.

---

## LOW-2 — Ground-equivalent regex matches non-ground service names

**Location:** `lib/shippo.ts` `isGroundEquivalent` (line 94–96) used by `selectMarginRate` (lines 98–109).

**Claim:** The eligibility filter `/ground|home delivery|standard/i` matches any service whose name contains "standard" (e.g., "Standard Overnight", "Priority Mail Express Standard") and treats it as a ground-equivalent rate for the margin engine. A premium/expedited rate could be selected as the `charge` (highest) or `purchase` (lowest) rate, corrupting the margin spread and potentially purchasing a non-ground label under a ground margin policy.

**Evidence:**
- `lib/shippo.ts:94` — `return /ground|home delivery|standard/i.test(rate.service);`
- `lib/shippo.ts:106–107` — `charge` and `purchase` are reduced over `availableRates`, which is filtered only by `isGroundEquivalent`.

---

## LOW-3 — Unfiltered Shippo error detail surfaced to staff UI

**Location:** `lib/shippo.ts` `requestShippo` (lines 125–140) throws `new Error(message)` where `message = body.detail`; consumed by `app/api/admin/packages/[packageId]/shipping/route.ts:39` and returned as `{ error: error.message }`.

**Claim:** Upstream Shippo error text (`body.detail`) is propagated unredacted into the staff-facing API response and rendered in the admin order detail page's status line. While Shippo does not echo the `ShippoToken` header, the unfiltered upstream message is reflected to the operator without sanitization, which could expose provider-side diagnostic detail (rate IDs, account references, validation internals) in the UI.

**Evidence:**
- `lib/shippo.ts:135–137` — `const message = typeof body.detail === "string" ? body.detail : "Shippo rejected the request."; throw new Error(message);`
- `app/api/admin/packages/[packageId]/shipping/route.ts:38–40` — `return NextResponse.json({ error: error instanceof Error ? error.message : "..." }, { status: 400 });`
- `app/admin/orders/[orderId]/page.tsx:60` — `setMessage(body.error ?? "Shipping action could not be completed.")` renders the message to the operator.
