# P10 Security Review — arm-02 (blind)

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Scope:** `arms/arm-02/workspace/` P10 surface only (seasons, repeat orders, replacement mappings, season auto-flip cron).
**Reviewer focus:** trust boundaries, auth, secrets, IDOR, injection.
**Method:** findings only — no fixes. No new scope beyond P10.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |
| Info | 2 |

Auth posture is solid: staff routes gate on `requirePermissionApi("…")`, the customer repeat endpoint verifies source-order ownership + FINALIZED and re-derives the plan server-side, replacement links require an active successor and reject cycles, the cron is POST + bearer-secret with `timingSafeEqual` and is disabled when no secret is set, and every mutation writes an audit row. No injection or IDOR found. The findings below are integrity/availability gaps.

## Findings

### M-1 — Bulk repeat TOCTOU race creates duplicate POS drafts
`app/api/admin/repeat/bulk/route.ts:53-68` reads `findActiveDraft(season.id, posDraftOwner(customerId))` and skips customers who already have a draft, then calls `repeatOrderIntoPosDraft` → `appendToDraft` (`lib/repeat.ts:305-318`), which does its own `findActiveDraft` + `saveDraft`. None of this is wrapped in a transaction or guarded by a unique constraint. Two concurrent bulk invocations (double-click, two staffers, or a bulk run racing a single-order repeat) can both observe "no draft" and both create one, or both append the same lines, producing duplicate POS drafts / duplicate cart lines for the same customer. `orders.manage`-gated, so integrity not privilege, but duplicates can slip into checkout unnoticed.

### M-2 — `appendToDraft` cart append is a lost-update race
`lib/repeat.ts:305-318` reads the existing draft cart, appends `newLines`, and calls `saveDraft` with no optimistic-concurrency version check and no transaction spanning the read+write. Concurrent appends (two repeats, or a staff bulk repeat racing a customer adding to their own storefront cart) can clobber each other — last write wins, silently dropping the customer's in-progress cart lines. Integrity/availability gap on the customer's own draft.

### L-1 — Bulk repeat is an unbounded work amplifier with no rate limit
`app/api/admin/repeat/bulk/route.ts` loops up to `BULK_LIMIT=200` customers. For each it calls `loadRepeatableOrder` (with line/option/addOn includes) and `repeatOrderIntoPosDraft` → `buildRepeatPlan`, which issues a full `db.product.findMany` of the entire catalog across all seasons and builds a `Map` (`lib/repeat.ts:152-159`). One request can therefore do up to 200 full-catalog scans + 200 order loads + 200 draft lookups/saves synchronously, with no rate limit on the admin endpoint. Admin-gated, but a single request can pin the DB. Low.

### L-2 — Shared "direct" rate-limit bucket for `/api/repeat`
`app/api/repeat/route.ts:34` + `lib/rate-limit.ts:28-37`: when `TRUST_PROXY` is unset (the documented dev/single-node default), `clientIp()` returns `"direct"` for every direct customer, so all direct customers share a single 20/60s bucket. One abuser — or just several legitimate customers repeating at once — can exhaust the bucket for everyone, blocking the endpoint globally. Cross-customer availability/fairness gap.

### L-3 — Replacement cycle check + repeat plan load the entire product table
`app/api/admin/products/[id]/route.ts:49-52` and `lib/repeat.ts:152-159` both call `db.product.findMany` with no `where`/pagination to build the chain map. As the catalog accumulates across seasons this is unbounded memory/DB load on every product PATCH and every repeat-plan build (including inside the bulk loop, compounding L-1). Low.

### L-4 — Per-process in-memory rate limiter resets on restart and weakens under scaling
`lib/rate-limit.ts` documents this itself; P10's `/api/repeat` is the new consumer that depends on it for anti-abuse. A restart clears every bucket, and each instance gets its own window, so the effective limit becomes `limit × instance_count`. Low (pre-existing, noted because P10 now relies on it).

### I-1 — Season schedule accepts past `opensAt`/`closesAt`
`app/api/admin/seasons/route.ts:30-32` and `app/api/admin/seasons/[id]/route.ts:25-27` enforce `closesAt > opensAt` but not that the times are in the future. A manager can set a past `opensAt`; the next cron tick immediately opens that season and closes the currently-open one, audited as `season.autoflip.open` rather than a manual `season.status` change — blurring deliberate vs. scheduled transitions. `settings.manage`-gated; audit-integrity only.

### I-2 — Customer repeat has no per-customer draft cap or replay guard
A signed-in customer can POST `/api/repeat` repeatedly (within the 20/60s limit) and keep appending the same order's lines to their draft, inflating it across requests without bound. Only their own cart, rate-limited, no payment — low impact. Info.

## Out of scope (noted, not scored)

- Customer repeat re-derives `buildRepeatPlan` server-side and checks `order.customerId === customer.id` + `status === "FINALIZED"` with an identical 404 for foreign/unknown ids (`app/api/repeat/route.ts:46-50`) — no IDOR, anti-probing present.
- `buildRepeatCartLines` validates every `decision.productId` against the active target-season candidate set (`lib/repeat.ts:267-282`) — no cross-season / inactive-product injection; client mapping is never trusted.
- All DB access is Prisma parameterized — no SQL injection surface.
- `requireCronAuth` (`lib/cron.ts`) uses POST, `timingSafeEqual` with a length guard, and 503s when `CRON_SECRET` is unset — sound secret boundary.
- Staff endpoints (`/api/admin/seasons`, `/api/admin/seasons/[id]`, `/api/admin/season-status`, `/api/admin/orders/[id]/repeat`, `/api/admin/repeat/bulk`) all gate on `requirePermissionApi` and write audit rows.
- Replacement link requires `replacement.isActive`, rejects self-links, and rejects cycles via `wouldCreateReplacementCycle` (`app/api/admin/products/[id]/route.ts:27-54`) — stronger than the arm-01 baseline.
- Customer/staff cookies are `httpOnly` + `SameSite=lax` — cross-site POST CSRF largely mitigated.
