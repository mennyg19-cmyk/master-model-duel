# P10 Security Review — arm-06 (blind)

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Scope:** `lib/seasons/manage.ts`, `lib/seasons/queries.ts`, `lib/repeat/{plan,create,chain,matcher,bulk-history,import-hook}.ts`, `lib/orders/repeat.ts`, `lib/orders/drafts.ts`, `lib/orders/resolve-lines.ts`, `lib/audit.ts`, `lib/cron-auth.ts`, `app/api/cron/season-flip/route.ts`, `app/api/admin/seasons/route.ts`, `app/api/admin/seasons/[seasonId]/route.ts`, `app/api/admin/orders/[orderId]/repeat/route.ts`, `app/api/admin/repeat-bulk/route.ts`, `app/api/admin/import/legacy-orders/route.ts`, `app/api/orders/[orderId]/repeat/route.ts`, `app/(admin)/admin/seasons/*`, `app/(admin)/admin/orders/[orderId]/repeat/page.tsx`, `app/(admin)/admin/repeat-bulk/*`, `app/(storefront)/account/orders/[id]/repeat/page.tsx`, `prisma/migrations/20260729112915_p10_seasons_repeat/migration.sql`.
**Reviewer:** Security specialist (blind — no model name).
**Method:** Findings only, no fixes. Trust boundaries, auth, secrets, IDOR, injection, money-path integrity. Focus: season flip auth, repeat/bulk IDOR, cron season-flip bearer, customer vs staff repeat boundaries, import-hook trust.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 6 |

The P10 trust boundary is largely sound. The season-flip cron fails closed on a missing `CRON_SECRET` and compares hashed bearers constant-time (`lib/cron-auth.ts`). The single-open-season invariant is enforced at the DB by the `seasons_single_open` partial unique index (P2 fix migration), so a racing or buggy flip cannot leave two seasons open — `setSeasonStatus` and `runSeasonFlip` both wrap their writes in `$transaction`. Customer repeat (GET and POST) verifies `order.customerId === gate.ctx.customer.id` and returns 404 on any miss, so a customer cannot repeat another customer's order (no IDOR on the source). Staff repeat / bulk-history gate on `requireApiPermission("payments.manage")` and act on any customer's order by design (R-057/R-058); the resulting draft lands on the source customer's account via `source.customerId` reloaded inside `createDraftFromRepeat`, not from client input. The confirm contract carries only decisions (keep/remove/swap + ids + qty + greeting); prices are re-snapshotted by the P4 draft engine. The one money-path gap is that the engine does not validate the swap target is an **active product in the open season**, which lets a customer swap a discontinued line onto a cheaper prior-season or $0 legacy-stub product. The remaining findings are audit-attribution and idempotency gaps behind manager auth.

## Major

### M1 — Repeat `swap` `targetProductId` is not validated to be an active product in the open season (price-integrity bypass)

`applyConfirmations` (`lib/repeat/create.ts:100-110`) takes the client-supplied `decision.targetProductId` on a `swap` and passes it straight through to `saveDraft` with no season/active check. `saveDraft` asserts the **draft's** season is OPEN (`assertOpenSeason`, `lib/orders/drafts.ts:46-53`) and hands the lines to `resolveDraftLines`. But `resolveDraftLines` (`lib/orders/resolve-lines.ts:51-57`) batch-loads referenced products with `where: { id: { in: [...] } }` — no `seasonId` filter, no `active: true` filter. Any product id is accepted, and its `basePriceCents` is snapshotted as the line's unit price (`resolve-lines.ts:121`). The plan's own header comment ("the P4 draft engine re-snapshots all prices from the catalog, so nothing client-sent is trusted", `lib/repeat/create.ts:6`) is not honoured for the **identity** of the swap target, only its price.

A customer repeating their own order already holds prior-season product ids in their order history (`app/(storefront)/account/orders/[id]/page.tsx` renders lines that reference `line.productId` from any season). Repeating a current discontinued line and swapping it to:

