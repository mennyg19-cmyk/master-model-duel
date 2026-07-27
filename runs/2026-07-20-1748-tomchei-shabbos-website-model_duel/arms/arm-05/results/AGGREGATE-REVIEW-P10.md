# P10 Aggregate Review — arm-05 (blind)

Phase P10. Counts: blocker 0, major 19, minor 13, nit 0, total 32.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 19 |
| Minor | 13 |
| Nit | 0 |
| Total | 32 |

Raw input totals: security 6, quality 14, rules 12, clean-code 10 = 42 findings -> 32 after dedupe (10 duplicates merged across 9 clusters).

Source tags: [S] security, [Q] quality, [R] rules, [C] clean-code.

Severity mapping: Critical/High-security -> blocker; High/Medium -> major; Low -> minor; Info/Nit -> nit.

---

## Prioritized fix list (single pass)

### Major - gate evidence / process

1. **Expectation files and phase status entirely absent** [R] - `arms/arm-05/workspace/.scratch/` (missing)
   - `workflow.mdc` requires a rolling `.scratch/phase-plan.md` with EXPECTED blocks plus `PHASE-P10-STATUS.md` / `PHASE-P10-SMOKE.md` evidence. Glob for `arm-05/workspace/.scratch/**` returns zero files; the directory does not exist. `clean-code.mdc` anti-hallucination forbids claiming "passed/working" without tool output. The smoke script prints `S1/S2/S3 passed` lines but no transcript is captured anywhere. The phase gate cannot be verified from artifacts. Create the `.scratch/` evidence files with pasted command output before any gate closure.

### Major - bulk repeat blast radius / DoS

2. **Bulk repeat has no rate limit, no concurrency cap, no partial-failure isolation; DB fan-out amplifier with orphaned drafts** [Q][S] - `app/api/admin/repeat/route.ts:23-32`
   - Merged from quality H2 + security F2. One bulk call accepts up to 100 `customerIds` and fans out via `Promise.all` into 100 `createRepeatDraft` calls; each runs `resolveReplacementChain` per source line, each performing multiple `prisma.productReplacement.findMany` queries. `createRepeatDraft` throws on "season not open" or "prior order not repeatable"; `Promise.all` rejects on the first throw and already-created drafts are orphaned DRAFT rows with no audit event (`orders.bulk_repeated` is only written on the success path). No rate limit, no concurrency cap, no upper bound on the customer base a compromised `orders.write` token can iterate in chunks of 100. Plan R-058 / P10 §3 calls for "bounded bulk repeat"; risk §4 calls for "bounded jobs" under crunch load. Bound the batch size and concurrency, switch to `Promise.allSettled` (or a saga) so one failure does not orphan the others, and write an audit row for attempted-but-failed drafts.

3. **Bulk repeat audit omits targeted customer IDs** [S] - `app/api/admin/repeat/route.ts:31`
   - The `orders.bulk_repeated` audit event records only `requested` and `created` counts plus `targetSeasonId`; `parsed.data.customerIds` is not included in `details`. If a staff token is misused to mass-create drafts, the audit trail cannot show which customers were affected, only how many were attempted. Include the `customerIds` list in the audit `details`.

### Major - auto-flip cron correctness & audit

4. **Auto-flip audit log omits which seasons flipped and skips zero-count runs** [S][Q][R] - `lib/seasons.ts:8-12`
   - Merged from security F4 + quality M3 + rules M2. `if (opened.count > 0) { await prisma.cronRunLog.create({ data: { jobName: "season-auto-flip", completedAt: new Date(), outcome: "ok", details: { opened: opened.count } } }) }`. Two gaps: (a) when zero seasons flip, no `CronRunLog` row is written - a cron that ran but found nothing leaves no audit trail, so "why didn't my season open?" has no cron-side evidence; (b) `details` records only the integer count, not the season IDs, so a reviewer cannot tell which season opened. `CronRunLog.startedAt` and `completedAt` both default to `now()`, so run duration is not captured either. Always write a `CronRunLog` row (including no-op runs) and include the opened season IDs in `details`.

