# P9 Rules Review — arm-06

**Phase:** P9 — Delivery routes, driver magic links, reroute, pickup, bulk per `shared/phases/PHASE-P9-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P9
**Tree reviewed:** `arms/arm-06/workspace/` (`lib/routes/*`, `lib/pickup/*`, `lib/bulk/*`, `lib/payments/reminders.ts`, `lib/admin/follow-ups.ts`, `lib/notify/outbox.ts`, `lib/cron-auth.ts`, `app/api/drive/*`, `app/api/admin/routes/*`, `app/api/admin/pickup/*`, `app/api/admin/bulk-schedules/*`, `app/api/admin/packages/[packageId]/switch/*`, `app/api/cron/pickup-expiry/*`, `app/api/cron/payment-reminders/*`, `app/(admin)/admin/routes/*`, `app/(admin)/admin/bulk/*`, `app/(admin)/admin/pickup/*`, `app/(admin)/admin/packages/[packageId]/method-switch.tsx`, `app/(driver)/drive/[token]/*`, `prisma/schema.prisma`)
**Rules applied:** ponytail, clean-code, workflow, vocabulary, codegraph
**Blind:** model name not read; findings only, no fixes.

## Coverage (P9 EXPECTED checklist)

- [x] Mapbox route builder from delivery packages (geocode + cache) — `lib/routes/builder.ts`, `lib/routes/optimize.ts`, `lib/customers/geocode.ts`
- [x] Route admin list/detail/reassign/print; per-route greeting-card print — `app/(admin)/admin/routes/`, `lib/routes/print.ts`
- [x] Driver magic link: unguessable per-route URL, scoped, expires on completion, optional PIN, audit on every Delivered tap; mobile stop cards, start route, Google Maps deep links, printed fallback — `lib/routes/links.ts`, `lib/routes/lifecycle.ts`, `app/api/drive/[token]/*`, `app/(driver)/drive/[token]/*`
- [x] Method switch shipping ↔ delivery, charge preserved + audit; map reroute with manager confirm, void printed-not-shipped label, day-of notification on route start — `lib/routes/switch.ts`, `lib/routes/reroute.ts`, `app/api/admin/routes/[routeId]/reroute/*`, `app/api/admin/packages/[packageId]/switch/*`
- [x] Pickup: eligibility from inventory, ready notification, door list, unclaimed report, pickup-expiry cron (bearer auth) — `lib/pickup/readiness.ts`, `app/api/admin/pickup/*`, `app/api/cron/pickup-expiry/*`
- [x] Bulk delivery scheduling with email + SMS; follow-up call-center filters; payment-reminder cron — `lib/bulk/schedule.ts`, `lib/admin/follow-ups.ts`, `lib/payments/reminders.ts`, `app/api/cron/payment-reminders/*`

All five EXPECTED checklist items and all five smoke checks (S1–S5) have corresponding code paths.

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR

**M1 — Magic stage literal `"SENT"` hardcoded in reroute paths.** `lib/routes/builder.ts:270` (`stage: { not: "SENT" }`) and `lib/routes/reroute.ts:53` (`pkg.stage === "SENT"`) hardcode the SHIPPED method's terminal stage name, while the rest of P9 resolves the terminal stage dynamically via `pkg.fulfillmentMethod.terminalStage` (see `lib/routes/lifecycle.ts:198`). If the SHIPPED method's terminal stage is ever renamed, the SENT exclusion silently breaks and SENT packages become reroute-eligible. `clean-code.mdc` (Magic values — named constants/enums; type/schema drift — centralize). Recommend referencing the method's `terminalStage` field instead.

**M2 — Reroute read model split across two files.** `nearbyShippedSuggestions` (the reroute candidate scan) lives in `lib/routes/builder.ts:258`, while its write-side counterpart `confirmRouteReroute` lives in `lib/routes/reroute.ts`, which imports the read function back across the boundary. `clean-code.mdc` / `ponytail.mdc` (split files by concern, not by line count). The reroute concern is split between two modules; the reroute read model would sit more naturally beside the write model in `reroute.ts` (or a shared `reroute-queries.ts`).

**M3 — Banned standalone name `result` in P9 call sites.** `clean-code.mdc` (Naming Conventions) bans `result` as a standalone name. It appears in `lib/bulk/schedule.ts:63` (`const result = await prisma.$transaction(...)`), `lib/routes/lifecycle.ts:172` (`const result = await prisma.$transaction(...)`), and the API/client wrappers (`app/api/admin/routes/route.ts:35`, `app/(admin)/admin/packages/[packageId]/method-switch.tsx:55`, `app/(admin)/admin/routes/[routeId]/route-actions.tsx:52`, `app/(driver)/drive/[token]/drive-app.tsx` at each `apiFetch`). This is an established project-wide convention (`apiFetch` callers everywhere use `result`), so it conflicts with the "one pattern per concern" rule; flagging per the explicit naming ban. Low harm given consistency.

**M4 — `startRoute` attaches only the first order id to a multi-order customer notification.** `lib/routes/lifecycle.ts:144` sets `orderId: [...entry.orderIds][0]` for the day-of notification when a customer has packages spanning multiple orders on the route. The `OutboxMessage.orderId` is nullable and used for linkage/audit; a customer with N orders on the run gets one notification linked to only one of those orders. The grouping itself is correct (one notice per customer), but the order linkage is lossy. Minor — does not violate an EXPECTED item, but the audit trail for the other N−1 orders' day-of notice is indirect.

**M5 — `hasAvailableInventory` reads outside the readiness transaction.** `lib/pickup/readiness.ts:67-68` calls `hasAvailableInventory(pkg)` (default `prisma` client) before opening the per-package `$transaction` that stamps `pickupReadyAt` and sends the notification. A restock arriving between the check and the stamp would still produce a correct ready stamp, but a concurrent allocation that takes inventory negative between check and stamp could mark a package ready whose inventory is no longer available. Low-likelihood TOCTOU for a cron sweep; `ponytail.mdc` "Never cut trust-boundary validation" does not require a transaction here, but tightening would be safer.

**M6 — `loadLinkByToken` does not clear `pinFailures`/`pinLockedUntil` on a successful token load.** `lib/routes/links.ts:104-113` returns `active` without resetting PIN failure state on a valid token lookup. `checkPin` resets on a correct PIN (line 144), so a PIN-protected link that loads successfully but whose PIN cookie is already valid never touches `checkPin` and the counters stay as-is. Not a security issue (the lock still expires), but stale `pinFailures` from a previous forwarded-link attack can persist on an active session. Minor.

## Severity summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 6 |

All P9 EXPECTED checklist items and smoke checks (S1–S5) have corresponding implementations. No blocker or major rule violations. The six minor findings are naming/magic-value/concern-split hygiene plus two low-likelihood TOCTOU/staleness items; none block the P9 gate.
