# P9 Clean-Code Review — arm-04 (blind)

Scope: P9 delta in `arms/arm-04/workspace/` — new files under `src/lib/routing/` (`route-service.ts`, `route-view.ts`, `route-links.ts`, `reroute.ts`, `driver-session.ts`, `geocode.ts`, `maps.ts`, `paths.ts`, `route-print.ts`), `src/lib/pickup/` (`pickup-service.ts`, `pickup-print.ts`), `src/lib/scheduling/` (`bulk-delivery.ts`, `payment-reminder.ts`, `follow-up.ts`), `src/lib/cron/authorize.ts`, the route/driver/pickup/follow-up UI under `src/app/(admin)/admin/{routes,pickup,follow-up}/` and `src/app/(driver)/{drive/[token],driver}/`, the cron routes under `src/app/api/cron/{pickup-expiry,payment-reminder}/`, and `scripts/smoke-p9.ts`.
Findings only — no fixes. No model names; arm id only.

## Summary

- Major: 4
- Minor: 8

## Major

### M1 — `route-service.ts` is a mixed-concern god file
`src/lib/routing/route-service.ts` is 478 lines (under the 500 trigger) but trips the "mixed concerns" trigger in `clean-code.mdc` (split when >500 lines **or mixed concerns**). It owns nine distinct concerns: candidate listing (`listRouteCandidates` + `routableDeliveryWhere`), route building (`buildRoute`), the stop-ordering algorithm (`orderStops` + `originPoint`), driver assignment (`assignDriver`), route starting (`startRoute` + `notifyDayOf`), stop delivery (`markStopDelivered`), route completion + link grace (`completeRoute` + `LINK_GRACE_MS`), and stop appending (`appendStop`). `orderStops` is a pure nearest-neighbour algorithm with its own `PlacedStop` type and could live in `route-ordering.ts`; `notifyDayOf` is a notification concern that belongs next to `bulk-delivery.ts`; `appendStop` is only called from `reroute.ts` and could move there (rule of 2 — single caller). The file's header comment even narrates four separate UR/R/G tags, which is the smell. Splitting would give each file one verb, the way `shipping/` already splits `label-buy`/`label-void`/`label-track`.

### M2 — Cron job-body logging duplicated, and overlaps the `runCronJob` wrapper
`src/lib/pickup/pickup-service.ts:276-313` (`expireUnclaimedPickups`) and `src/lib/scheduling/payment-reminder.ts:23-90` (`sendPaymentReminders`) implement the same try/create-`cronRunLog`/update-on-success/update-on-failure/rethrow shape. Both: `db.cronRunLog.create({ jobName })`, try block, on success `update({ status: 'SUCCEEDED', finishedAt, itemsProcessed, detail })`, on catch `update({ status: 'FAILED', finishedAt, detail: { message } })`, then `throw`. ~25 lines duplicated verbatim. Worse, `src/lib/cron/authorize.ts:43-56` `runCronJob` **also** wraps the handler in a try/catch and `console.error`s failures — so a failing job is caught twice and logged twice (once to `CronRunLog` by the body, once to console by the wrapper). The wrapper owns the HTTP envelope; the body owns the run row; neither owns the contract between them. A shared `runCronJobBody(jobName, fn)` that creates the row, runs the body, and writes the terminal status — with the wrapper only doing auth + HTTP — would collapse both files and remove the double catch.

### M3 — `orderLabel` formatting duplicated four times with case drift
The expression `order.orderNumber === null ? order.draftReference : \`Order #${order.orderNumber}\`` (or its `order #` variant) appears at:
- `src/lib/routing/route-view.ts:121` — `Order #${box.order.orderNumber}`
- `src/lib/routing/reroute.ts:240` — `Order #${box.order.orderNumber}`
- `src/lib/pickup/pickup-service.ts:87` — `Order #${box.order.orderNumber}`
- `src/lib/scheduling/follow-up.ts:85` — `Order #${order.orderNumber}`

