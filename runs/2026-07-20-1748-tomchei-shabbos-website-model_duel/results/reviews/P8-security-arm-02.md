# Security review — P8, arm-02 (blind)

**Phase:** P8 — Shipping: Shippo, rate margin, labels (`shared/phases/PHASE-P8-EXPECTED.md`)
**Tree:** `arms/arm-02/workspace/`
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 4 |
| Low | 3 |
| Info | 2 |

## Findings

### H1 — `SESSION_SECRET` ships with a known public default and is not fail-closed
`lib/env.ts:15-17`, `.env.example:8`
The session-signing secret has only a `min(16)` length check and defaults to the literal string `change-me-to-a-random-string` in `.env.example` (26 chars, passes the check). An operator who copies `.env.example` to `.env` unchanged runs the staff auth path with a publicly-known HMAC secret, enabling offline forging of `tomchei_session` tokens → full admin takeover. The Stripe webhook secret received an explicit `superRefine` that rejects its public `DEV_WEBHOOK_SECRET` default in real mode (`lib/env.ts:52-60`), and live Shippo is blocked without both carrier-account ids (`:63-70`). `SESSION_SECRET` — the most sensitive secret in the system — got no equivalent guard. Inconsistent fail-closed posture; the secret that signs every staff session is the one most dangerous to default.

### M1 — `voidShipmentById` calls the carrier refund before the DB transaction; partial failure leaves the label PURCHASED while Shippo voids
`lib/shipping/labels.ts:146-174`, `lib/shipping/shippo.ts:125-128`
`voidShipmentById` invokes `voidLabel(shipment.shippoTransactionId)` — a real `POST /refunds/` to Shippo — *before* opening the `db.$transaction` that flips the row to `VOIDED` and writes the `PackageAudit` (`:157-173`). If Shippo accepts the refund but the subsequent DB transaction fails (connection loss, constraint error), the carrier has voided the label while the local row stays `PURCHASED`: the label can be re-voided (double refund attempt) or printed, and no audit row is written. State drift on a money-refund path; the throw path inside the transaction is not the only failure mode here.

### M2 — `buyLabelForPackage` charges the carrier before the DB transaction; a post-purchase DB failure orphans the label
`lib/shipping/labels.ts:99-143`, `lib/shipping/shippo.ts:92-122`
`buyLabelForPackage` calls `buyLabel(decision.buy.rateId)` — a real `POST /transactions/` purchase — *before* the `db.$transaction` that records the `PURCHASED` `Shipment` and `PackageAudit` (`:117-142`). The R-175 compensation block (`:100-115`) only covers the case where `buyLabel` *throws*. If `buyLabel` succeeds and the DB transaction then fails, money has been spent on a carrier label with no DB record, no `trackingNumber`, no audit, and no way for staff to discover or void it. The check→buy→insert sequence is not atomic and there is no `SELECT ... FOR UPDATE` or optimistic-version guard on the package; concurrent `fulfillment.manage` POSTs to `/api/admin/packages/[id]/label` can both pass the `shipments.some(PURCHASED)` guard (`:61-63`), both charge Shippo, and both insert PURCHASED rows. Duplicate carrier charges on a money path.

### M3 — No timeout on Shippo `fetch`; a slow/hung carrier API blocks checkout and label lifecycle indefinitely
`lib/shipping/shippo.ts:34-48`
`shippoFetch` calls `fetch(SHIPPO_BASE + path, …)` with no `AbortController`, no `signal`, and no timeout. Every P8 money path — checkout rate quoting (`quoteShipping` → `getRates`), label buy (`buyLabel`), void (`voidLabel`), tracking refresh (`trackShipment`), and address validation (`validateAddress`) — is unbounded in duration. A slow or hung Shippo endpoint ties up the request worker indefinitely; for the public checkout-quote route this is an availability vector (every long-running quote occupies a server request until the client or carrier drops), and for the admin label routes it can stall staff fulfillment with no failure signal. No timeout budget on any external money-path call.

