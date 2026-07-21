# P9 Rules Review — arm-02

Reviewer: Rules specialist (blind to model name).
Scope: `arms/arm-02/workspace/` P9 surface — delivery routes, driver magic links, reroute, pickup, bulk delivery, crons.
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

H1. **`lib/routes/links.ts` `createRouteLink` — PIN hash write is non-atomic, and a failure silently downgrades a PIN-protected link to no-PIN.** The link is inserted with `pinHash: null` (lines 55-62), then `pinHash` is set in a separate `db.routeLink.update` outside any transaction (lines 65-67). `verifyPin` returns `{ ok: true }` when `pinHash` is null (line 96), so if the second write fails the PIN gate is bypassed for a link the manager believed was PIN-protected. Trust-boundary regression; violates `ponytail` "Never cut: Trust-boundary validation, security" and `workflow` Security Basics.

H2. **`lib/routes/service.ts` `confirmReroute` — label void + method switch happen outside the stop-creation transaction, so a failure between them leaves a package switched (and its label voided) but not on the route.** `switchPackageMethod` voids shipments before its own transaction (`service.ts` 266-268) and runs in a separate transaction from the `routeStop.create` (403-411). No outer transaction wraps the two. Data-loss / inconsistent-state risk; violates `ponytail` "Never cut: data-loss prevention" and `clean-code` Error Handling (errors must leave a describable expected state).

## Medium

M1. **`lib/routes/service.ts` is a god file by concern, not size.** 426 lines mixing four concerns: route build/order, route start + day-of notifications, stop delivery + route completion, method switch, reroute suggestions + confirm. `clean-code` says split when mixed concerns (Rule Preference: saves tokens vs one god file). Split by lifecycle stage.

M2. **Duplicated "distinct customers behind packages" logic.** `service.ts` `packageCustomers` (25-37), `pickup.ts` `sendPickupReadyNotifications` (63) and `pickupBoard` (89), and `bulk-delivery.ts` (32-35) each rebuild `new Map(lines.map(l => [l.order.customer.id, l.order.customer]))`. 3+ real call sites — extract a shared helper (`clean-code` duplicated logic category; Rule of 2 met).

M3. **Duplicated `orderRefs` expression.** `[...new Set(pkg.lines.map((line) => line.order.orderNumber ? \`#\${line.order.orderNumber}\` : line.order.draftReference))]` appears verbatim in `lib/routes/print.ts` `toPrintPackage` (49) and `lib/pickup.ts` `pickupBoard` (90). Two call sites, stable, but it is non-trivial and drifts silently — extract.

M4. **Warehouse origin is duplicated across two sources of truth.** `lib/routes/service.ts` `buildRoute` falls back to `{ latitude: 40.0821, longitude: -74.2097 }` (70) — the same centroid hardcoded as `"08701"` in `lib/addresses/geocode.ts` `ZIP_CENTROIDS` (13). `clean-code` type/schema drift + magic values; one named constant or setting should own it.

M5. **`components/admin/route-map.tsx` — `MapPoint.kind === "suggestion"` is wired into the type, color map, and the `stops` filter (29) but never produced.** `app/(admin)/admin/routes/[id]/page.tsx` only ever emits `"stop"`/`"delivered"` (52); reroute suggestions render as a separate `<ul>`, not map points. Dead branch + dead color entry — `ponytail` YAGNI / deletion over addition.

## Low

L1. **`lib/addresses/geocode.ts` `mapboxCoordinates(...).catch(() => null)` (71) swallows the Mapbox error with no log.** `clean-code` "No swallowed errors." A failed provider call is indistinguishable from "no result"; at minimum the failure should surface (log/detail) before falling back to local.

L2. **`components/driver/route-client.tsx` mixes a raw Tailwind color with the token system.** `bg-green-100` (129) alongside semantic tokens (`bg-surface`, `text-danger`, `border-border`, `bg-brand-strong`). `clean-code` UI Consistency / one styling approach.

L3. **Magic numbers inline in `components/admin/route-map.tsx`.** `width=640`, `height=360`, `pad=0.002`, radii `9`/`7`, `fontSize=9`, strokeWidth `2` (24-46). `clean-code` magic values — name the layout constants.

L4. **`lib/routes/geo.ts` uses single-letter `h` and `d`-style locals** (`distanceMiles`, 12-15) and `route-map.tsx` uses `x`/`y` as function names (26-27). `clean-code` bans vague standalone names; even geometric conventions read better as `haversineH` / `projectX`.

L5. **Timestamp formatting `new Date().toISOString().slice(0,16).replace("T"," ")` is repeated** in `lib/routes/print.ts` (64), `lib/pickup.ts` (106), and `app/(admin)/admin/routes/[id]/page.tsx` (83). Minor duplication; a `formatStamp` helper would centralize it.

L6. **`lib/routes/service.ts` `markStopDelivered` does not gate on route status.** A driver (or staff) can mark a stop delivered while the route is still `PLANNED` — `startRoute` is never required. Not a rules-text violation, but a silent business-rule choice; `workflow` "Never silently choose business logic — log in DECISION-LOG and flag." No DECISION-LOG entry found for this.
