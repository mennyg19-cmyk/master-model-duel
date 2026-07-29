# P8 Fix-Notes — arm-06

Single fix pass against `AGGREGATE-REVIEW-P8.md`. **Fixed: 1/1 blocker, 9/9 majors, 18/18 minors. Deferred: none.**

## Blocker

- **B1 — tracking refresh at SENT.** The terminal-stage guard now splits by operation: void/buy stay refused once SENT (the carrier has the parcel), `refreshTracking` is the live operation there and runs. Pinned by smoke S4a and domain test "B1: tracking refresh works at SENT".

## Majors

- **M1/M8 — stuck `PURCHASING` recovery.** `buyLabel` no longer marks a row FAILED after the carrier confirmed the sale: a post-sale persist failure leaves the row PURCHASING with the carrier transaction id. `sweepShippingMaintenance` (new cron `GET /api/cron/shipping-maintenance`, bearer-gated) completes carrier-confirmed rows and fails stale unconfirmed ones; staff get `POST …/label/resolve-stuck` plus a UI affordance on the package page. Pinned by S4b/S4d/S4e.
- **M2 — async void refund reconciliation.** `Shipment.shippoRefundId`/`refundStatus` columns; `voidLabel` records the refund object; the sweep polls `GET /refunds/:id` and settles QUEUED/PENDING refunds — a carrier-declined void reverts the row to PURCHASED (the label is still live and paid) with a `label_void_rejected` event. Pinned by S4c/S4d/S4f.
- **M3 — live Shippo HTTP out of the submit transaction.** `submit.ts` quotes SHIPPED recipients before `prisma.$transaction`; the tx re-loads and re-validates, so drift since the quote surfaces as a 409 totals conflict, never a wrong charge. Quote failure refuses the submit with a clean 422.
- **M4 — money validation.** Zod `numericAmount` (finite numbers only) and `https?` URL schemes at the Shippo boundary; `buyLabel` cross-checks the echoed cost against the quoted rate and flags drift in the `label_buy` event metadata (fixture `DRIFTBUY` seam). Pinned by S4i.
- **M5 — merged-package margin ledger.** `Shipment.chargeBreakdown` JSON holds the per-recipient frozen-fee split; charge = sum of member quotes, cost = combined-parcel price, margin = honest blend; `label_buy` metadata flags the merge. Pinned by S4g/S4h.
- **M6 — `line2` on the quote path.** `RecipientQuoteTarget` / `CheckoutRecipientProps` carry `line2`; quote and label destinations now match. Pinned by S4j (fixture `lastShipmentTo.street2`).
- **M7 — dead `shipping.rates` setting dropped** from `lib/settings.ts`, `WRITABLE_KEYS`, and the settings UI.
- **M9 — display-quote fan-out capped.** `quoteCheckoutShipping` runs through a concurrency cap (4) with a 60 s in-memory cache keyed by order+recipient+address; a checkout re-render inside the TTL spends zero carrier calls. Pinned by S4k (server-side fixture stats).

## Minors (all 18 fixed)

- **m1** `shipping.groundServiceTokens` setting seam over `GROUND_SERVICE_TOKENS` (DB-editable, code default fallback).
- **m2** deleted `voidActiveShipmentForReroute` (one-line passthrough, zero call sites).
- **m3** the sweep purges expired `ShippingQuote` rows (`deleteMany … expiresAt < now`).
- **m4** orphan `_prisma_migrations` row reconciled (renamed migration realigned by SQL); migration-guard green.
- **m5** `ShippoApiError.clientMessage` is a staff-safe summary; raw carrier detail stays server-side.
- **m6** `label_url` / invoice URLs validated `https?://` at the boundary.
- **m7** error bodies summarized per semantic field (`messages`/`detail`, ≤3 entries, 160 chars each).
- **m8** `getShippoConfig` re-derives from the env snapshot per call — no module-level token singleton.
- **m9/m15** package page fetches `lastFailedShipment` with an explicit `findFirst(status FAILED, latest)` instead of `find` over a 5-row window; the duplicated PURCHASED find is gone.
- **m10** `destinationFor` fallback documented and asserted: merged members must share one `normalizedAddressKey` or the buy refuses loudly.
- **m11** `planParcels` is best-fit-decreasing — smallest open box that still takes the unit.
- **m12** `Shipment.shippoShipmentId` populated from the quote's carrier shipment id.
- **m13** label buys no longer write `ShippingQuote` rows (`persist: false`); rate-lock rows remain the checkout path's record. Pinned by S4h (quote count 0).
- **m14** `ACTIVE_SHIPMENT_STATUSES` named export owns the `["PURCHASING","PURCHASED"]` set at both call sites.
- **m16** `AuditAction` extended in lockstep with `PackageEventAction` for the P8 events.
- **m17** banned standalone `result` renamed to `response` in `label-actions.tsx`.
- **m18** `carrierOf` renamed `normalizeCarrier`.

## Verification

- Gates: `lint` clean · `typecheck` clean · `migration-guard: ok (14 migrations, in sync)` · `test:unit` all pass · `test:domain` all pass (incl. new B1/M1/M2/M4/M5/M6/M9/m1/m11/m12/m13 checks) · `build` clean.
- Smoke: `smoke-p8.ps1` **30/30 PASS, 0 failures** against the production build — original S1–S3 plus new S4a–S4k legs pinning B1, M1, M2, M4, M5, M6, M9, m13 end-to-end over HTTP (fixture stats prove the carrier-call counts).
