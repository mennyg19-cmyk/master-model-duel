# P10 Quality Review — arm-05

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Scope:** replacement chain resolution, customer review page, price-smart defaults, bulk/single staff repeat, season wizard/auto-flip, EXPECTED S1–S3.
**Method:** findings only — no fixes. P10 scope only.

## High

### H1 — Auto-flip reopens manually-closed scheduled seasons
**Location:** `app/admin/seasons/page.tsx` (close button); `lib/seasons.ts` `autoOpenScheduledSeasons`.
**Claim:** A manager who closes a scheduled season before its `opensAt` will see the season silently reopen on the next cron tick.
**Evidence:** The "Close season" button posts `{ action: "update", seasonId, status: "CLOSED" }` and never clears `opensAt` (`app/admin/seasons/page.tsx:69`). The update route only mutates `opensAt` when the payload includes it (`app/api/admin/seasons/route.ts:56`). The cron matches `where: { status: "CLOSED", opensAt: { lte: now } }` and flips to `OPEN` (`lib/seasons.ts:4-7`). Once `opensAt` has passed, every cron run reopens the closed season. There is no "closed-and-stay-closed" guard (e.g. a `manualOverride` flag or nulling `opensAt` on manual close). EXPECTED P10 §4 requires "manager Open/Closed switch + optional scheduled auto-flip" — the manual switch is not durable against the scheduler.

### H2 — Bulk repeat has no partial-failure isolation and no concurrency bound
**Location:** `app/api/admin/repeat/route.ts` (bulk branch, lines 23-32); `lib/repeat-orders.ts` `createRepeatDraft`.
**Claim:** One customer's repeat failure cancels every other customer's draft in the same bulk batch, and 100 customers fire 100 concurrent multi-query draft creations.
**Evidence:** `const drafts = await Promise.all([...latestByCustomer.values()].map((sourceOrderId) => createRepeatDraft(...)))` (`app/api/admin/repeat/route.ts:30`). `createRepeatDraft` throws on "season not open" or "prior order not repeatable" (`lib/repeat-orders.ts:68-70`). `Promise.all` rejects on the first throw and the already-created drafts are orphaned DRAFT rows with no audit event. The plan calls for "bounded bulk repeat" (R-058, P10 §3) and "bounded jobs" under crunch load (risk §4) — neither bound is implemented. The audit event `orders.bulk_repeated` is only written on the success path, so a partial failure leaves no audit trail of what was attempted.

### H3 — Repeat draft loses recipients for OrderLines split across multiple packages
**Location:** `lib/repeat-orders.ts` `createRepeatDraft`, line 74.
**Claim:** When a prior OrderLine was split across more than one Package (e.g. quantity 4 split into 2 packages for 2 recipients), only the first package's recipient/greeting is carried into the repeat review.
**Evidence:** `const packageRecord = sourceLine.packageLines[0]?.package;` (`lib/repeat-orders.ts:74`). The `RepeatLine` shape holds a single `recipient: { addressId, recipientName, greeting }` (`lib/repeat-orders.ts:11`). The schema allows one OrderLine to have many PackageLines across many Packages (`prisma/schema.prisma` `OrderLine.packageLines PackageLine[]` and `Package.lines PackageLine[]`). The grouping engine (P2) explicitly supports splitting one line across packages, so this is a real shape, not an edge case. The lost recipients are silently dropped — the review page never offers them, and `confirmRepeatDraft` cannot restore them.

## Medium

### M1 — Review page does not flag unmapped items
**Location:** `app/components/repeat-order-review.tsx` (line render, lines 59-80).
**Claim:** A prior item with no mapped candidates is visually indistinguishable from a mapped item, so the customer cannot tell which lines require action.
**Evidence:** Every line renders the same `<select>` with "Remove this item" plus `line.candidates.map(...)` (`repeat-order-review.tsx:66-69`). When `line.candidates` is empty, the only option is "Remove this item" but there is no warning badge, color, or message. EXPECTED P10 §2 says "unmapped items must be picked or removed" — the server enforces removal (`lib/repeat-orders.ts:130` skips lines with no `productId`), but the UI gives no signal that the item is unmapped vs. simply having a suggested replacement.

### M2 — Stale prior recipient address silently falls back then rejects generically
**Location:** `app/components/repeat-order-review.tsx` (recipient select, lines 71-76); `lib/repeat-orders.ts` `confirmRepeatDraft` (lines 134-145).
**Claim:** When the prior package's `addressId` is no longer in the customer's address book, the dropdown shows "Choose a recipient" but the server silently reuses the stale address and then rejects with a generic "Choose recipients from this customer's address book" error.
**Evidence:** The recipient `<select>` only renders `review.addresses` (the current address book) and defaults to `line.recipient.addressId` (`repeat-order-review.tsx:72-74`). If that address was deleted, the dropdown value doesn't match any option and renders empty. On confirm, the client sends `addressId: undefined`; the server then applies `selectedLine.addressId ?? sourceLine.recipient.addressId` (`lib/repeat-orders.ts:134`) — picking up the stale id — and the address-count check fails (`lib/repeat-orders.ts:142-145`). The customer sees a generic error with no link to fix the address.

### M3 — Auto-flip cron leaves no audit trail on no-op runs
**Location:** `lib/seasons.ts` `autoOpenScheduledSeasons` (lines 8-12).
**Claim:** When the cron runs and opens zero seasons, no `CronRunLog` row is written, so there is no evidence the cron fired at all.
**Evidence:** `if (opened.count > 0) { await prisma.cronRunLog.create(...) }` (`lib/seasons.ts:8-11`). The "why didn't my season open?" debugging path has no cron-side evidence. Other crons in the harness (e.g. `payment-reminders`, `pickup-expiry`) were not inspected for comparison within P10 scope, but the EXPECTED S2 check ("scheduled auto-flip opens season at the configured time") has no negative-case evidence.

