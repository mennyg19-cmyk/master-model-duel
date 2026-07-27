# P10 Security Review — arm-05 (blind)

**Phase:** P10 — Seasons management, repeat orders, replacement mappings.
**Scope:** season open/close authz, repeat-order IDOR, bulk repeat blast radius, replacement mapping writes, auto-flip cron auth. Findings only — no fixes. P10 scope only.

**Evidence reviewed:**
- `app/api/admin/seasons/route.ts` (GET/POST: create season, update status, map replacement)
- `app/api/admin/repeat/route.ts` (staff single + bulk repeat)
- `app/api/repeat/route.ts` (customer repeat create)
- `app/api/repeat/[draftId]/route.ts` (customer repeat GET/PUT)
- `app/api/cron/season-auto-flip/route.ts`
- `lib/seasons.ts`, `lib/repeat-orders.ts`, `lib/cron-auth.ts`, `lib/route-auth.ts`, `lib/permissions.ts`, `lib/staff-store.ts`, `lib/order-builder.ts` (`findCustomerForRequest`)
- `app/admin/seasons/page.tsx`, `app/repeat/[draftId]/page.tsx`
- `.scratch/PHASE-P10-STATUS.md`, `.scratch/PHASE-P10-SMOKE.md`

---

## Summary of checks (pass)

