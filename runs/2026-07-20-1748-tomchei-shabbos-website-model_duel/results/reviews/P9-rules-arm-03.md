# P9 Rules Review — arm-03

Reviewer: Rules specialist (blind to model name).
Scope: `arms/arm-03/workspace/` P9 surface — delivery routes, driver magic links, reroute, pickup, bulk delivery, crons.
Rules graded: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph` (grill-protocol out of scope for a build phase).

Findings only. No fixes.

## Summary

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 5 |
| Low | 6 |
| **Total** | **13** |

## High

H1. **`lib/routes/service.ts` is a god file by size and by concern.** 892 lines mixing: token/PIN hashing, geocode ensure, route list/detail, route build + nearest-neighbor order, reassign, magic-link issue/load/verify-pin, start route + day-of notifications, mark stop delivered + route completion, print route (text + greeting PDF + payload), reroute suggestions, reroute confirm (void + method switch + stop insert), printed-fallback deliver. `clean-code` says split when `>500 lines` OR mixed concerns (Rule Preference: saves tokens vs one god file). Both thresholds are met. Split by lifecycle stage (build / link / start+notify / stop / print / reroute).

H2. **`issueMagicLink` does not revoke prior active links on rotation.** EXPECTED S1 names "rotation revokes prior links" as a security gate; the code creates a new link and leaves all prior active links live. Trust-boundary regression; violates `ponytail` "Never cut: Trust-boundary validation, security" and `workflow` Security Basics.

## Medium

M1. **Duplicated `DELIVERY_CODES` set.** `lib/routes/service.ts:23-27` and `lib/routes/method-switch.ts:8-12` both define `new Set(["DELIVERY","BULK_DELIVERY","PER_PACKAGE_DELIVERY"])` with their own `isDelivery`/`isDeliveryCode` helper. Two copies of the same domain constant + predicate. `clean-code` duplicated logic category; Rule of 2 met.

M2. **Duplicated `recipientKey` fallback expression.** `customer?.emailNorm || customer?.phoneNorm || customer?.id || pkg.orderId` (and `|| orderId` variants) appears in `lib/routes/service.ts:467-471`, `lib/pickup/service.ts:68-69`, `lib/pickup/bulk.ts:25-26, 80-81, 168-169`. 5 call sites. Extract a `customerRecipientKey(customer, fallback)` helper. `clean-code` duplicated logic; Rule of 2 far exceeded.

M3. **Duplicated notification-capture boilerplate across five P9 paths.** `sendDayOfNotifications`, `markPickupReadyIfEligible`, `scheduleBulkDelivery`, `runPickupExpiryCron`, `runPaymentReminderCron` each hand-build `captureEmailAndSms({ templateKey, recipientKey, idempotencyBase, emailSubject, emailBody, smsBody, meta })` with near-identical shape. `clean-code` copy-paste with minor variations; a `notifyCustomer(template, recipient, base, ctx)` helper would cover all five.

M4. **Missing `.scratch/phase-plan.md` and `.scratch/run-state.md`.** P9 is a multi-todo phase in a multi-phase rebuild; `workflow.mdc` Expectation Files requires a rolling `.scratch/phase-plan.md` with an EXPECTED block per todo written before building, and Run checkpoint requires `.scratch/run-state.md`. `ls arms/arm-03/workspace/.scratch/` shows only smoke artifacts (`PHASE-P9-SMOKE.md/json`); the pre-build expectation trail the rule mandates is absent. `workflow` gate discipline.

M5. **`markStopDelivered` and `markStopDeliveredFromPrint` duplicate the route-completion transition.** `lib/routes/service.ts:549-583` and `861-889` each independently: count pending → set `COMPLETED`/`completedAt`/`graceExpiresAt` → `driverMagicLink.updateMany` → `ROUTE_COMPLETED` audit. Two copies of the same state transition; `clean-code` duplicated logic + inconsistent-pattern risk (one path writes `via: "printed_fallback"`, the other doesn't).

## Low

L1. **`lib/address/geocode.ts` is a deterministic offline geocoder but `lib/routes/geo.ts` and the route builder treat results as if Mapbox-grade.** `geocodeAddress` returns `latitude: 24 + (zip % 2500)/100` — a synthetic centroid from ZIP digits. `createRouteFromPackages` then runs nearest-neighbor ordering on these synthetic points. The ordering is deterministic but geographically meaningless. Not a rules-text violation, but `workflow` "Never silently choose business logic — log in DECISION-LOG and flag" — no DECISION-LOG entry records that route ordering is ZIP-hash-based, not real geography.

L2. **Magic numbers inline.** `lib/routes/service.ts:30` `NEARBY_MI = 0.5` (named, good), but `:374` `60_000` lock ms, `:373` `failCount >= 3` threshold, `lib/pickup/service.ts:9` `7*24*60*60*1000` TTL, `:179` `3*24*60*60*1000` unclaimed threshold, `lib/pickup/bulk.ts:73,206,219` `take: 200`/`100` are all inline. `clean-code` magic values — name the policy constants.

L3. **`lib/routes/geo.ts` uses single-letter / vague locals.** `h` (haversine result, :14), `dLat`/`dLon` (ok), `na`/`nb`/`streetA`/`streetB` in `sameStreetCluster` (:72-77). `clean-code` bans vague standalone names; `h` reads better as `haversineH`.

L4. **`driver-client.tsx` and admin components mix raw Tailwind with the token system.** `text-red-700`, `bg-white`, `shadow-sm`, `border`, `rounded` appear alongside `var(--color-forest)`, `var(--color-leaf)`, `var(--radius-md)`, `var(--font-display)`. `clean-code` UI Consistency / one styling approach. The token system exists; raw classes bypass it.

L5. **`vocabulary`: `Stop` type hand-defined in `driver-client.tsx` mirrors `RouteStop`.** A client-local type duplicates the prisma model shape; will drift if the model gains a field. `clean-code` type/schema drift — colocate or `Pick` from a shared route-stop type.

L6. **`runPaymentReminderCron` re-checks `paymentStatusCached === "PAID"` after a query that excludes PAID.** `lib/pickup/bulk.ts:78` — defensive code for a condition the query (70) already excludes. `clean-code` "No defensive code for conditions that can't happen" / `ponytail` "No 'just in case' code."