Plus a lowercase variant in `payment-reminder.ts:48` (`order #${order.orderNumber}`). `clean-code.mdc` names "duplicated logic — pull into `lib/` helpers" and "type/schema drift — single source of truth." A `formatOrderLabel(order: { orderNumber: number | null; draftReference: string })` helper in `lib/orders/` (or `lib/core/labels.ts`) would collapse five call sites and make the `Order #` vs `order #` casing one decision instead of two.

### M4 — Action-layer boilerplate duplicated and vaguely named
Three server-action files repeat the same flash-redirect plumbing with vague names banned by `clean-code.mdc` ("No vague names … `data`, `result`, `info`, `temp`, `val`, `item`, `thing` are banned as standalone names" — the list is exemplary, not exhaustive).

- `src/app/(admin)/admin/routes/actions.ts:265-276` — `doneAtRoute`, `backToRoute`, `backToHub` (3 helpers).
- `src/app/(admin)/admin/pickup/actions.ts:57-63` — `done(notice)` and `back(problem)`. `done` and `back` are verbs that don't say where the redirect goes or what the flash key is; the reader has to follow the body to learn it redirects to `PICKUP_PATH`.
- `src/app/(driver)/drive/[token]/actions.ts:64-66` — `backToDriver`.

Each file also re-implements `workingSeasonId()` (`routes/actions.ts:258-263`, `pickup/actions.ts:50-55`) — same `readActiveSeason` + redirect-with-problem-on-missing, differing only in the redirect target. And the "no season" early-return JSX block is duplicated verbatim across `routes/page.tsx:35-44`, `pickup/page.tsx:30-39`, and `follow-up/page.tsx:30-39` — same `<h1>` + muted paragraph + `data-testid="{slug}-no-season"`. A shared `<NoSeason slug="…" message="…" />` component and a `requireWorkingSeasonOrRedirect(path)` helper would remove all of it.

## Minor

### m1 — `itemCount` reduce duplicated
`box.lines.reduce((count, line) => count + line.quantity, 0)` appears at `src/lib/routing/route-view.ts:118` and `src/lib/pickup/pickup-service.ts:88`. Rule of 2 says extract; a `sumLineQuantities(lines)` helper (or a `lineCount` field on a shared package view) would dedupe.

### m2 — Address-line string built three ways
`[line1, city, postalCode].filter(Boolean).join(', ')` at `route-service.ts:65-67` (candidate destination) and `reroute.ts:236` (suggestion addressLine), plus the fuller `[line1, line2, city, state+postalCode].filter(...).join(', ')` at `route-view.ts:111-115` (stop addressLine). Three close variants of the same formatter; a `formatAddressLine(address: AddressParts, { withState }?)` would consolidate.

### m3 — `<select>` is raw HTML while `<Input>`/`<Label>` are components
`src/app/(admin)/admin/routes/page.tsx:112-124` and `:191-203`, `src/app/(admin)/admin/routes/[routeId]/page.tsx:157-169`, and `src/app/(admin)/admin/follow-up/page.tsx:56-69` all hand-write `<select className="mt-1 rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm">`. The same project componentizes `<Input>` and `<Label>` from `@/components/ui/field`. `clean-code.mdc` UI Consistency: "New screens must reuse existing header, theme, and navigation patterns" and Consistency: "one styling approach per project." A `<Select>` sibling to `<Input>` (or at minimum a shared `selectClass` constant) would remove four copies of the class string and the pattern drift.

### m4 — `expireUnclaimedPickups` bypasses `pickupWhere(seasonId)`
`src/lib/pickup/pickup-service.ts:38` exports `pickupWhere(seasonId)` and every other read/write in the file scopes through it (`listPickupCounter`, `sendPickupReady`, `stampPickedUp`, `listUnclaimedPickups`). `expireUnclaimedPickups` at `:280-288` instead uses a bare `{ fulfillmentMethod: { kind: 'PICKUP' }, pickedUpAt: null, … }` with no season scope — it sweeps every season globally. That is plausibly intentional (a global cron), but the helper exists and is deliberately not used, which is pattern drift. Either a named `pickupWhereGlobal()` variant or a comment on the cron explaining the cross-season scope would make the choice visible.