5. **Auto-flip reopens manually-closed and past-`closesAt` seasons** [Q][R] - `lib/seasons.ts:4-7` (`autoOpenScheduledSeasons` where clause)
   - Merged from quality H1 + rules M3. The cron matches `where: { status: "CLOSED", opensAt: { lte: now } }` and flips to `OPEN`. There is no `closesAt` guard and no `manualOverride` flag. A manager who closes a scheduled season before its `opensAt` (the "Close season" button posts `status: "CLOSED"` and never clears `opensAt`) sees the season silently reopen on the next cron tick; a prior-year season with both `opensAt` and `closesAt` in the past, sitting in `CLOSED`, is also flipped back to `OPEN`. EXPECTED P10 §4 requires "manager Open/Closed switch + optional scheduled auto-flip" - the manual switch is not durable against the scheduler. Add a `manualOverride` flag (or null `opensAt` on manual close) and a `closesAt` guard to the where clause.

6. **Org-local timezone for scheduled auto-flip silently resolved as UTC** [R][Q] - `lib/seasons.ts:3-14` (`autoOpenScheduledSeasons`)
   - Merged from rules H2 + quality L2. `workflow.mdc` - "Never silently choose business logic ... log in DECISION-LOG.md and flag." `MERGED-BUILD-PLAN.md` § P10 lists "org-local timezone - open question" as unresolved; `PHASE-P10-EXPECTED.md` S2 requires "scheduled auto-flip opens season at the configured time." The cron compares `opensAt` against `now = new Date()` (UTC instant); `opensAt` is stored as UTC and compared to UTC now. There is no timezone field on `Season`, no offset handling, no comment, no DECISION-LOG entry (no `DECISION-LOG.md` exists in the workspace). A manager scheduling "open at 9am local" gets a flip at 9am UTC - a silent, undocumented business-logic decision the plan flagged as open. Resolve the timezone (org-local with an offset, or document UTC) and log the decision.

### Major - repeat draft data loss / correctness

7. **Repeat draft loses recipients for OrderLines split across multiple packages** [Q] - `lib/repeat-orders.ts:74` (`createRepeatDraft`)
   - `const packageRecord = sourceLine.packageLines[0]?.package;` reads only the first package's recipient/greeting into the repeat draft. The `RepeatLine` shape holds a single `recipient: { addressId, recipientName, greeting }`. The schema allows one `OrderLine` to have many `PackageLine`s across many `Package`s, and the P2 grouping engine explicitly supports splitting one line across packages (e.g. quantity 4 into 2 packages for 2 recipients). The lost recipients are silently dropped - the review page never offers them and `confirmRepeatDraft` cannot restore them. Carry all split recipients into the draft (multi-recipient line shape, or split into multiple `RepeatLine`s).

8. **Stale prior recipient address silently falls back then rejects generically** [Q] - `app/components/repeat-order-review.tsx:71-76`; `lib/repeat-orders.ts:134-145` (`confirmRepeatDraft`)
   - The recipient `<select>` renders only `review.addresses` (current address book) and defaults to `line.recipient.addressId`. If that address was deleted, the dropdown value matches no option and renders empty. On confirm, the client sends `addressId: undefined`; the server applies `selectedLine.addressId ?? sourceLine.recipient.addressId` - picking up the stale id - and the address-count check then fails with a generic "Choose recipients from this customer's address book" error. The customer sees a generic error with no link to fix the address. Detect the stale address at draft-build time and surface a clear "this address no longer exists, pick a new one" signal in the review UI.

9. **`confirmRepeatDraft` deletes OrderLines but not Packages - second confirm orphans packages** [Q] - `lib/repeat-orders.ts:153` (`confirmRepeatDraft`)
   - `await transaction.orderLine.deleteMany({ where: { orderId: draftId } })` clears lines but the transaction never touches `Package` or `PackageLine`. A fresh draft has no packages so the first confirm is safe, but if a customer navigates back and re-confirms, the prior confirm's packages (created by checkout/finalize downstream) reference now-deleted `OrderLine`s. The flow is not idempotent. Either guard against double-confirm (status check) or cascade-delete packages within the same transaction.

10. **Review page does not flag unmapped items** [Q] - `app/components/repeat-order-review.tsx:59-80`
    - Every line renders the same `<select>` with "Remove this item" plus `line.candidates.map(...)`. When `line.candidates` is empty, the only option is "Remove this item" but there is no warning badge, color, or message. EXPECTED P10 §2 says "unmapped items must be picked or removed" - the server enforces removal (`lib/repeat-orders.ts:130` skips lines with no `productId`), but the UI gives no signal that the item is unmapped vs. simply having a suggested replacement. Add an "unmapped" badge/notice when `line.candidates.length === 0`.