### M4 — `Shipment.chargedCents` is recorded from a fresh label-time quote, not the quote the customer actually paid
`lib/shipping/labels.ts:78-97`, `lib/checkout/quote.ts:108-114`, `lib/checkout/fees.ts:117-130`
At checkout, `quoteShippingDestinations` calls `quoteShipping` and charges the customer `decision.chargeCents` from that quote (`quote.ts:113`), persisted on the `Order` as a fee. At label purchase, `buyLabelForPackage` calls `quoteShipping` *again* — a brand-new Shippo quote — and records *that* `decision.chargeCents` onto the `Shipment` row (`labels.ts:88`). If carrier rates move between checkout and label purchase, the `Shipment.chargedCents`/`marginCents` recorded "for reconciliation" (P12) reflect the label-time quote, not the amount the customer was actually charged. The margin spread the org believes it captured (and any P12 reconciliation against `Shipment.chargedCents`) is wrong. The two quotes are persisted as separate `ShippingQuote` rows (one `orderId`, one `packageId`) with no link anchoring the label purchase to the customer-paid quote; there is no reuse of the checkout quote at label time.

### L1 — `labelUrl` rendered as an `<a href>` with no scheme validation (stored-XSS defense-in-depth gap)
`components/admin/shipment-actions.tsx:85-89`, `lib/shipping/shippo.ts:99-122`
The purchased `labelUrl` from Shippo is persisted on the `Shipment` row and rendered directly as `<a href={active.labelUrl} target="_blank" rel="noreferrer">`. React does not sanitize `javascript:` (or `data:`) schemes in `href`. Shippo is inside the trust boundary, but the value is also writable via direct DB access or a compromised/rogue provider response, and a `javascript:` URL would execute on click in the staff admin UI. No allow-list (`http`/`https` only) is applied at storage or render time. Defense-in-depth gap on a persisted external string.

### L2 — Admin state-changing routes do no Origin/Referer check, unlike the public-endpoint guard
`app/api/admin/packages/[id]/label/route.ts`, `app/api/admin/shipments/[id]/void/route.ts`, `app/api/admin/shipments/[id]/tracking/route.ts`, `lib/public-guard.ts:9-39`
The public checkout-quote route is protected by `guardPublicEndpoint` (same-origin via Origin/Referer + IP rate limit). The three P8 admin POST routes rely solely on cookie auth (`requirePermissionApi`) plus the JSON `Content-Type` set by `apiFetch` for CSRF protection, and perform no Origin/Referer validation. JSON `Content-Type` triggers a CORS preflight that blocks naive cross-origin form CSRF, but a same-site attacker (e.g., a compromised sibling subdomain, or any path that can post `application/json` same-origin) can submit forged POSTs that ride the staff session cookie. The CSRF posture is inconsistent between the public surface and the privileged admin surface that actually spends money on labels.

### L3 — `refreshShipmentTracking` mutates shipment state with no audit entry
`lib/shipping/labels.ts:177-191`, `app/api/admin/shipments/[id]/tracking/route.ts:7-24`
`buyLabelForPackage` and `voidShipmentById` both write a `PackageAudit` row; the tracking-refresh route mutates `trackingStatus` and `trackingUpdatedAt` on the `Shipment` via `refreshShipmentTracking` but writes no audit record (the route calls `refreshShipmentTracking` and returns, never `writeAudit`). A staff action that changes persisted shipment state is not attributable in the audit trail. Integrity/observability gap on a money-adjacent entity.

### I1 — `shippoFetch` embeds up to 300 chars of the raw Shippo response into error messages that persist into `Shipment.failureReason`
`lib/shipping/shippo.ts:45`, `lib/shipping/labels.ts:105-114`
`ShippoError` is constructed with `JSON.stringify(payload).slice(0, 300)` of the provider response. On a label-purchase refusal this string is stored as `Shipment.failureReason` (sliced to 500) and surfaced to staff via the `FAILED` row and the thrown `ActionError`. Internal provider diagnostics (account/carrier context, validation text) are persisted in the DB and shown in the admin UI. Acceptable for a privileged role, but the raw provider payload should not be assumed to be free of sensitive context; confirm it is never echoed to customers (currently only staff-facing).

### I2 — Direct (non-proxy) mode shares one rate-limit bucket across all clients; newly costly in P8 live mode
`lib/rate-limit.ts:28-37`, `app/api/checkout/quote/route.ts:18`
When `TRUST_PROXY` is off (direct-served dev/single-node), `clientIp` returns the constant `"direct"` for every client, so the `checkout-quote:direct` bucket is shared across all users. A single abuser can exhaust the 60/min limiter for everyone (self-DoS), and in P8 live mode each quote is a real `POST /shipments/` to Shippo with a per-call cost. Pre-existing infra, but the P8 change from a flat placeholder to a live, billable external call per quote raises the cost of the shared-bucket weakness.
