# Security review — P8, arm-01 (blind)

**Phase:** P8 — Shipping: Shippo, rate margin, labels (`shared/phases/PHASE-P8-EXPECTED.md`)
**Tree:** `arms/arm-01/workspace/`
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 4 |
| Low | 3 |
| Info | 1 |

## Findings

### M1 — `buyPackageLabel` check→buy→insert is not atomic; concurrent buys can double-charge
`src/domain/shipping.ts:261-290`, `prisma/migrations/20260721043000_p8_shipping/migration.sql:29-31`
`buyPackageLabel` guards against an existing label with a plain `findFirst({ where: { packageId, status: "PURCHASED" } })` (`:267-269`), then calls `provider.buyLabel` (a real Shippo `/transactions/` purchase) and only afterward opens a `$transaction` to insert the `ShippingLabel` (`:291-308`). There is no `SELECT ... FOR UPDATE` on the package, no optimistic-version check, and no unique constraint blocking a second PURCHASED label per package — the migration's only unique index is on `providerTransactionId` (`migration.sql:29`), which differs per purchase. Two concurrent `orders:manage` POSTs with `action: "buy"` for the same `packageId` can both pass the guard, both charge Shippo, and both insert PURCHASED rows. Result: duplicate carrier charges and two active labels for one package on a money path.

### M2 — `voidPackageLabel` calls the provider refund before the DB transaction; partial failure leaves label PURCHASED while Shippo refunds
`src/domain/shipping.ts:347-378`, `src/lib/shippo.ts:152-160`
`voidPackageLabel` invokes `provider.voidLabel(label.providerTransactionId)` (a real Shippo `/refunds/` POST) before opening the DB transaction that flips the row to `VOIDED` (`:362-377`). If Shippo accepts the refund as `REFUND_PENDING` it is treated as success, but any other response throws and the local row stays `PURCHASED` — even though the carrier may have already started the refund. If the network fails after Shippo accepted, the label remains PURCHASED locally and can be re-voided (double refund) or printed. No `PackageAudit` row and no failure record is written on the throw path, and the `REFUND_PENDING`-but-accepted state is never persisted. Provider/DB state drift on a refund path.

### M3 — `buyPackageLabel` skips the active/shipping/stage guards that `quotePackage` enforces
`src/domain/shipping.ts:261-290` vs `:153-196`
`quotePackage`/`loadPackagePlan` reject packages that are inactive, non-shipping, or already `SENT`/`PICKED_UP` (`:166-171`). `buyPackageLabel` does not call `loadPackagePlan` and has no equivalent check — it only blocks when an existing PURCHASED label exists. A manager can therefore buy a carrier label for an inactive, non-shipping, or already-sent package by POSTing `action: "buy"` with that `packageId`. Integrity bypass on the label-purchase money path; the label is also attached to a single `shipmentBox` (`findFirst orderBy sequence desc`, `:285-288`) without re-validating the plan.

### M4 — Unauthenticated checkout GET triggers uncapped per-address Shippo rate calls
`src/app/api/checkout/stripe/route.ts:41-101`, `src/domain/shipping.ts:421-484`, `src/lib/public-request.ts:21-66`
The public `GET /api/checkout/stripe` handler calls `quoteDraftShipping`, which issues one live `POST /shipments/` to Shippo per recipient address with no caching and no throttle (`shipping.ts:466-481`). Unlike the POST branch (`route.ts:105`), this GET is not covered by `guardPublicWrite`, so the IP-based 30/min limiter does not apply. Access is gated by `findAccessibleDraft` (guest token / customer auth / admin), so it is not fully anonymous, but a holder of a 30-day draft-access cookie can hammer the endpoint to exhaust the Shippo API quota / run cost, with no rate limit on the expensive external call and no deduplication across repeated loads.

### L1 — Raw `error.message` (including Shippo `detail`) returned to client on shipping actions
`src/app/api/admin/shipping/route.ts:58-66`, `src/lib/shippo.ts:84-91`
The admin shipping route's catch-all returns `error.message` as the 409 body. Shippo errors are constructed from `payload.detail` (`shippo.ts:86-88`), so provider-side error text (which can include account/carrier context) is echoed to the caller. Manager-only endpoint, so impact is limited to internal-detail disclosure within a privileged role.

### L2 — Secret/config read via `process.env` directly, bypassing the centralized env layer
`src/lib/shippo.ts:199-203`, `src/domain/shipping.ts:131-151`, `src/lib/env.ts:1-29`
`getShippingProvider()` reads `SHIPPO_API_TOKEN` and `organizationAddress()` reads `SHIP_FROM_*` straight from `process.env`, even though `src/lib/env.ts` already declares `SHIPPO_API_TOKEN` behind `readServerEnvironment()`. The secret is accessed outside the validated/typed env layer, so the centralization and fail-fast `requireEnvironmentValue` guarantee do not cover the shipping integration. Hygiene gap on a secret.

### L3 — `labelUrl` rendered as an unvalidated `href`; no scheme allow-list
`src/components/shipping-actions.tsx:95-99`, `src/lib/shippo.ts:148`
`labelUrl` is `String(payload.label_url)` from the Shippo response and rendered as `<a href={label.labelUrl}>`. There is no scheme validation (https-only). If the provider response is malformed or tampered (e.g. a `javascript:` or `data:` URL via a compromised/MitM Shippo response), the admin UI would render a clickable unsafe href. Admin-only and provider-sourced, so likelihood is low, but the sink is unguarded.

### I1 — Failed label purchase writes a `FAILED` row outside a transaction with no `actorStaffId`
`src/domain/shipping.ts:328-344`
The `buyPackageLabel` catch path inserts the `FAILED` `ShippingLabel` via a standalone `prisma.shippingLabel.create` (no `$transaction`, no `actorStaffId`, no `PackageAudit`). The successful path writes an audit row; the failure path — arguably more important to attribute — does not, and a failure during that insert silently loses the failure record. Audit-attribution gap on a money path.

## Out of scope (noted, not findings)
- Charging the customer the highest quoted rate and buying the cheapest (margin) is the documented UR-003/G-006 business model, not a security boundary.
- `selectShippingMargin` restricts to USD and FedEx/UPS/USPS; no injection surface.
- `track`/`validateAddress` use `encodeURIComponent` on provider-stored carrier/tracking values; not user-controlled at request time.
- `shippingActionSchema` validates `packageId` (min 1) and Prisma parameterizes all queries; no SQL injection.
- `findAccessibleDraft` correctly scopes drafts by customer, guest-token hash, or `admin:view` — no IDOR on the draft lookup.
- Shipping action POST route correctly gates on `requirePermission("orders:manage")`; the `admin:view`-gated pages that render `ShippingActions` only expose UI — the mutating POST 403s for view-only roles.