- a **prior-season product** with a lower `basePriceCents` → the new draft line is priced at the old price, not the open-season price;
- a **legacy-import stub product** (`lib/repeat/import-hook.ts:54-68`, `basePriceCents: 0`, `active: false`) that the customer has from an imported prior-year order → a **$0 line**, checkoutable at $0;
- an `active: false` product in the open season that staff disabled → priced at the disabled product's price.

The `suggestByPrice` list (`lib/repeat/matcher.ts`) is display-only — nothing enforces the swap target is from it, or even from the open season. The same gap applies to the staff repeat path (`app/api/admin/orders/[orderId]/repeat/route.ts` → `createDraftFromRepeat`), so a `payments.manage` staff member can repeat-swap onto a $0 stub on a customer's draft.

This is a money-path integrity bypass on a customer-facing endpoint: a customer can manipulate the unit price of a repeat line by choosing a swap target outside the open-season catalog. It does not grant unauthorized access (the customer owns the source order and the resulting draft), which is why it is Major rather than Blocker — but it is a direct revenue-leak vector whenever the customer possesses any cheaper product id (their own history is sufficient). The fix lives in the engine, not the P10 layer: `resolveDraftLines` should reject products whose `seasonId !== draft.seasonId` or `active === false`.

## Minor

### m1 — Import-hook trusts manager input to mint FINALIZED + PAID $0 orders on any customer account

`importLegacyOrders` (`lib/repeat/import-hook.ts:110-160`) creates orders with `status: "FINALIZED"`, `paymentStatus: "PAID"`, `totalCents: 0`, and upserts a `Customer` by email with no verification that the row corresponds to a real prior system (`customer.upsert` at import-hook.ts:100-104). A manager holding `catalog.manage` can inject arbitrary "Legacy <year>" orders for any email; the customer then sees `legacy-import:...` in their order history (`app/(storefront)/account/orders/page.tsx:44` renders `order.wireFormat`). The imported rows are treated as first-class FINALIZED history with no audit link to a source system, and the $0 PAID status is a money-path assertion the platform never verified. Manager is a trusted role, so this is a trust-boundary note, not a privilege escalation — but combined with M1, a single manager import seeding a $0 stub on a customer's history makes the customer self-checkout-at-$0 path reachable with no further manager involvement. The import audit (`legacy_import`, import-hook.ts:163-168) records only aggregate counts, not per-row customer emails, so the injected rows are not individually attributable after the fact.

### m2 — `runSeasonFlip` cron audit reuses the `season_schedule` action with `actor: null` and no `targetId`

`lib/seasons/manage.ts:242-248` records the cron-driven flip as `{ actor: null, action: "season_schedule", targetType: "Season", metadata: { cron: "season-flip", closed, opened } }` — no `targetId`. The same `season_schedule` action is used for **manager** schedule edits (`manage.ts:184-194`), which carry a real `ctx` actor and a `targetId`. For a security-relevant mutation (the season open/close is the year flip), the audit trail cannot distinguish a manager schedule edit from a cron flip except by inspecting `metadata.cron` and the null actor — attribution falls to out-of-band log correlation. A dedicated `season_flip_cron` action (or at minimum a non-null `targetId` on the cron row) would keep the actor classes separable in the audit log.

### m3 — `runSeasonFlip` `toOpen` loop wastes the first open when multiple seasons are due, and never clears stale `scheduledOpensAt`

`lib/seasons/manage.ts:221-238`: for each due CLOSED season, the loop closes the currently-OPEN season (which may be the one opened earlier in the same loop) before opening the next, so only the last-iterated due season ends OPEN; the audit `opened` array nonetheless lists all of them, so the audit overstates what the DB settled on. Separately, seasons skipped by the `scheduledClosesAt <= now` guard (manage.ts:227) keep their past `scheduledOpensAt` forever, so every future cron re-evaluates and re-skips them — a dead-schedule accumulation that also keeps them re-appearing as `CLOSED` candidates with a stale open time. The partial unique index guarantees the single-OPEN invariant regardless, so this is an operational/audit-fidelity gap, not a corruption risk.