### M4 — "New-season setup wizard" is a single flat form, not a wizard
**Location:** `app/admin/seasons/page.tsx` (New-season setup form, lines 72-80).
**Claim:** The R-097 "new-season setup wizard" deliverable is implemented as a one-step form (name, year, optional opensAt) with no guided flow, no catalog-cloning step, and no replacement-mapping assistance.
**Evidence:** The form posts `action: "create"` with three fields (`app/admin/seasons/page.tsx:43-48`). The plan §P10 deliverables calls for "New-season setup wizard (R-097)" alongside replacement mappings and repeat — implying the wizard should walk a manager through preparing a season (catalog, replacements, open gate). Here the wizard is just the season row creator; replacement mappings live in a separate card with no connection to the season being prepared.

### M5 — Smoke tests exercise library code, not the HTTP API or UI
**Location:** `scripts/smoke-p10.ts` (S1 lines 58-68, S2 lines 70-80, S3 lines 82-84).
**Claim:** S1 and S2 pass at the library level but do not verify the EXPECTED flows through the routes or the review page.
**Evidence:** S1 calls `resolveReplacementChain`, `createRepeatDraft`, `readRepeatDraft`, `confirmRepeatDraft` directly (`smoke-p10.ts:58-67`) — it never hits `/api/repeat/[draftId]` or renders `RepeatOrderReview`. The "review page forces a replacement pick" claim is asserted only by the server-side `confirmRepeatDraft` check, not by any UI behavior. S2 calls `autoOpenScheduledSeasons()` directly (`smoke-p10.ts:78`) — it does not verify the `/api/cron/season-auto-flip` bearer auth, nor the bulk `/api/admin/repeat` endpoint. The cron auth path (`lib/cron-auth.ts`) is not exercised by P10 smoke.

### M6 — `confirmRepeatDraft` deletes OrderLines but not Packages
**Location:** `lib/repeat-orders.ts` `confirmRepeatDraft` (line 153).
**Claim:** A second confirm on the same draft orphans any Packages created by the first confirm.
**Evidence:** `await transaction.orderLine.deleteMany({ where: { orderId: draftId } })` (`lib/repeat-orders.ts:153`) clears lines but the transaction never touches `Package` or `PackageLine`. A fresh draft has no packages, so the first confirm is safe, but if a customer navigates back and re-confirms, the prior confirm's packages (created by checkout/finalize downstream) would reference now-deleted OrderLines. The flow is not idempotent.

### M7 — Admin seasons page is not marked `force-dynamic`
**Location:** `app/admin/seasons/page.tsx` (no `export const dynamic`).
**Claim:** The admin seasons page may be statically cached, showing stale season status to managers.
**Evidence:** The file has no `export const dynamic = "force-dynamic"` (compare `app/repeat/[draftId]/page.tsx:7` which does set it). The page is a client component (`"use client"`) that fetches via `useEffect`, so the initial HTML shell could still be cached. For an admin operations page that flips season status, this is a freshness risk.

## Low

### L1 — Replacement chain BFS has no depth limit
**Location:** `lib/repeat-orders.ts` `replacementCandidates` (lines 20-46).
**Claim:** A pathological chain across many seasons performs one DB query per frontier wave with no upper bound.
**Evidence:** The `while (frontier.length > 0)` loop (`lib/repeat-orders.ts:25`) terminates only via the `visited` set. Cycles are prevented, but a 50-season chain does 50 sequential `productReplacement.findMany` calls. No `maxDepth` guard.

### L2 — Auto-flip uses UTC, not org-local timezone
**Location:** `lib/seasons.ts` `autoOpenScheduledSeasons(now = new Date())` (line 3).
**Claim:** The cron compares `opensAt` against UTC now, but the plan assumes org-local timezone (UR-008 open question, arm-02 risk #9).
**Evidence:** `now = new Date()` is UTC. The plan §4 open question #7 explicitly lists "Seasonal auto-flip timezone (UR-008) — assumed org-local; confirm." Not resolved in P10. Acceptable as an open question, but worth noting.

### L3 — `confirmRepeatDraft` creates no Package records
**Location:** `lib/repeat-orders.ts` `confirmRepeatDraft` (lines 152-181).
**Claim:** After confirm, the draft has OrderLines but no Packages; the repeat flow depends on checkout/finalize to materialize packages.
**Evidence:** The transaction creates `order.lines` (`lib/repeat-orders.ts:170-178`) and updates `wireFormat.lines` with recipient `{ kind: "saved", addressId }` (`lib/repeat-orders.ts:163-167`), but no `package.create`. The redirect target `/checkout` (`repeat-order-review.tsx:50`) must accept this shape. Not verified by P10 smoke.

### L4 — S3 smoke does not separately verify address-book or migration hook
**Location:** `scripts/smoke-p10.ts` S3 (lines 82-84).
**Claim:** S3 asserts `customerId`, `quantity`, and greeting but does not independently verify the address-book entry resolved against imported history or exercise the P12 migration hook.
**Evidence:** S3 reuses the same customer's address created inline (`smoke-p10.ts:48-56`); it does not test an imported address-book entry from a legacy source. The plan says "stub/migration hook OK" for S3, so this is acceptable, but the assertion is shallow.

## Summary

- High: 3
- Medium: 7
- Low: 4
- Total: 14