11. **Admin seasons page is not marked `force-dynamic`** [Q] - `app/admin/seasons/page.tsx` (no `export const dynamic`)
    - The file has no `export const dynamic = "force-dynamic"` (compare `app/repeat/[draftId]/page.tsx:7` which sets it). The page is a client component (`"use client"`) that fetches via `useEffect`, so the initial HTML shell could still be statically cached, showing stale season status to managers. For an admin operations page that flips season status, this is a freshness risk. Add `export const dynamic = "force-dynamic"`.

### Major - plan deliverables / admin UI

12. **Admin replacement-mapping UI only creates; no list, edit, delete, or chain view; GET over-fetches `replacementFrom` the client never reads** [R][C] - `app/admin/seasons/page.tsx:81-87`; `app/api/admin/seasons/route.ts:28-35`
    - Merged from rules M1 + clean-code m5. `workflow.mdc` Execution Discipline - "Implement attached plans verbatim." `MERGED-BUILD-PLAN.md` § P10 deliverable: "Admin replacement mappings per catalog item with cross-season chain resolution (R-048, G-013)." The admin page renders a two-select form (source, target) and a "Save replacement mapping" button - that is the entire mapping surface. The GET endpoint includes `replacementFrom: { include: { targetProduct: { include: { season: { } } } } }` on every product, but the page reads only `product.id`, `product.name`, `product.isActive`, `product.season.year` - the `replacementFrom` join is unused. There is no list of existing mappings, no per-item view, no delete, no chain visualisation. A manager who maps the wrong pair cannot correct it from the UI; the "cross-season chain resolution" exists only in `resolveReplacementChain` (lib), invisible to the admin who is supposed to manage it. Render the existing mappings from the already-fetched `replacementFrom` data, and add edit/delete/chain views.

13. **"New-season setup wizard" is a single flat form, not a wizard** [Q][R] - `app/admin/seasons/page.tsx:72-80`
    - Merged from quality M4 + rules L5. The R-097 "new-season setup wizard" deliverable is implemented as a one-step form (name, year, optional `opensAt`) with no guided flow, no catalog-cloning step, and no replacement-mapping assistance. Replacement mappings live in a separate card with no connection to the season being prepared. The plan §P10 deliverables calls for a wizard that walks a manager through preparing a season (catalog, replacements, open gate). Here the wizard is just the season row creator. Build a step-sequence wizard (catalog seed, replacement mappings, open-gate schedule) or document that the one-form create is the accepted interpretation.

14. **Smoke tests exercise library code, not the HTTP API or UI; bulk repeat dedup logic untested** [Q][R] - `scripts/smoke-p10.ts:58-84`; `app/api/admin/repeat/route.ts:23-32`
    - Merged from quality M5 + rules M5. `workflow.mdc` - "Verify in the running app - never mark done from code alone." S1 calls `resolveReplacementChain`, `createRepeatDraft`, `readRepeatDraft`, `confirmRepeatDraft` directly - it never hits `/api/repeat/[draftId]` or renders `RepeatOrderReview`. S2 calls `autoOpenScheduledSeasons()` directly - it does not verify the `/api/cron/season-auto-flip` bearer auth, nor the bulk `/api/admin/repeat` endpoint; the cron auth path (`lib/cron-auth.ts`) is not exercised by P10 smoke. The bulk route's `latestByCustomer` Map dedup (one draft per customer even when a customer has multiple FINALIZED orders) and its `orders.bulk_repeated` audit event are never hit by the smoke - a regression in the dedup logic would pass the smoke. Drive the smoke through the HTTP routes (and the cron bearer path), not just the lib functions.

### Major - sequential DB round-trips

15. **Sequential per-line `resolveReplacementChain` round-trips in `createRepeatDraft`** [R] - `lib/repeat-orders.ts:73-90`
    - `for (const sourceLine of sourceOrder.lines) { ... const candidates = await resolveReplacementChain(sourceLine.productId, targetSeasonId); ... }`. Each prior line triggers a serial `prisma.product.findUniqueOrThrow` plus a BFS of `prisma.productReplacement.findMany` calls. With N prior lines this is N sequential await chains. The lines are independent and could be resolved with `Promise.all` - the same file already parallelises `Promise.all` in `confirmRepeatDraft` (line 140) and the seasons route (line 28). Inconsistent pattern within the module. Parallelise the per-line chain resolution.

