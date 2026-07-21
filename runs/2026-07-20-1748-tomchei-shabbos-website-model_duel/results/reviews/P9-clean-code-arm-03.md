# P9 Clean-code review — arm-03

**Phase:** P9 (delivery routes, driver magic links, reroute, pickup, bulk delivery, crons)
**Scope:** `arms/arm-03/workspace/` — `lib/routes/{service,method-switch,geo}.ts`, `lib/pickup/{service,bulk}.ts`, `lib/cron/auth.ts`, `lib/notify/outbox.ts`, `app/api/admin/routes/**`, `app/api/admin/bulk-delivery/route.ts`, `app/api/admin/pickup/route.ts`, `app/api/admin/packages/[id]/method/route.ts`, `app/api/driver/[token]/route.ts`, `app/api/cron/**`, `app/(admin)/admin/routes/**`, `app/d/[token]/**`, `components/admin/{routes-admin,route-detail}.tsx`, `components/admin/` driver client.
**Rule:** `arms/arm-03/rules/clean-code.md`. Findings only, no fixes. Blind to model name.

## Summary

The P9 surface is readable and the magic-link/geo helpers are tight, but `lib/routes/service.ts` is a 892-line god file, the admin route handlers repeat the same skeleton across six files, and several domain expressions (`DELIVERY_CODES`, `recipientKey`, the completion transition, notification-capture boilerplate) are duplicated past the Rule of 2.

## Findings

### HIGH

**H1 — `lib/routes/service.ts` is a god file (892 lines, mixed concerns).**
The file mixes: crypto helpers (`hashToken`, `hashPin`), geocode ensure, route list/detail readers, route build + nearest-neighbor ordering, reassign, magic-link issue/load/verify-pin/start, day-of notifications, mark-stop-delivered + route completion, print route (text + greeting PDF + payload), reroute suggestions, reroute confirm (void + method switch + stop insert), printed-fallback deliver. `clean-code` god-file rule: split when `>500 lines` OR mixed concerns. Both hold. Split by lifecycle stage: `routes/build.ts`, `routes/links.ts`, `routes/start.ts`, `routes/stops.ts`, `routes/print.ts`, `routes/reroute.ts`.

### MEDIUM

**M2 — Admin route-handler boilerplate duplicated across six files.**
`app/api/admin/routes/route.ts`, `routes/[id]/route.ts`, `bulk-delivery/route.ts`, `pickup/route.ts`, `packages/[id]/method/route.ts`, `app/api/driver/[token]/route.ts` all repeat:
- `requirePermission("admin.access")` (+ `getCurrentSeason()` + 409 "No season")
- `schema.parse(await request.json())` (or `safeParse`) + implicit 400 on throw
- `try { … } catch (error) { return apiErrorResponse(error); }`

The driver route drops the permission gate (token-auth) but keeps the try/catch + parse skeleton. Rule of 2 far exceeded; extract a `withRouteMutation(handler)` wrapper (or reuse any existing one — none was found on the P9 surface).

**M3 — `markStopDelivered` and `markStopDeliveredFromPrint` duplicate the completion transition.**
`lib/routes/service.ts:549-583` and `861-889` each independently: `routeStop.count` pending → if 0, `deliveryRoute.update({ COMPLETED, completedAt, graceExpiresAt })` → `driverMagicLink.updateMany({ completedAt, graceExpiresAt })` → `writeAudit(ROUTE_COMPLETED)`. Two copies of the same non-trivial transition; the printed path adds `via: "printed_fallback"` to its audit. Extract `completeRouteIfDone(tx, routeId, actorId?, via?)`.

**M4 — `DELIVERY_CODES` set + `isDelivery` helper duplicated.**
`lib/routes/service.ts:23-42` and `lib/routes/method-switch.ts:8-16` each define the same `Set(["DELIVERY","BULK_DELIVERY","PER_PACKAGE_DELIVERY"])` and a near-identical `isDeliveryCode`/`isDelivery` predicate. Two sources of truth for the same domain constant; if a new delivery code is added it must be added in both. Lift to `lib/routes/codes.ts`.

**M5 — `recipientKey` fallback expression duplicated across five call sites.**
`customer?.emailNorm || customer?.phoneNorm || customer?.id || pkg.orderId` (and `|| orderId` variants) in `lib/routes/service.ts:467-471`, `lib/pickup/service.ts:68-69`, `lib/pickup/bulk.ts:25-26, 80-81, 168-169`. Five copies. Extract `customerRecipientKey(customer, fallbackId)`.

