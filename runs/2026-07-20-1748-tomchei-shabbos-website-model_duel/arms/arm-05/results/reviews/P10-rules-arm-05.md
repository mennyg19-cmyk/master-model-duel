# P10 Rules review — arm-05 (blind)

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Rules graded:** `clean-code.mdc`, `vocabulary.mdc`, `ponytail.mdc`, `workflow.mdc`, `codegraph.mdc`
**Scope:** P10 code only (`lib/seasons.ts`, `lib/repeat-orders.ts`, `app/api/admin/seasons/route.ts`, `app/api/admin/repeat/route.ts`, `app/api/repeat/route.ts`, `app/api/repeat/[draftId]/route.ts`, `app/api/cron/season-auto-flip/route.ts`, `app/admin/seasons/page.tsx`, `app/repeat/[draftId]/page.tsx`, `app/components/repeat-order-review.tsx`, `scripts/smoke-p10.ts`, `prisma/schema.prisma` § `Season`/`ProductReplacement`/`CronRunLog`).
**Method:** Findings only — no fixes proposed.

## Summary counts

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 5 |
| Low | 5 |
| **Total** | **12** |

## Findings

### High

#### H1 — Expectation files and phase status entirely absent
**Location:** `arms/arm-05/workspace/.scratch/` (missing); no `PHASE-P10-STATUS.md`, no `PHASE-P10-SMOKE.md`, no `phase-plan.md`
**Claim:** `workflow.mdc` — "Expectation Files (pre-committed self-review): for any phase … keep a rolling scratch file at `.scratch/phase-plan.md` … Before each todo: append an EXPECTED block … After the todo: walk that checklist item by item, marking each with evidence." `shared/phases/PHASE-P10-EXPECTED.md` line 20 names `arms/{id}/workspace/.scratch/PHASE-P10-SMOKE.md` as the evidence path. `clean-code.mdc` anti-hallucination — "Do not claim 'fixed/passed/working' without tool output or running-app evidence."
**Evidence:** Glob for `arm-05/workspace/.scratch/**` returns zero files. The `.scratch` directory does not exist for arm-05 at all. No pre-committed EXPECTED blocks, no smoke evidence file, no run-state. The smoke script (`scripts/smoke-p10.ts`) prints `console.log("S1/S2/S3 passed …")` lines but no transcript is captured anywhere. The phase gate cannot be verified from artifacts.

#### H2 — Org-local timezone for scheduled auto-flip silently resolved as UTC
**Location:** `autoOpenScheduledSeasons`, `lib/seasons.ts` (3–14); `opensAt` comparison at line 5
**Claim:** `workflow.mdc` — "Never silently choose business logic (calculations, domain rules) — log in DECISION-LOG.md and flag." `shared/MERGED-BUILD-PLAN.md` § P10 (line 262) explicitly lists "org-local timezone — open question" as an unresolved product decision. `shared/phases/PHASE-P10-EXPECTED.md` S2 requires "scheduled auto-flip opens season at the configured time."
**Evidence:** `where: { status: "CLOSED", opensAt: { lte: now } }` with `now = new Date()` (UTC instant). `opensAt` is stored as a UTC `DateTime` and compared to UTC now. There is no timezone field on `Season`, no offset handling, no comment, and no DECISION-LOG entry (no DECISION-LOG.md exists in the workspace). The README § P10 (line 16) describes the feature without mentioning the timezone choice. A manager scheduling "open at 9am local" gets a flip at 9am UTC — a silent, undocumented business-logic decision the plan flagged as open.

### Medium

#### M1 — Admin replacement-mapping UI only creates; no list, edit, delete, or chain view
**Location:** `app/admin/seasons/page.tsx` (81–87 "Replacement mappings" section); `app/api/admin/seasons/route.ts` GET (28–35)
**Claim:** `workflow.mdc` Execution Discipline — "Implement attached plans verbatim." `shared/MERGED-BUILD-PLAN.md` § P10 deliverable: "Admin replacement mappings per catalog item with cross-season chain resolution (R-048, G-013)."
**Evidence:** The admin page renders a two-select form (source, target) and a "Save replacement mapping" button. The GET endpoint returns `replacementFrom` relations on each product, but the page never renders them — there is no list of existing mappings, no per-item view, no delete, and no chain visualisation. A manager who maps the wrong pair cannot correct it from the UI; the "cross-season chain resolution" exists only in `resolveReplacementChain` (lib), invisible to the admin who is supposed to manage it.