### Major - clean-code structure / type drift

16. **`RepeatLine` shape duplicated between lib and component** [C] - `lib/repeat-orders.ts:5-14`; `app/components/repeat-order-review.tsx:6-14`
    - `lib/repeat-orders.ts` defines `type RepeatLine` (8 fields) but does not export it. `repeat-order-review.tsx` redefines the same shape as `type ReviewLine` with identical fields. `clean-code.mdc` names "type/schema drift - centralize types, single source of truth." If the lib changes `RepeatLine` (e.g. adds an `addOns` field), the component's `ReviewLine` silently desynchronises and the `GET /api/repeat/[draftId]` payload is read with the wrong shape. Rule of 2 met (lib writes, component reads). Export `RepeatLine` from the lib and import it.

17. **`Address` type redefined in a 4th component file** [C] - `app/components/repeat-order-review.tsx:15`
    - `repeat-order-review.tsx` adds `type Address = { id, recipientName, line1, city, state, postalCode }`. The same shape already exists at `app/components/checkout-flow.tsx:6` (with optional `greetingPreference`), `app/components/order-builder.tsx:7`, and inline at `app/components/account-dashboard.tsx:11`. Four copies of the customer-address shape across the storefront, none shared. P10 perpetuates the existing drift instead of consolidating. `clean-code.mdc`: "type/schema drift - centralize types, single source of truth"; "No `types.ts` grab-bags - colocate by concern" points to a single address-module type, not four re-definitions. Extract one shared `Address` type.

18. **Season management logic split between `lib/seasons.ts` and the route handler** [C] - `lib/seasons.ts`; `app/api/admin/seasons/route.ts:38-78`
    - `lib/seasons.ts` is 14 lines and exports only `autoOpenScheduledSeasons` (the cron helper). All other season domain logic - create, status toggle, scheduled-open update, replacement mapping upsert, year-ordering validation - lives inline in the `POST` handler. By contrast `lib/repeat-orders.ts` owns the entire repeat domain (chain resolution, draft create, draft read, draft confirm) and the route handlers are thin. Two P10 features, two patterns for "where does domain logic live": repeat has a lib module, seasons inlines CRUD in the route. `clean-code.mdc`: "One data-fetching pattern per project." Move season CRUD + the cron helper into a `lib/seasons/` module and keep the route handler on auth/validation/parse.

19. **`replacementCandidates` exceeds the 3-level nesting rule** [C] - `lib/repeat-orders.ts:20-46`
    - `clean-code.mdc`: "If a function has more than 3 levels of nesting, refactor it." The BFS reaches 4: function body -> `while (frontier.length > 0)` -> `for (const mapping of mappings)` -> `if (target.seasonId === targetSeasonId && target.isActive)` (and the sibling `if (!visited.has(target.id))`). The per-mapping body does three things (candidate collect, visited check, frontier push) that read as a pattern match. Extracting `recordMapping(mapping, targetSeasonId, candidates)` and `enqueueUnvisited(target, visited, frontier)` would flatten the loop to 2 levels and make the BFS structure readable.

### Minor - security / data integrity

20. **Auto-flip cron does not audit failed auth attempts** [S] - `app/api/cron/season-auto-flip/route.ts:5-9`; `lib/cron-auth.ts:4-14`
    - A failed bearer check returns 401 silently. No `cronRunLog` or `auditEvent` row is written for failed cron auth, so brute-force attempts against `CRON_SECRET` are invisible. `authorizeCron` returns a `NextResponse` 401 on mismatch; the route handler returns it immediately and `autoOpenScheduledSeasons` is never reached, so no `cronRunLog` is created. No other path records cron auth failures. Write a `cronRunLog` (or audit) row on failed cron auth.

21. **Replacement mapping write does not require source product to be inactive** [S] - `app/api/admin/seasons/route.ts:62-74`
    - The `action:"map"` branch validates only `source.id !== target.id` and `source.season.year < target.season.year`. It does not check `source.isActive === false` (or any discontinued flag). A manager can map an active, currently-sellable product to another product. The repeat resolver will then suggest replacements for items that are still sellable, distorting customer repeat drafts and price-smart defaults. Add an `isActive === false` guard on the source.

