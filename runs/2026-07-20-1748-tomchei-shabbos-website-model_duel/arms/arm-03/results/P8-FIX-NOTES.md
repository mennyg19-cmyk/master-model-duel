# P8 fix notes — arm-03

## Blockers fixed

| # | Fix |
|---|---|
| B1/B6 | Removed `LabelError`. Labels throw `ApiError`; routes only call `apiErrorResponse` (client-safe status/message; other errors `maskError`). Label audits go through `writeAudit` + `labelAuditMeta`. |
| B2/B3 | Shared `planToParcels` / `resolveParcelsForItems` — checkout `resolveDeliveryFeesLive` and label purchase both multi-parcel quote via `quoteMargin({ parcels })`. |
| B4 | `buyLabel(rateId, idempotencyKey)`; `ShippingLabel.idempotencyKey` unique; partial unique on `packageId` WHERE `PURCHASED`; void clears key for re-buy. |
| B5 | `buildCheckoutSnapshot()` shared by `prepareCheckout` and `createHostedCheckoutSession` (`fees`, `liveShip`, `shipQuotes`, totals, `capturedAt`). |

## Also

- Label routes season-scoped via `getCurrentSeason()` + `order.seasonId` / `seasonId` on create/void/refresh.

## Verify

- `npx prisma migrate deploy` + `npx prisma generate`
- `npm run smoke:p8`