#### M2 — `autoOpenScheduledSeasons` audit log omits which seasons flipped and skips zero-count runs
**Location:** `autoOpenScheduledSeasons`, `lib/seasons.ts` (8–12)
**Claim:** `workflow.mdc` — "Never silently choose business logic … log and flag." `clean-code.mdc` — "Error messages say what went wrong AND what the expected state was." Plan P11 out-of-scope but P10 cron evidence is required at the gate.
**Evidence:** `if (opened.count > 0) { await prisma.cronRunLog.create({ … details: { opened: opened.count } }) }`. Two gaps: (1) when zero seasons flip, no `CronRunLog` row is written — a cron that ran but found nothing leaves no audit trail; (2) `details` records only the integer count, not the season IDs. A reviewer cannot tell which season opened or prove the cron actually executed on a no-op run. `CronRunLog.startedAt` and `completedAt` both default to `now()`, so run duration is not captured either.

#### M3 — `autoOpenScheduledSeasons` ignores `closesAt` and can reopen an archived season
**Location:** `autoOpenScheduledSeasons`, `lib/seasons.ts` (4–7)
**Claim:** `workflow.mdc` — "Never silently choose business logic." Plan P10: "manager Open/Closed switch + optional scheduled auto-flip (UR-008); archive stays browsable off-season."
**Evidence:** The `where` clause is `{ status: "CLOSED", opensAt: { lte: now } }`. There is no `closesAt` guard. A season with both `opensAt` and `closesAt` in the past (e.g., a prior year's season that was manually closed) sitting in `CLOSED` status would be flipped back to `OPEN` by the cron. Whether a past-closesAt season should be eligible for auto-open is a business rule the code decides silently.

#### M4 — Sequential per-line `resolveReplacementChain` round-trips in `createRepeatDraft`
**Location:** `createRepeatDraft`, `lib/repeat-orders.ts` (73–90)
**Claim:** `ponytail.mdc` — "Minimum code"; `clean-code.mdc` — "If a function has more than 3 levels of nesting, refactor it"; "No copy-paste patterns with minor variations — extract the pattern." Same pattern flagged in P9 M4.
**Evidence:** `for (const sourceLine of sourceOrder.lines) { … const candidates = await resolveReplacementChain(sourceLine.productId, targetSeasonId); … }`. Each prior line triggers a serial `prisma.product.findUniqueOrThrow` plus a BFS of `prisma.productReplacement.findMany` calls. With N prior lines this is N sequential await chains. The lines are independent and could be resolved with `Promise.all` (the same file already parallelises `Promise.all` in `confirmRepeatDraft` at line 140 and the seasons route at line 28). Inconsistent pattern within the module.

#### M5 — Bulk repeat endpoint dedup logic untested by the phase smoke
**Location:** `scripts/smoke-p10.ts` (74–76); `app/api/admin/repeat/route.ts` (23–32)
**Claim:** `workflow.mdc` — "Verify in the running app — never mark done from code alone"; expectation S2 requires "Bulk repeat drafts N customers."
**Evidence:** The smoke creates two customers and calls `Promise.all([priorOrder, secondOrder].map((order) => createRepeatDraft(order.id, …)))` — it exercises `createRepeatDraft` directly, not the `/api/admin/repeat` bulk route. The route's `latestByCustomer` Map dedup (one draft per customer even when a customer has multiple FINALIZED orders) and its `orders.bulk_repeated` audit event are never hit by the smoke. A regression in the dedup logic would pass the smoke.

### Low

#### L1 — Replacement mapping API does not enforce `target.isActive`
**Location:** `app/api/admin/seasons/route.ts` (62–75)
**Claim:** `clean-code.mdc` — "No defensive code for conditions that can't happen" cuts the other way here: a condition that *can* happen (inactive target) is not defended against. Plan P10: replacement mappings feed the repeat flow's "closest-priced mapped item" suggestion.
**Evidence:** The POST validates `source.season.year >= target.season.year` (rejects same/back-year) but never checks `target.isActive`. `replacementCandidates` in `lib/repeat-orders.ts` (33) filters `target.isActive`, so an inactive-target mapping becomes a dead edge never surfaced to the customer. The admin UI filters `isActive` for the target dropdown (line 85), but the API accepts inactive targets — a curl/POST bypass creates a silent dead mapping.

#### L2 — Unsafe JSON cast and non-null `customerId` assertion in repeat draft read/confirm
**Location:** `readRepeatDraft`, `lib/repeat-orders.ts` (108–110); `confirmRepeatDraft`, `lib/repeat-orders.ts` (143)
**Claim:** `clean-code.mdc` — "No redundant type assertions the compiler already guarantees" (this is the inverse: an assertion the compiler does *not* guarantee); `ponytail.mdc` — robotic clarity on data paths.
**Evidence:** `(draft.wireFormat as { repeat?: { sourceOrderId: string; lines: RepeatLine[] } }).repeat` — `wireFormat` is `Json?` in the schema; the cast is unvalidated. A malformed `wireFormat` (e.g., `repeat.lines` not an array) would throw at the `.lines` access in the review UI rather than returning a clean 404. Then `repeatDraft.draft.customerId!` (line 143) asserts non-null on a field the schema permits as null; `readRepeatDraft` does not guarantee it. `createRepeatDraft` throws when `customerId` is missing, so drafts created via the flow are safe, but the `!` papers over the invariant rather than enforcing it.

#### L3 — Dead `origin` header in repeat review confirm fetch
**Location:** `app/components/repeat-order-review.tsx` (45)
**Claim:** `clean-code.mdc` — "No 'just in case' code — every line must have a reason"; anti-AI-tics.
**Evidence:** `headers: { "content-type": "application/json", origin: window.location.origin }`. `Origin` is a forbidden header name in the Fetch standard — browsers silently drop manual `origin` headers. The browser sets `Origin` automatically for the CORS-preflightable `application/json` POST/PUT. The explicit `origin: window.location.origin` is a no-op that reads as if it were doing the `hasSameOrigin` check a favor. The other P10 client fetches (e.g., `app/admin/seasons/page.tsx` 30) correctly omit it.

#### L4 — `createRepeatDraft` error message names the failure but not the expected state
**Location:** `createRepeatDraft`, `lib/repeat-orders.ts` (68)
**Claim:** `clean-code.mdc` — "Error messages say what went wrong AND what the expected state was."
**Evidence:** `if (!sourceOrder?.customerId) throw new Error("That prior order cannot be repeated.")`. The message does not say why (the prior order has no customer attached) nor what the expected state is (a repeatable order must belong to a customer). The companion error on line 70 ("Choose an open season for the repeat order.") does state the expected state — inconsistent within the same function.

#### L5 — "New-season setup wizard" is a three-field form, not a wizard
**Location:** `app/admin/seasons/page.tsx` (72–80 "New-season setup" section)
**Claim:** `workflow.mdc` — "Implement attached plans verbatim." Plan P10 deliverable: "New-season setup wizard (R-097)."
**Evidence:** The implementation is a single form with `name`, `year`, and optional `opensAt` fields on the seasons admin page — same surface as a plain create. There is no step sequence, no catalog-seed step, no greeting/template defaults step. Borderline: "wizard" is not strictly defined in the plan, but a one-form create does not match the wizard noun the plan chose. Flagged for awareness; not a hard gap.

## Rules not violated (noted for completeness)

- **Dependency discipline:** no new packages added in P10; `lib/seasons.ts` and `lib/repeat-orders.ts` use `node:crypto`, Prisma, and existing `@/lib/*` only. `package.json` deps unchanged from P9.
- **Naming:** no banned vague standalone names (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) in P10 product code.
- **Comments:** no narration / change-explanation comments in P10 code.
- **UI consistency:** seasons admin and repeat review pages reuse `card`, `button`, `ops-list`, `eyebrow`, `notice`, `lead` classes used elsewhere.
- **Security basics:** admin routes use `authorize("settings.manage" | "orders.write")` + `hasSameOrigin` + Zod; the customer repeat routes use `findCustomerForRequest` + `hasSameOrigin`; the `season-auto-flip` cron reuses the existing `authorizeCron` bearer check (`CRON_SECRET`). No secrets logged.
- **Error handling:** no swallowed errors; every `catch` in P10 routes returns a JSON error.
- **Codegraph:** cannot be graded from code output alone (governs agent behaviour during build, not artifact shape).