22. **Replacement mapping write allows cycles** [S] - `app/api/admin/seasons/route.ts:62-74`
    - No cycle prevention exists on `ProductReplacement` writes. A manager can create A->B and later B->A (or longer cycles). The chain resolver in `replacementCandidates` terminates via a `visited` set, so it is not an infinite loop, but the mapping table can hold cyclic relationships that distort the candidate ordering and the price-smart default for affected source products. Reject cycles at write time (check the reverse edge before upserting).

23. **Replacement mapping API does not enforce `target.isActive`** [R] - `app/api/admin/seasons/route.ts:62-75`
    - The POST validates `source.season.year >= target.season.year` (rejects same/back-year) but never checks `target.isActive`. `replacementCandidates` in `lib/repeat-orders.ts:33` filters `target.isActive`, so an inactive-target mapping becomes a dead edge never surfaced to the customer. The admin UI filters `isActive` for the target dropdown (line 85), but the API accepts inactive targets - a curl/POST bypass creates a silent dead mapping. Enforce `target.isActive` in the API.

24. **`createRepeatDraft` does not require the source order to be `FINALIZED`** [C] - `lib/repeat-orders.ts:57-67`
    - `prisma.order.findFirst({ where: { id: sourceOrderId, ...(expectedCustomerId ? { customerId } : {}) } })` - no `status` filter. A `DRAFT` order can be repeated into another `DRAFT`. The plan frames repeat as "copy prior year to draft," implying a prior finalized order; the bulk path at `app/api/admin/repeat/route.ts:24` correctly filters `status: "FINALIZED"`, but the shared `createRepeatDraft` does not, so the customer single-repeat path (`app/api/repeat/route.ts:19`) accepts a draft source. Two entry points, one validates status and one does not. Filter `status: "FINALIZED"` in `createRepeatDraft` (single source) or document that drafts are intentionally repeatable.

25. **Replacement chain BFS has no depth limit** [Q] - `lib/repeat-orders.ts:20-46` (`replacementCandidates`)
    - A pathological chain across many seasons performs one DB query per frontier wave with no upper bound. The `while (frontier.length > 0)` loop terminates only via the `visited` set. Cycles are prevented, but a 50-season chain does 50 sequential `productReplacement.findMany` calls. No `maxDepth` guard. Add a `maxDepth` cap.

26. **`confirmRepeatDraft` creates no Package records** [Q] - `lib/repeat-orders.ts:152-181`
    - After confirm, the draft has `OrderLine`s but no `Package`s; the repeat flow depends on checkout/finalize to materialize packages. The transaction creates `order.lines` and updates `wireFormat.lines` with recipient `{ kind: "saved", addressId }`, but no `package.create`. The redirect target `/checkout` must accept this shape. Not verified by P10 smoke. Confirm the checkout/finalize path accepts a package-less draft, or document the contract.

27. **S3 smoke does not separately verify address-book or migration hook** [Q] - `scripts/smoke-p10.ts:82-84`
    - S3 asserts `customerId`, `quantity`, and greeting but does not independently verify the address-book entry resolved against imported history or exercise the P12 migration hook. S3 reuses the same customer's address created inline; it does not test an imported address-book entry from a legacy source. The plan says "stub/migration hook OK" for S3, so this is acceptable, but the assertion is shallow. Add an imported-address smoke case when the migration hook lands.

### Minor - clean-code / type safety / consistency

28. **Unsafe JSON cast and non-null `customerId` assertion in repeat draft read/confirm** [C][R] - `lib/repeat-orders.ts:108-110, 143`
    - Merged from clean-code m2 + rules L2. `(draft.wireFormat as { repeat?: { sourceOrderId: string; lines: RepeatLine[] } }).repeat` - `wireFormat` is `Json?` in the schema; the cast is unvalidated. A malformed `wireFormat` (e.g. `repeat.lines` not an array) would throw at the `.lines` access in the review UI rather than returning a clean 404. Then `repeatDraft.draft.customerId!` (line 143) asserts non-null on a field the schema permits as null; `readRepeatDraft` does not guarantee it. `createRepeatDraft` throws when `customerId` is missing, so drafts created via the flow are safe, but the `!` papers over the invariant rather than enforcing it - if a future caller passes no `customerId`, the `!` lies and prisma receives `undefined` (no filter), counting addresses belonging to any customer. Validate the `wireFormat` shape and narrow `customerId` explicitly (throw if null before the query) or have `readRepeatDraft` return a narrowed type when called with a customer.

