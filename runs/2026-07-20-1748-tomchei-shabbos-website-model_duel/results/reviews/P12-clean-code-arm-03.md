# P12 Clean Code Review — arm-03

**Reviewer:** glm-5.2-high
**Workspace:** `arms/arm-03/workspace`
**Method:** codegraph index (333 files, 3,417 nodes) + targeted reads. Grep used only for literal class-string and pattern counts, not structural lookup.

## Summary

The codebase is well-factored at the file level — only one product file crosses the 500-line god-file line, and most lib modules are cohesive. The real debt is **pattern duplication across the API surface**: a shared admin handler exists but is too opinionated to reuse for 52 of 63 admin routes, so the permission-gate + body-parse + error-map boilerplate is hand-copied everywhere. A secondary thread is **UI button inconsistency**: a `Button` component exists but raw `<button>` nodes with repeated `rounded-md border border-border …` class strings outnumber it.

## Findings

| # | Category | Severity | Location | Finding |
|---|---|---|---|---|
| 1 | Duplicated logic | High | `app/api/admin/**` (63 routes) | `adminHandler` (`lib/api/admin-handler.ts`) captures the permission gate → open-season 409 → body parse → `ActionError` map, but only **11 of 63** admin routes use it. The other 52 hand-write `requirePermissionApi(...)` + `if ("response" in gate) return gate.response` + `safeParse(await request.json().catch(...))` + `Response.json({error},{status:400})`. Root cause: `adminHandler` hardcodes `getOpenSeason()` (409 when no season), so routes that operate outside an open season (refunds, bulk finalize, season management, media, staff, reconciliation) can't adopt it. Make the season gate opt-in (`requireSeason?: boolean`) and the helper covers ~50 more routes. |
| 2 | Duplicated logic | High | `lib/routes/service.ts`, `lib/repeat.ts`, `lib/shipping/labels.ts`, `lib/routes/print.ts` | The `addressOf(pkg)` shape mapper (`{ line1: pkg.addressLine1, line2: pkg.addressLine2, city, state, zip }`) is redefined in 4 lib modules. Rule of 2 satisfied long ago — promote to `lib/addresses/normalize.ts` (already exists) and import. |
| 3 | Inconsistent patterns | Medium | `components/**` (≈28 files) | Two button patterns coexist: `<Button>` (≈83 uses) and raw `<button className="rounded-md border border-border …">` (≈62 uses). The exact small-secondary string `rounded-md border border-border px-2 py-0.5 text-xs hover:bg-brand-soft disabled:opacity-50` appears 6× verbatim across `package-board`, `pickup-actions`, `shipment-actions`, `route-actions`, `fulfillment-actions`. Either extend `Button` with a `size="sm"` + `variant="secondary"` pair and migrate, or document that raw `<button>` is allowed for one-off sizes — right now both patterns compete. |
| 4 | God file (borderline) | Medium | `lib/routes/service.ts` (476 lines, 21 KB) | Under the 500-line trigger but mixes four concerns in one module: route building (`buildRoute`), day-of notifications (`captureDayOfNotifications`), stop delivery (`markStopDelivered`), and method-switch + reroute (`switchPackageMethod`, `rerouteSuggestions`, `confirmReroute`). Each is a distinct lifecycle with its own callers. Splitting into `lifecycle.ts` / `method-switch.ts` / `reroute.ts` would let each file drop below 200 lines and keep its test fixture close. Not urgent, but the next feature here will push it over. |
| 5 | God file (test) | Low | `scripts/smoke-p12.ts` (751 lines) | Single `main()` walks S1–S5 plus wipe/reseed. It's a smoke script, so the bar is lower, but the file is now the longest in the repo and the only one over 500 lines. Splitting per-scenario (`smoke-p12-reports.ts`, `…-recon.ts`, `…-legacy.ts`) with a shared `loadDotEnv` + evidence helper would make failures easier to localize. |
| 6 | Magic values | Low | `lib/routes/service.ts:15` | `REROUTE_RADIUS_MILES = 0.5` is named (good). But `LINK_COMPLETION_GRACE_MINUTES` is imported, while `BULK_LIMIT = 200` (`orders/bulk/route.ts`), `SHIPPO_TIMEOUT_MS`, and a few rate-limit windows are local literals with no central home. Minor — most are colocated with their use, which is fine. Flagging only because the routing and shipping modules each keep their own timeout constants. |
| 7 | Naming | Low | `lib/api/admin-handler.ts:13` | `AdminHandlerContext<P, B>` — `B` is a generic, not a standalone name, so the banned-vocabulary rule doesn't strictly apply, but `B` / `P` single-letter generics read less clearly than `Params` / `Body` would. Cosmetic. |
| 8 | Dead/defensive code | Low | `app/api/admin/orders/bulk/route.ts:57` | `message.includes("No Order found")` string-matches Prisma's `findUniqueOrThrow` error text to reword it. Fragile — a Prisma version bump or a non-English locale could change the message. Prefer catching the known Prisma code (`P2025`) via `Prisma.PrismaClientKnownRequestError` and emitting the plain "Order not found" string. |

## What's clean

- `lib/api/admin-handler.ts` itself is a tight, well-documented abstraction — the problem is purely its adoption, not its shape.
- `lib/routes/service.ts` comments explain *why* (guarded flips, idempotent completion, atomicity) rather than *what* — matches the comment-quality rule.
- No swallowed catches in the sampled routes; errors either map to `ActionError` or rethrow.
- `package-board.tsx` state management is simple (`useState` + a `run()` wrapper) — no premature state library.

## Net

`net: ~-180 lines possible` if findings 1 + 2 are applied (boilerplate removal dominates; the Button migration is roughly line-neutral). Findings 4–5 are structural, not line-count, wins.