**M6 — `captureEmailAndSms` call boilerplate duplicated across five P9 paths.**
`sendDayOfNotifications`, `markPickupReadyIfEligible`, `scheduleBulkDelivery`, `runPickupExpiryCron`, `runPaymentReminderCron` each hand-build the same `{ templateKey, recipientKey, idempotencyBase, emailSubject, emailBody, smsBody, meta }` object. The shape is identical; only the strings differ. A `notifyCustomer({ template, recipient, base, vars, meta, actorId })` helper would cover all five and remove the per-call `recipientKey` duplication (M5).

**M7 — `confirmReroute` and `switchFulfillmentMethod` both void the label outside their transactions with the same comment-free pattern.**
`lib/routes/service.ts:757-764` and `lib/routes/method-switch.ts:64-70` both call `voidLabelForPackage` before a separate `$transaction`. Two copies of the same non-atomic void-then-mutate pattern, with no shared helper and no comment explaining why the void is outside the transaction. The non-atomicity is a behavior (security S7/S8), but the duplication is a clean-code concern: two sites doing the same risky thing independently.

**M8 — `googleMapsDeepLink` address shape built inline in pages vs. precomputed on stops.**
`lib/routes/geo.ts:20-39` defines the canonical address shape. `createRouteFromPackages` precomputes `mapsUrl` onto each `RouteStop` (good — pages just read `stop.mapsUrl`). But `route-detail.tsx` and `driver-client.tsx` each re-type a `Stop`/`RouteRow` shape with `addressLine1`, `city`, `state`, `postalCode` fields that mirror the model. The pages don't rebuild the URL (improvement over arm-02), but they hand-maintain the address shape in client types. `clean-code` type/schema drift.

### LOW

**L9 — `sameStreetCluster` normalizer is a dense one-liner chain.**
`lib/routes/geo.ts:65-71` — `.toLowerCase().replace(/…/g,"").replace(/[^a-z0-9]/g," ").replace(/\s+/g," ").trim()` then `replace(/^\d+\s+/, "")`. Five chained transforms; the intent (normalize street, drop house number) is clear but the regex soup is hard to verify. Extract `normalizeStreet(line1)` for readability and testability.

**L10 — Magic numbers inline in `lib/pickup/bulk.ts` and `lib/routes/service.ts`.**
`lib/routes/service.ts:374` `60_000` (PIN lock ms), `:373` `3` (fail threshold), `lib/pickup/service.ts:9` `7*24*60*60*1000` (pickup TTL), `:179` `3*24*60*60*1000` (unclaimed threshold), `lib/pickup/bulk.ts:73,206,219` `take: 200`/`100`. Name the policy constants (`PIN_LOCK_MS`, `PICKUP_TTL_MS`, `UNCLAIMED_AFTER_MS`, `CRON_BATCH_LIMIT`).

**L11 — `driver-client.tsx` and admin components mix raw Tailwind with the token system.**
`text-red-700`, `bg-white`, `shadow-sm`, `border`, `rounded` appear alongside `var(--color-forest)`, `var(--color-leaf)`, `var(--radius-md)`, `var(--font-display)`. `clean-code` UI Consistency / one styling approach. The token system exists; raw classes bypass it.

**L12 — `lib/routes/geo.ts` uses single-letter local `h`.**
`:14` `const h = Math.sin(dLat/2)**2 + …`. `clean-code` bans vague standalone names; `h` reads better as `haversineH`. Minor, geometric convention, but the rule is explicit.

**L13 — `printRoute` builds `printText`, `greetingPdf`, and `payload` in one function.**
`lib/routes/service.ts:590-659` — text rendering, PDF pagination (`paginate`/`renderPdf`/`CARD_5X7`), and JSON payload construction are three concerns in one function. Not a line-count split trigger on its own (the file is already H1), but the print concern is a clean candidate for `routes/print.ts`.

**L14 — `runPaymentReminderCron` re-checks `paymentStatusCached === "PAID"` after the query excludes PAID.**
`lib/pickup/bulk.ts:78` — `if (order.paymentStatusCached === "PAID") continue;` is dead; the query (70) selects only `["UNPAID","PARTIAL"]`. `clean-code` "No defensive code for conditions that can't happen" / `ponytail` "No 'just in case' code."

## Severity counts

- **HIGH:** 1
- **MEDIUM:** 7
- **LOW:** 6
- **Total:** 14