29. **Dead `origin` header set explicitly on customer fetches, omitted on admin fetches** [R][C] - `app/components/repeat-order-review.tsx:45`; `app/components/account-dashboard.tsx:36` vs `app/admin/seasons/page.tsx:30-34,55`
    - Merged from rules L3 + clean-code m4. `headers: { "content-type": "application/json", origin: window.location.origin }`. `Origin` is a forbidden header name in the Fetch standard - browsers silently drop manual `origin` headers. The browser sets `Origin` automatically for the CORS-preflightable `application/json` POST/PUT, so the explicit `origin` is a no-op that reads as if it were doing the `hasSameOrigin` check a favor. Meanwhile the admin fetches correctly omit it. Both admin and customer APIs call the same `hasSameOrigin(request)` gate. Same gate, two patterns. Drop the manual `origin` header from the customer fetches and apply one fetch-header pattern across all four P10 sites.

30. **`post(body: unknown)` defeats type-checking on the admin seasons form** [C] - `app/admin/seasons/page.tsx:29`
    - `async function post(body: unknown)` accepts any payload. Call sites at `:43-48` pass `{ action: "create", name: form.get("name"), year: Number(form.get("year")), opensAt: ... }`. `form.get("name")` returns `FormDataEntryValue | null` (`string | File | null`), but the API schema expects `z.string().trim().min(3)`. The `unknown` parameter accepts the mismatched type silently; the error only surfaces at runtime as a 400. `clean-code.mdc` anti-AI-tics: "No redundant type assertions the compiler already guarantees" - here the compiler is being prevented from guaranteeing anything. Type `post` against the discriminated union (or export the schema) so TypeScript catches the `FormDataEntryValue | null` hole.

31. **Customer repeat/confirm path creates no audit event; staff path does** [C] - `app/api/admin/repeat/route.ts:20,31`; `app/api/repeat/[draftId]/route.ts:39`; `lib/repeat-orders.ts:120-183`
    - The staff path creates `auditEvent` rows for `order.repeated_by_staff` and `orders.bulk_repeated`. The customer path calls `confirmRepeatDraft` and returns - no `auditEvent`. `confirmRepeatDraft` itself writes `confirmedAt` into `wireFormat` but creates no audit row. The same P10 feature audits staff-triggered drafts but not customer-triggered drafts or customer confirmations. `clean-code.mdc`: "One error-handling approach per project" - by analogy, one audit approach per domain action. Either customer repeat/confirm is intentionally unaudited (document why) or the audit pattern is inconsistent. Add an audit row for customer repeat/confirm, or document the omission.

32. **`createRepeatDraft` error message names the failure but not the expected state** [R] - `lib/repeat-orders.ts:68`
    - `if (!sourceOrder?.customerId) throw new Error("That prior order cannot be repeated.")`. The message does not say why (the prior order has no customer attached) nor what the expected state is (a repeatable order must belong to a customer). The companion error on line 70 ("Choose an open season for the repeat order.") does state the expected state - inconsistent within the same function. `clean-code.mdc`: "Error messages say what went wrong AND what the expected state was." Rewrite the message to name both.

---

## Notes

- 0 blockers. No Critical/High-security findings in P10 scope; the prior P9 cron bearer timing leak was already fixed (`authorizeCron` now uses `timingSafeEqual`).
- 9 clusters merged (10 duplicates removed): (a) bulk repeat no bounds - Q-H2 + S-F2 (#2); (b) auto-flip audit log gaps - S-F4 + Q-M3 + R-M2 (#4); (c) auto-flip reopens closed/archived - Q-H1 + R-M3 (#5); (d) UTC timezone - R-H2 + Q-L2 (#6); (e) wizard is flat form - Q-M4 + R-L5 (#13); (f) smoke doesn't exercise routes - Q-M5 + R-M5 (#14); (g) confirmRepeatDraft non-null + JSON cast - C-m2 + R-L2 (#28); (h) dead origin header - R-L3 + C-m4 (#29); (i) mapping UI create-only + over-fetch - R-M1 + C-m5 (#12).
- No new findings introduced during aggregation.






