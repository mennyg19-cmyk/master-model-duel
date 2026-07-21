# P9 Clean-code review — arm-02

**Phase:** P9 (delivery routes, driver magic links, reroute, pickup, bulk delivery)
**Scope:** `arms/arm-02/workspace/` — `lib/routes/*`, `lib/pickup.ts`, `lib/bulk-delivery.ts`, `app/api/admin/routes/**`, `app/api/d/[token]/**`, `app/api/admin/pickup/**`, `app/api/cron/**`, `app/(admin)/admin/routes/**`, `app/(admin)/admin/pickup/**`, `app/(admin)/admin/follow-up/**`, `components/admin/{route-actions,route-map,pickup-actions,bulk-delivery-form}.tsx`, `components/driver/route-client.tsx`, `app/d/[token]/page.tsx`.
**Rule:** `arms/arm-02/rules/clean-code.md`. Findings only, no fixes. Blind to model name.

## Summary

The P9 surface is cohesive and well-commented (intent + rule refs, not narration). The main weakness is **repeated handler/action boilerplate** that already meets the Rule of 2 across many call sites, plus a couple of concern-mismatched functions and one duplicated constant.

## Findings

### HIGH

**H1 — Admin route-handler boilerplate duplicated across 8+ files.**
Every admin POST/PATCH/GET in `app/api/admin/routes/route.ts`, `routes/[id]/route.ts`, `routes/[id]/link/route.ts`, `routes/[id]/start/route.ts`, `routes/[id]/reroute/route.ts`, `routes/[id]/print/route.ts`, `routes/[id]/stops/[stopId]/delivered/route.ts`, `packages/[id]/method/route.ts`, `bulk-delivery/route.ts`, `pickup/ready/route.ts` repeats the same skeleton:
- `requirePermissionApi(...)` + `if ("response" in gate) return gate.response;`
- `getOpenSeason()` + `409 "No open season"`
- `schema.safeParse(await request.json().catch(() => null))` + 400
- `try { … } catch (error) { if (error instanceof ActionError) return …; throw error; }`

This is the "copy-paste with minor variations" anti-AI-tic the rule calls out. Rule of 2 is far exceeded; extract a handler wrapper / `withRouteMutation` helper.

### MEDIUM

**M2 — `useAct` hook re-implemented inline in 3 other components.**
`components/admin/route-actions.tsx` defines a clean `useAct()` (busy/message/try-finally + `router.refresh`). The same busy/message/try-finally pattern is hand-rolled inline in `components/admin/pickup-actions.tsx` (`PickupReadySweepButton`, `PickedUpStampButton`), `components/admin/bulk-delivery-form.tsx`, and `components/driver/route-client.tsx` (`DriverPinForm`, `DriverRouteActions`). The hook is not exported for reuse; the pattern is duplicated 5+ times.

**M3 — Driver API access-check + ActionError try/catch duplicated.**
`app/api/d/[token]/start/route.ts` and `…/stops/[stopId]/delivered/route.ts` both repeat:
```
const access = await resolveDriverAccess(token);
if (!access.ok) {
  const status = access.reason === "pin_required" ? 401 : 404;
  return Response.json({ error: "…" }, { status });
}
try { … } catch (error) { if (error instanceof ActionError) …; throw error; }
```
Two real call sites now; the `pin_required → 401` mapping is the kind of detail that drifts when duplicated.

**M4 — `switchPackageMethod` lives in `lib/routes/service.ts` but is a package-level operation.**
It is called from `app/api/admin/packages/[id]/method/route.ts` and is about a package's fulfillment method, not a route. `service.ts` is a 426-line file mixing route build / start / stop-delivered / method-switch / reroute-suggest / reroute-confirm — method switch is the odd one out (concern split, not a line-count split).

**M5 — Two audit patterns coexist.**
Create / link / update / bulk-delivery / pickup-ready handlers call `writeAudit(gate.staff, {…})` from `lib/audit`. The route lifecycle (`startRoute`, `markStopDelivered`, `confirmReroute`, `switchPackageMethod`) writes `db.auditLog.create({…})` directly inside `lib/routes/service.ts`. Two audit approaches for the same `auditLog` table; the "one error-handling/audit approach per project" rule is violated.

**M6 — `STATUS_TONE` constant duplicated.**
Identical `const STATUS_TONE = { PLANNED: "neutral", IN_PROGRESS: "brand", COMPLETED: "success" } as const;` appears in `app/(admin)/admin/routes/page.tsx` and `app/(admin)/admin/routes/[id]/page.tsx`. Two call sites; extract to a shared route-status module.

**M7 — Button / input class strings repeated across admin components.**
`route-actions.tsx` defines module consts `button`, `smallButton`, `input`. `pickup-actions.tsx` redefines its own `button` string, and `bulk-delivery-form.tsx` repeats the same `rounded-md border border-border px-3 py-1.5 text-sm hover:bg-brand-soft disabled:opacity-50` and input strings inline. Inline-styles / repeated-class-strings category — the existing consts in `route-actions.tsx` are not shared.

**M8 — Address → `googleMapsUrl` argument built inline in 3+ places.**
`lib/routes/geo.ts` `googleMapsUrl({line1, city, state, zip})` is called from `lib/routes/print.ts` (`renderRouteSheet`), `app/(admin)/admin/routes/[id]/page.tsx` (stops table), and `app/d/[token]/page.tsx`, each re-shaping the Prisma package fields by hand. `lib/routes/service.ts` already has an `addressOf(pkg)` helper for the same shape — the page layers don't use it.

**M9 — Order-refs / customers-from-lines dedup patterns repeated.**
- `[...new Set(pkg.lines.map((line) => line.order.orderNumber ? \`#\${…}\` : line.order.draftReference))]` appears in `lib/routes/print.ts` (`toPrintPackage`) and `lib/pickup.ts` (`pickupBoard`).
- `new Map(pkg.lines.map((line) => [line.order.customer.id, line.order.customer]))` appears in `lib/pickup.ts` twice (`sendPickupReadyNotifications`, `pickupBoard`) and in `lib/bulk-delivery.ts` (slightly different shape). Rule of 2 met on both.

### LOW

**L10 — `rerouteSuggestions` best-match conditional is a dense 3-clause expression.**
`if (d <= REROUTE_RADIUS_MILES && (best === null || (best.distance !== null && d < best.distance) || best.distance === null))` mixes "first hit", "closer radius hit", and "promote same-street → radius" in one boolean. Readability only.

**L11 — `PackageAddress` vs `googleMapsUrl` address shape drift.**
`lib/routes/service.ts` `PackageAddress = { line1; line2?; city; state; zip }` vs `googleMapsUrl`'s `{ line1; city; state; zip }` (no `line2`) vs the inline shapes in pages. One canonical address shape would remove the friction.

**L12 — `buildRoute` geocodes sequentially.**
`for (const pkg of candidates) { const coordinates = await geocodeAddress(addressOf(pkg)); … }` runs N sequential network calls. Not a clean-code defect per se, but an obvious `Promise.all` candidate; flagged only because the rest of the file already favors batched Prisma calls.

**L13 — `delivered` count repeated.**
`route.stops.filter((stop) => stop.deliveredAt).length` is computed in both `routes/page.tsx` and `routes/[id]/page.tsx`. Trivial.

## Severity counts

- **HIGH:** 1
- **MEDIUM:** 8
- **LOW:** 4
- **Total:** 13
