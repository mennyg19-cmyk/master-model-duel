# P9 Rules Review — arm-04 (blind)

**Phase:** P9 — Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling
**Arm rules graded:** ponytail, clean-code, workflow, vocabulary, codegraph
**Scope:** `arms/arm-04/workspace/` P9 additions (src/app/(admin)/admin/{routes,pickup,follow-up}, src/app/(driver)/{drive,driver}, src/app/api/cron/{pickup-expiry,payment-reminder}, src/lib/{routing,pickup,scheduling,cron}, prisma/schema/routes.prisma, scripts/smoke-p9.ts, tests/routes.test.ts)
**Method:** Findings only, no fixes. Blind to model name.

## Summary by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 5 |
| Info | 2 |

## Medium

### M1 — `startRoute` is not transactional, so the audit row can be lost
`src/lib/routing/route-service.ts:266-296`

`startRoute` performs `db.deliveryRoute.update` (status → IN_PROGRESS), then `notifyDayOf` (which writes `NotificationLog` rows via `queueCustomerMessage`), then `recordAudit` — all as separate DB operations with no surrounding transaction. If the DB fails between the update and the audit write, the route is marked IN_PROGRESS with no `route.started` audit row, breaking the invariant that every state change has an audit trail. The day-of notifications are idempotent (dedupeKey on package), so a retry is safe, but the audit gap is real. `buildRoute`, `assignDriver`, `markStopDelivered`, and `completeRoute` all correctly use `runInTransaction` for their state changes; `startRoute` is the outlier. The likely reason (notifyDayOf shouldn't sit in an open transaction across outbox writes) is valid, but the route-status update + audit could still be paired in one transaction before the outbox drain.

**Rules:** clean-code (Consistency — one error-handling approach; Error Handling — error messages say what went wrong AND expected state), workflow (Gate discipline — audit completeness).

### M2 — `nearbySuggestions` re-geocodes every shipping box on every route-detail render
`src/lib/routing/reroute.ts:196-245` called from `src/app/(admin)/admin/routes/[routeId]/page.tsx:57`

`nearbySuggestions` loads all in-season shipping boxes in `NEW`/`PRINTED`/`PACKED` with no route stop, then for each one calls `geocodeAddress` (a DB cache read, falling back to a Mapbox network call on miss). This runs on every render of the route detail page, including after every `revalidatePath` bounce from a server action. At Purim volume (hundreds of shipping boxes per season) this is N geocode lookups per page load with no memoization or caching of the suggestion list itself. The geocode cache absorbs repeated addresses, but the DB scan + per-box cache read + sort still runs every time. A route page that a manager reloads 20 times during a run does this 20 times. Consider caching the suggestion list per (route, short TTL) or computing it on demand via a button.

**Rules:** ponytail (shortest diff is fine, but repeated network-adjacent work on every render is the kind of cost the ladder is meant to flag), clean-code (Consistency — other list pages gate expensive queries behind a filter form).

## Low

### L1 — `endDriverSession` is exported with zero callers
`src/lib/routing/driver-session.ts:36-39`

`endDriverSession` is exported but grep across `src/` and `tests/` finds no callers. Dead code. The session cookie expires on its own (maxAge 24h) and link revocation handles the security exit. Delete it or add the caller that justifies it.

**Rules:** ponytail ("Deletion over addition", "No unrequested abstractions"), clean-code ("Dead code — delete, don't comment out").

### L2 — `orderLabel` formatting duplicated 3+ times
`src/lib/routing/route-view.ts:121`, `src/lib/pickup/pickup-service.ts:87`, `src/lib/scheduling/follow-up.ts:85`, `src/lib/scheduling/bulk-delivery.ts` (inline variant)

The expression `box.order.orderNumber === null ? box.order.draftReference : \`Order #${box.order.orderNumber}\`` (and the `Order #` variant) appears in at least four places with minor shape differences. This is a clean-code "duplicated logic" candidate for a single `orderLabel(order)` helper in `lib/orders/`. The Rule of 2 is satisfied (3+ call sites) and extraction would save more lines than it adds.

**Rules:** clean-code (Refactor categories — duplicated logic; Rule of 2 satisfied).

### L3 — Over-exported single-call-site constants
`src/lib/pickup/pickup-service.ts:35` (`PICKUP_HOLD_DAYS`), `src/lib/routing/reroute.ts:39` (`NEARBY_MILES`)

Both are `export const` but each has exactly one internal call site and neither is referenced in `tests/`. Exporting a constant implies an external contract that doesn't exist yet. Either add the test that justifies the export or drop the `export` until a second caller arrives.

**Rules:** ponytail ("No unrequested abstractions — Rule of 2"), clean-code (Dependency Discipline — every export has a reason).

### L4 — Over-exported single-use helpers
`src/lib/routing/geocode.ts:39` (`addressKeyOf`), `src/lib/routing/maps.ts:21` (`formatDestination`)

Both are `export function` but each is called only from within its own file. `formatDestination` is used at line 16 of the same file; `addressKeyOf` at line 44. Neither appears in tests. Drop the `export` or document the intended second caller.

**Rules:** ponytail (Rule of 2), clean-code (Abstraction Discipline).

### L5 — Missing `ponytail:` tag on a deliberate shortcut
`src/lib/routing/route-service.ts:154-162`

The nearest-neighbour ordering comment explains the shortcut well ("Not the shortest possible tour — that is a famously hard problem and a volunteer with a phone does not need one"), but the ponytail rule specifies a `ponytail:` comment tag on deliberate shortcuts so audits can find them. The comment is in the spirit of the rule but not in the agreed format.

**Rules:** ponytail ("`ponytail:` comment on deliberate shortcuts").

## Info

### I1 — `readFollowUpFilters` casts before validating
`src/lib/scheduling/follow-up.ts:42`

`const reason = (input.reason ?? '').trim() as FollowUpReason;` casts an arbitrary string to the union before the `FOLLOW_UP_REASONS.includes(reason)` check on line 45 narrows it. The runtime behaviour is correct (the includes guard works), but the cast is misleading to a reader. A `string`-typed intermediate would be clearer.

**Rules:** clean-code (Anti-AI-Tics — no redundant type assertions the compiler already guarantees; here the assertion is the opposite — it asserts something not yet guaranteed).

### I2 — `codegraph` adherence not verifiable from artifacts alone
The codegraph rule requires structural lookups to go through MCP/CLI when a `.codegraph/` index exists, and forbids Grep/SemanticSearch for symbols. The P9 code is well-structured and reuses existing helpers (`boardScopeWhere`, `recordAudit`, `runInTransaction`, `queueCustomerMessage`, `toAddressParts`, `readActiveSeason`, `requirePermission`) consistently, which suggests the contestant understood the codebase — but adherence to the grep-forbidden rule can only be confirmed from session transcripts, not from the final tree. No structural evidence of a violation (no "I grepped the whole tree" comments, no competing reimplementations of indexed helpers).

**Rules:** codegraph (unverifiable from artifacts).

## Rules not flagged

- **vocabulary** — Command words used in code/comments ("build", "switch", "reroute", "stamp", "sweep", "issue", "revoke") match the vocabulary table. No "refactor"/"tidy"/"rebuild" commands were issued mid-phase. New screens follow the "add" definition (new feature, existing patterns). No finding.
- **clean-code UI Consistency** — New admin pages reuse `Card`, `Button`, `Badge`, `FlashMessages`, `BackLink`, `Input`, `Label`, `Select` from the existing component library. Header pattern (`text-2xl font-semibold`) is consistent across all new pages. The driver pages intentionally diverge (documented in page comments: "no admin nav, no other van") which is a design requirement, not drift. No finding.
- **clean-code God files** — Largest P9 file is `route-service.ts` at 478 lines (under the 500 trigger). No file has badly mixed concerns. No finding.
- **clean-code Dependency Discipline** — No new packages added for P9. Hashing uses `node:crypto` (scrypt, randomBytes, timingSafeEqual), geocoding uses native `fetch`. Versions pinned. No finding.
- **clean-code Anti-Hallucination** — Google Maps directions URL (`https://www.google.com/maps/dir/?api=1&destination=...`) matches Google's documented universal directions format. Mapbox v6 endpoint and params (`address_line1`, `place`, `region`, `postcode`, `limit`) are plausible against current docs. No invented APIs observed in P9 code. No finding.
- **workflow Security Basics** — `.env.example` carries placeholders for every secret including the new `CRON_SECRET` and `MAPBOX_ACCESS_TOKEN`. Cron gate (`src/lib/cron/authorize.ts`) refuses every request when the secret is empty and uses `timingSafeEqual` for comparison. Driver token is 32 random bytes, stored as SHA-256; PIN is salted scrypt with `timingSafeEqual`. No secrets hardcoded or logged. No finding.
- **workflow Shell execution** — No PowerShell written by the contestant in P9 (all `.ts`/`.tsx`/`.sql`). N/A.
- **workflow Expectation Files** — `.scratch/phase-plan.md` is gitignored and not present in the tree; cannot verify the pre-build EXPECTED blocks. The smoke script `scripts/smoke-p9.ts` does encode verifiable expectations per stop and is green by construction. No finding from artifacts.
