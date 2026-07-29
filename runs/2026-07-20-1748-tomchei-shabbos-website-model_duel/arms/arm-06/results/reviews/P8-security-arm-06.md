# P8 Security Review — arm-06 (blind)

**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Scope:** `lib/shipping/*`, `app/api/admin/packages/[packageId]/label/*`, `app/api/dev/shippo-fixture/*`, `lib/checkout/shipping-quotes.ts`, checkout submit re-quote path, env/secrets.
**Reviewer:** Security specialist (blind — no model name).
**Method:** Findings only, no fixes. Trust boundaries, auth, secrets, IDOR, injection, money-path integrity.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 4 |
| Minor | 4 |

The shipping stack is well-fenced at the auth boundary: every admin label endpoint gates on `requireApiPermission("fulfillment.manage")`, the dev fixture is hard-disabled on any Vercel deploy (`isDevAuthBypass` checks `VERCEL_ENV` not `NODE_ENV`), the Shippo token is optional and fails closed (`ShippoNotConfiguredError` → 503), and the margin engine is pure/unit-testable with the HTTP and DB kept separate. The findings below are money-path integrity and cost-abuse gaps, not auth bypasses.

## Major

### M1 — Stuck `PURCHASING` shipment row permanently blocks label buys (availability on the money path)

`lib/shipping/labels.ts:146` creates the `Shipment` row with `status: "PURCHASING"` **before** calling `buyLabelTransaction`. The catch block at `labels.ts:210` flips it to `FAILED` on error — but only if execution reaches the `try`. If the process crashes, the deploy cold-starts, or the Shippo fetch hangs past the runtime timeout between the `create` and the `update`, the row stays `PURCHASING` forever.

`loadShippedPackage` (`labels.ts:60`) filters `shipments: { where: { status: { in: ["PURCHASING", "PURCHASED"] } } }` and `buyLabel` rejects when `pkg.shipments.length > 0` (`labels.ts:121`). `voidLabel` only acts on `status === "PURCHASED"` (`labels.ts:229`). There is **no path to clear a stuck `PURCHASING` row** — no timeout, no cron sweep, no manual admin clear. The partial unique index (one active shipment per package) then permanently blocks label creation for that package. A single unlucky crash leaves a SHIPPED package unshippable until a DBA intervenes.

### M2 — Async refund failure is never reconciled (money-ledger integrity)

`voidLabel` (`labels.ts:237-249`) calls `voidLabelTransaction`, throws only on `refund.status === "ERROR"`, and for `SUCCESS`/`QUEUED`/`PENDING` immediately marks the row `VOIDED` and records `reversedCostCents: active.costCents` in the event/audit. Shippo processes voids asynchronously — a `QUEUED`/`PENDING` refund can still fail carrier-side after the row is marked `VOIDED`. There is no follow-up poll, no webhook, and no re-fetch of the refund status. The reconciliation ledger (P12) will then show a voided label as fully reversed while the org was actually charged. The code comment at `labels.ts:243` ("the refund settles carrier-side") accepts the optimistic mark, but nothing detects a later settlement failure.

### M3 — Checkout display quotes trigger unbounded Shippo rate calls (cost abuse)

`quoteCheckoutShipping` (`lib/checkout/shipping-quotes.ts:78`) runs `Promise.all` over recipients, each calling `quoteShipping` → `createShipmentWithRates` → one live Shippo shipment create. This runs on **every server-side render** of `/checkout?ref=...` (`app/(storefront)/checkout/page.tsx:126`), with no cache, no persisted-quote reuse, and no rate limit. The public guard (`guardPublicCheckoutMutation`) and `checkoutRateLimit` apply only to the submit/pay mutation endpoints, not page loads.