- **Season open/close authz.** `GET/POST /api/admin/seasons` require `settings.manage` (MANAGER only via `rolePermissions`). POST also enforces `hasSameOrigin`. Audit events written for `season.created` and `season.status_changed`. No authz gap.
- **Repeat-order IDOR (customer side).** `POST /api/repeat` passes `customer.customerId` as `expectedCustomerId` to `createRepeatDraft`, which filters the source order by `customerId`. `GET/PUT /api/repeat/[draftId]` pass `customer.customerId` into `readRepeatDraft` and `confirmRepeatDraft`; both filter `prisma.order.findFirst` by `customerId`. A customer cannot read, repeat, or confirm another customer's draft or source order.
- **Staff single repeat.** `POST /api/admin/repeat` `action:"single"` requires `orders.write` and `hasSameOrigin`; calls `createRepeatDraft(sourceOrderId, targetSeasonId)` without `expectedCustomerId`. Intended per R-057 (staff repeat any customer's order). Audit-logged as `order.repeated_by_staff` with `sourceOrderId`.
- **Replacement mapping write authz.** `action:"map"` requires `settings.manage` + `hasSameOrigin`; rejects `source.id === target.id` and `source.season.year >= target.season.year`; upserts on composite key; audit-logged with both product IDs.
- **Auto-flip cron auth.** `authorizeCron` compares bearer to `CRON_SECRET` with `timingSafeEqual`; returns 401 when secret unset or mismatched. No origin check (cron has no Origin), acceptable.
- **Confirm draft integrity.** `confirmRepeatDraft` re-validates each picked product belongs to the target season and is `isActive`, and each `addressId` belongs to the draft's `customerId` via `prisma.address.count`. Cross-customer address injection is rejected.

---

## Findings

### F1 — Medium: Bulk repeat audit omits targeted customer IDs
**Location:** `app/api/admin/repeat/route.ts:31`
**Claim:** The `orders.bulk_repeated` audit event records only `requested` and `created` counts, not the `customerIds` list submitted by the caller.
**Evidence:** `await prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, action: "orders.bulk_repeated", details: { requested: parsed.data.customerIds.length, created: drafts.length, targetSeasonId: parsed.data.targetSeasonId } } });` — `parsed.data.customerIds` is not included in `details`.
**Impact:** Forensics gap. If a staff token is misused to mass-create drafts, the audit trail cannot show which customers were affected, only how many were attempted.

### F2 — Medium: Bulk repeat has no rate limiting and amplifies DB load per call
**Location:** `app/api/admin/repeat/route.ts:23-32`
**Claim:** A single bulk call accepts up to 100 `customerIds` and fans out via `Promise.all` into 100 `createRepeatDraft` calls. Each `createRepeatDraft` runs `resolveReplacementChain` per source order line, each performing multiple `prisma.productReplacement.findMany` queries. There is no rate limit on repeat bulk calls and no concurrency cap.
**Evidence:** `const bulkSchema = z.object({ action: z.literal("bulk"), customerIds: z.array(z.string().cuid()).min(1).max(100), targetSeasonId: z.string().cuid() });` and `const drafts = await Promise.all([...latestByCustomer.values()].map((sourceOrderId) => createRepeatDraft(sourceOrderId, parsed.data.targetSeasonId)));`.
**Impact:** Blast radius is the entire customer base. A compromised `orders.write` token can iterate the whole customer table in chunks of 100, and each chunk triggers unbounded fan-out DB queries (100 drafts × N lines × chain depth). DoS amplifier plus mass draft creation with no upper bound.

### F3 — Low: Auto-flip cron does not audit failed auth attempts
**Location:** `app/api/cron/season-auto-flip/route.ts:5-9` + `lib/cron-auth.ts:4-14`
**Claim:** A failed bearer check returns 401 silently. No `cronRunLog` or `auditEvent` row is written for failed cron auth, so brute-force attempts against `CRON_SECRET` are invisible.
**Evidence:** `authorizeCron` returns a `NextResponse` 401 on mismatch; the route handler returns it immediately and `autoOpenScheduledSeasons` is never reached, so no `cronRunLog` is created. No other path records cron auth failures.
**Impact:** No detection signal for cron-secret brute-force or scanning.

### F4 — Low: Auto-flip cron run log omits opened season IDs
**Location:** `lib/seasons.ts:9-11`
**Claim:** The `cronRunLog` entry for a successful auto-flip records `opened: opened.count` but not the IDs of the seasons that were flipped to OPEN.
**Evidence:** `await prisma.cronRunLog.create({ data: { jobName: "season-auto-flip", completedAt: new Date(), outcome: "ok", details: { opened: opened.count } } });` — no season IDs in `details`.
**Impact:** Forensics gap. Reconstructing which seasons auto-opened from the cron log alone is impossible; one must diff the season table by `updatedAt`.

### F5 — Low: Replacement mapping write does not require source product to be inactive
**Location:** `app/api/admin/seasons/route.ts:62-74`
**Claim:** The `action:"map"` branch validates only `source.id !== target.id` and `source.season.year < target.season.year`. It does not check `source.isActive === false` (or any discontinued flag). A manager can map an active, currently-sellable product to another product.
**Evidence:** `const [source, target] = await Promise.all([ prisma.product.findUnique({ where: { id: parsed.data.sourceProductId }, include: { season: true } }), prisma.product.findUnique({ where: { id: parsed.data.targetProductId }, include: { season: true } } }) ]); if (!source || !target || source.id === target.id || source.season.year >= target.season.year) { return NextResponse.json({ error: "Map an older catalog item to a different item in a later season." }, { status: 400 }); }` — no `isActive` check on `source`.
**Impact:** Data integrity. The repeat resolver will suggest replacements for items that are still sellable, distorting customer repeat drafts and price-smart defaults.

### F6 — Low: Replacement mapping write allows cycles
**Location:** `app/api/admin/seasons/route.ts:62-74`
**Claim:** No cycle prevention exists on `ProductReplacement` writes. A manager can create A→B and later B→A (or longer cycles). The chain resolver in `replacementCandidates` terminates via a `visited` set, so it is not an infinite loop, but the mapping table can hold cyclic relationships.
**Evidence:** The map branch upserts without querying existing reverse edges: `const mapping = await prisma.productReplacement.upsert({ where: { sourceProductId_targetProductId: { sourceProductId: source.id, targetProductId: target.id } }, create: { sourceProductId: source.id, targetProductId: target.id }, update: {} });`. `replacementCandidates` in `lib/repeat-orders.ts:20-46` uses `visited` to bound traversal but does not reject cycles in stored data.
**Impact:** Data integrity. Cyclic mappings distort the candidate ordering and the price-smart default for affected source products.

---

## Counts

- Critical: 0
- High: 0
- Medium: 2
- Low: 4
- Info: 0
- Total: 6