### m4 — `setSeasonSchedule` writes the season update and audit row non-transactionally

`lib/seasons/manage.ts:183-194`: `prisma.season.update` then `recordAudit` (no `tx`). A crash between the two leaves a schedule change with no audit trail. `setSeasonStatus` (manage.ts:129-167) correctly wraps both in `$transaction`. The schedule edit is a manager-only (`catalog.manage`) mutation that drives the auto-flip cron, so losing its audit row weakens attribution for a season-lifecycle change. Minor audit-durability gap.

### m5 — Legacy import dedup check is a non-transactional `findFirst` outside the per-row transaction

`lib/repeat/import-hook.ts:91-98`: the `wireFormat: marker` duplicate check runs before the `$transaction` (import-hook.ts:110) that creates the order. Two concurrent imports of the same `externalKey` (or same email+year) can both pass the check and both create FINALIZED orders. Manager-only, so it is a concurrency/idempotency gap, not an authz one; the `seasons_single_open` partial index is unaffected. The `wireFormat` column has no unique constraint to backstop it.

### m6 — Replacement-chain "forward-only" invariant is enforced only in the UI, not the schema

`lib/repeat/chain.ts:24-61` walks `replacedById` until `product.seasonId === targetSeasonId`. The product editor (`app/(admin)/admin/products/[id]/page.tsx:77-79`) only offers replacement targets from "strictly newer seasons" by **string-comparing season names** (`candidate.season.name > productSeasonName`), but the DB has no constraint preventing a `replacedById` from pointing at a same- or older-season product. A hand-edited or imported mapping (the chain comment at chain.ts:6-7 explicitly acknowledges "hand-edited or imported loop") can point a product's `replacedById` at an older-season product, and the walker will follow it. The `seen` set and `maxHops=8` bound the walk and degrade the result to "dead end" rather than a wrong resolution, so the integrity outcome is safe — but the "forward-only" invariant the repeat flow relies on is a UI convention, not a guaranteed property of the data. A unique/partial-check constraint (or a server-side reject in the product save path) would make the invariant trustworthy regardless of how the row was written.

## Out of scope / explicitly not findings

- **Customer repeat IDOR on the source order**: `app/api/orders/[orderId]/repeat/route.ts` GET and POST both load the order and reject `order.customerId !== gate.ctx.customer.id` with 404 (route.ts:42-45, 65-68); the storefront repeat page does the same (`app/(storefront)/account/orders/[id]/repeat/page.tsx:25`). A customer cannot repeat another customer's order. No finding.
- **Staff repeat acting on any customer's order**: R-057/R-058 specify staff repeat of customer history. `payments.manage` gating + `createDraftFromRepeat` reloading `source.customerId` (not client input) means the draft lands on the source customer's account. No finding.
- **Bulk-history `orderIds` IDOR**: `runBulkHistory` (`lib/repeat/bulk-history.ts:111-131`) validates each id: exists, `FINALIZED`, `seasonId !== open.id`, not already repeated. Staff bulk-repeat of any customer's prior order is the specified R-058 behavior. No finding.
- **Season-flip cron CSRF on GET-with-bearer**: the Authorization header is the CSRF guard; browsers do not attach it cross-origin without credentials, and a headerless `<img>`-style GET hits the 401 before any mutation. No finding.
- **`CRON_SECRET` length oracle**: `lib/cron-auth.ts` hashes both sides before `timingSafeEqual` (the P9 m3 fix); no length pre-check remains. No finding.
- **Single-open-season race**: the `seasons_single_open` partial unique index (P2 fix migration) makes a double-open throw and roll back; `setSeasonStatus` and `runSeasonFlip` both transact. No finding.
- **Customer repeat of a DRAFT**: `buildRepeatPlan` accepts `FINALIZED` or `DRAFT` (plan.ts:125-127); repeating a draft creates a new draft on the same customer's account. No cross-customer exposure. No finding.