Shippo bills per rate request in production. Anyone holding a draft ref (a logged-in customer's own draft, a guest cookie, or a leaked URL) can reload the checkout page to fire N recipient-rate requests per load with no throttle. The submit path already re-quotes live (`submit.ts:124`), so the display quote is pure UX — yet it spends real carrier API budget on every render.

### M4 — `costCents` parsed from Shippo echo with no numeric validation (money-path robustness)

`buyLabel` (`labels.ts:175`) computes `costCents = Math.round(Number(transaction.rate?.amount ?? "0") * 100)`. The zod schema (`shippo.ts:94`) validates `rate.amount` as `z.string()` only — not a numeric string. If Shippo ever returns a non-numeric amount (API change, transient malformed body, or a fixture/intercept returning `"N/A"`), `Number(...)` is `NaN`, `Math.round(NaN)` is `NaN`, and `marginCents = chargedCents - NaN` is `NaN`. Prisma will throw on the `Int` write inside the `$transaction`, leaving the Shipment in `PURCHASING` (see M1) and the label already bought carrier-side — money spent with no ledger row. The cost is also trusted as the actual charge with no cross-check against the rate that was selected (`quote.margin.buy.amountCents`); a mismatch is silently recorded as margin drift rather than flagged.

## Minor

### m1 — Raw Shippo error body surfaced to the client (info leak)

`ShippoApiError` (`shippo.ts:17-24`) embeds `JSON.stringify(raw).slice(0, 300)` of the carrier response in the message. `mapDomainError` returns that message verbatim as `{ error: error.message }` on the track (502) and validate (502) routes. The truncated body can include Shippo account references, carrier account ids, or internal request ids. Exposure is staff-only (`fulfillment.manage`), but carrier-side internals should be logged server-side and summarized for the client, not echoed raw.

### m2 — `labelUrl` rendered as `href` with no scheme validation (reflected URL)

`transactionSchema` (`shippo.ts:91`) validates `label_url` as `z.string().nullish()` — no URL/scheme check. The value is rendered as `<a href={active.labelUrl} target="_blank" rel="noreferrer">` (`label-actions.tsx:110`). In production Shippo returns an HTTPS S3 link, but if `SHIPPO_BASE_URL` is pointed at an attacker-controlled or compromised proxy (env trust boundary), or a future fixture returns a `javascript:` URI, the link becomes an XSS vector in the admin shell. The `rel="noreferrer"` does not mitigate `javascript:` execution. Validate the scheme at the zod boundary (`https` only) or sanitize before render.

### m3 — `ShippoApiError` detail length cap is on serialized JSON, not semantic fields

`shippo.ts:180` truncates `JSON.stringify(raw)` to 300 chars. JSON truncation can cut mid-field, producing malformed strings that leak half a secret (e.g., a partial account id) while losing the actionable error code. A field-level extraction (`raw.messages`, `raw.detail`) with per-field caps would be safer than slicing the serialized blob.

### m4 — `getShippoConfig` caches the token in a module-level singleton

`shippo.ts:34` caches `shippoConfigCache` for the process lifetime. Token rotation (e.g., after a leak) requires a full process restart — there is no TTL or invalidation hook. Operationally fragile if a secret rotation runbook expects hot-reload. Low security impact (the cached token is still valid until rotated carrier-side), but worth noting for the P12 launch-readiness secret-rotation checklist.

## Out of scope / explicitly not findings

- **Dev fixture open in local dev** (`/api/dev/shippo-fixture`): `isDevAuthBypass` hard-disables on `VERCEL_ENV === "production" | "preview"` regardless of the flag — correct.
- **IDOR on `[packageId]` label routes**: single-org model; `fulfillment.manage` is the correct authz tier; `loadShippoPackage` enforces OPEN-season domain state; cuid package ids are unguessable. No finding.
- **PII sent to Shippo for address validation (R-177)**: specified carrier data sharing, not a leak.
- **`SHIPPO_BASE_URL` SSRF**: env-trusted, zod-validated as URL, set by ops — not user-influenced.
- **`reason` free-text in voidLabel**: 500-char cap, staff-only input, stored as JSON metadata, not rendered as HTML server-side. No XSS.