### m5 — `readRoute` called with two different scoping contracts
`src/lib/routing/route-view.ts:67` `readRoute(where: Prisma.DeliveryRouteWhereInput)` is called with `{ id, seasonId }` at `routes/[routeId]/page.tsx:48` and `route-print.ts:31`, but with bare `{ id: link.routeId }` at `drive/[token]/page.tsx:82`. The admin path season-scopes; the driver and print paths do not. Same function, two scoping assumptions. If the link row is the only credential needed to authorize the route, that is fine — but the contract should be explicit (e.g. `readRouteForAdmin` vs `readRouteForLink`) or the season scope should be pushed into the caller so the function has one job.

### m6 — `PickupRow.packed` and `PickupRow.inStock` are dead view-model fields
`src/lib/pickup/pickup-service.ts:42-58` declares `PickupRow` with `packed: boolean` and `inStock: boolean`, both computed at `:89-90`. `src/app/(admin)/admin/pickup/page.tsx` reads neither — it only consumes `blockedBy` (which combines both). Dead fields on a view model are dead code per `clean-code.mdc` ("Dead code — delete, don't comment out"). Either render them (the original intent, given the type) or drop them.

### m7 — `geocodeAddress` swallows Mapbox errors silently
`src/lib/routing/geocode.ts:125-130` wraps `askMapbox` in `try { … } catch { return null; }`. The comment explains the intent (a down geocoder must not stop a route build), but the catch writes nothing to logs — a real Mapbox outage looks identical to a not-found. `clean-code.mdc`: "No swallowed errors (empty catch blocks)." A `console.warn` (or a returned `{ point: null, source: 'mapbox-error' }` distinguishable from `'mapbox'` not-found) would let ops tell the two apart.

### m8 — `reroute.ts` mixes three concerns
`src/lib/routing/reroute.ts` (339 lines) owns method switching (`switchFulfillmentMethod`), nearby-box suggestion generation (`nearbySuggestions` + `nearestStop`), and the reroute-onto-route orchestration (`rerouteOntoRoute`). Three distinct features sharing one file; `nearbySuggestions` is a read model that belongs next to `route-view.ts`, and `switchFulfillmentMethod` is a package-level mutation that belongs next to the P8 label service. Under the 500-line trigger but trips "mixed concerns."

## Notes (not findings)

- Comments across the P9 delta are uniformly good — they explain WHY (domain intent, G/R/UR tags, trade-offs like the 15-minute link grace, the carrier-call-before-transaction rule), never WHAT. The `route-links.ts:11-26` header on the three properties of a driver link is exactly the non-obvious-constraint kind of comment `clean-code.mdc` asks for.
- `src/lib/routing/geocode.ts` keeping the offline stand-in deterministic and documented (`:18-22`, `:133-148`) — same house → same point, so the half-mile reroute rule is testable without Mapbox — is the right call and consistent with `ponytail.mdc` (no new dep when stdlib + a hash will do).
- `src/lib/routing/driver-session.ts` reusing the signed-cookie machinery from `auth/signed-cookie` rather than re-rolling a second signing scheme is exactly the "one pattern per concern" rule. The 24-hour max age shorter than the link lifetime is documented at `:17-18`.
- `src/lib/cron/authorize.ts` `secretsMatch` using `timingSafeEqual` with a length check before the comparison is the correct constant-time pattern (a bare `timingSafeEqual` on mismatched lengths throws).
- `scripts/smoke-p9.ts` driving the whole phase end-to-end over HTTP, with the offline geocoder making the reroute deterministic, is the right smoke posture — the test asserts behaviour, not implementation.
