# Test 5 — self-fix pass — arm-04

One pass against `results/SELF-REVIEW.md` (1 blocker, 4 majors, 12 minors). The blocker and all four
majors are fixed. Eight of the twelve minors are fixed — the ones that fit inside the same edits or are
a line each. Four are skipped with reasons below. No new product decisions; nothing outside the review.

One schema change was needed (F-03): `Customer.mergedIntoCustomerId`, in migration
`20260727110000_p12_self_fix_customer_merge`.

## Fixed — blocker and majors

| ID | What changed |
|---|---|
| **F-01** (blocker) — a correct payment refunded because the order was already being packed | `src/lib/orders/state-machine.ts` now owns `PAYABLE_STATUSES` (`PLACED`, `IN_FULFILLMENT`) behind `isPayableOrderStatus`, and both money paths read it: `webhook-service.ts` decides `orderIsOpen` from it instead of testing `status !== 'PLACED'`, and `offline-payments.ts` uses it for the counter's own gate, so the two cannot drift again. A card webhook that is delayed, retried, or lands after staff started packing now posts the payment. The auto-refund is left for the two cases it was written for: a closed order, and an amount that is not `order.totalCents` — and the message says which of the two it was. New tests: *a correct charge is kept when the order has already gone to packing*, *a wrong amount is still handed back once packing has started*. |
| **F-02** (major) — `AMOUNT_MISMATCH` compared the intent to itself | `src/lib/payments/reconciliation.ts` compares the posted payment against `intent.order.totalCents` and reports that as `expectedCents`, so the case the module documents — an order edited after it was paid, a partial capture — is actually detected. The payments report column is relabelled **Expected** (`admin/reports/payments/page.tsx`), because the number is now what the order costs rather than what was recorded twice. New test: *an order edited after it was paid shows up as an amount mismatch*. |
| **F-03** (major) — a merged-away account was still a live identity | The duplicate now keeps its row (past order lines still point at its archived addresses) but stops being an account: `Customer.mergedIntoCustomerId` points at the survivor, and `mergeCustomer` moves `externalAuthId` to the survivor when the survivor has none. Every lookup that resolves a *person* is handed on through `survivorOf` — `findCustomer` (sign-in), `findOrCreateLocalCustomer`, the counter's find-or-create, and the guest claim in `checkout-service.ts` — so the household lands on the account that has their history instead of the shell the merge emptied. The counter's search excludes merged-away rows, and `attachExternalId` no longer overwrites a login already recorded on a customer. New test: *merging two accounts sends the household to the one that has the history*. |
| **F-04** (major) — the export log recorded the opposite of what the file promised | `csvExportResponse` produces one page per `pull(controller)`, so the next query only runs when the browser has taken the last page — the paging now avoids the in-memory copy it was written to avoid. `stampExport` writes the rows and bytes that actually went out, with `completedAt` set from the final `pull` and left **null** from `cancel()`. An abandoned download is now a row that says it stopped part way. New tests: *an export is stamped complete only once the client has taken the rows*, *an export the client abandons stops there and is not stamped complete*. |
| **F-05** (major) — two rules for "who did this" under impersonation | One rule, applied everywhere: every attribution column is written from `actor.id`, the same person `recordAudit` names — offline payments and voids, `ExportLog.staffUserId`, media uploads, import staging, the legacy import, cleanup resolutions, email template and campaign edits, and the reconciliation run. `acting` is left only where it is a scoping key rather than attribution: which permissions apply, the POS till, the driver's own run. The rule and its reasoning are written on `StaffContext` itself, so the next caller reads it before choosing. I did not add `onBehalfOfStaffUserId`: `AuditEvent.impersonatedStaffUserId` already records the seat for every one of these actions, so a second column would be a second place to keep it correct. |

## Fixed — minors that fit

| ID | What changed |
|---|---|
| **F-07** | The first-manager row goes through `recordAudit` with `'setup.first_manager_created'` declared in `AuditDetails`, so no action bypasses the map. Its label is now `system` rather than `first-run setup`, which is what every other actor-less row says. |
| **F-09** | `prior-year-orders.ts` throws a named error when an archive product is missing instead of writing `productId: ''` — a foreign key to nothing, hiding a data problem behind a constraint error. |
| **F-11** | `resetSeason` returns `ResetSummary` (`ordersDeleted`); `wipeTransactionalData` returns `WipeSummary`, which adds `customersDeleted`. The screen no longer prints a zero nobody computed. |
| **F-13** | `makeRoom` clears lapsed windows and, if the map is still at the cap, drops the oldest live one — so `MAX_TRACKED_KEYS` is a cap, as its comment claims. The comment now says what it costs: one caller gets a fresh window rather than the process getting unbounded growth. |
| **F-14** | `intentIds` is built from every `stripePaymentIntent` with a non-null `stripeIntentId`, so a payment whose attempt row is still `open` is no longer reported as having no checkout attempt on file. The `paid` filter stays on the orphaned-intent scan, which is the question it belongs to. |
| **F-15** | `STRIPE_WEBHOOK_SECRET` ships a self-describing placeholder in the same style as `AUTH_SESSION_SECRET`, so the generated `.env.example` explains what to put there. It is long enough to clear the length floor and is rejected on purpose by the weakness check, which is the point. No provider-shaped literal is written anywhere. |
| **F-16** | `checkSecretStrength` runs the placeholder-and-entropy check over all three bearer secrets, each with the length floor it already had, and only once the length is out of the way so one bad value is one message. New test: *a placeholder long enough to pass the length floor is rejected on every bearer secret*. |
| **F-17** | A guest claim is rolled back when `finalizeOrder` fails, the same way the total-mismatch branch already undoes a placement — so a cart that was never placed is not waiting in that account the first time somebody signs in with the address. New test: *a guest checkout that cannot be placed leaves nobody holding the cart*. |

## Skipped

| ID | Why |
|---|---|
| **F-06** — no expiry or purpose tag on signed cookies | Real, and not a one-line change: it re-shapes `signCookieValue`/`readSignedCookieValue` and the three credentials that use them (staff session, impersonation stamp, driver session), each of which needs its own purpose, its own lifetime chosen, and a test that an expired or cross-purpose value is refused. That is a security pass of its own, not a self-fix rider on a payments and merge pass. |
| **F-08** — body cap applied after the body is buffered | Needs a size-limited reader on both public endpoints and a decision about requests that omit `content-length`. Changing how a webhook body is read is exactly the kind of edit that wants its own verification run against the signature path. |
| **F-10** — checkout idempotency key can collide on a double-click | Agreed and worth doing, but the fix needs a per-attempt key on the row — a second migration in this pass — plus P2002 handling that returns the existing session. The loopback gateway hands back a fresh session per call, so the failure this prevents cannot be exercised here; it would ship unverified. |
| **F-12** — `smoke-p12.ts` is 1102 lines | A mechanical split of a test harness with no behaviour change, in the file every later phase appends to. It would be the largest diff in this pass and would touch none of the findings it sits beside. |

## Verification

Everything below was run after the last edit, against web 3104 / db 4104.

| What | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run db:guard` | schema and migrations agree; all 8 CHECK constraints survive the replay |
| `npm test` | **234/234 pass**, 0 fail — 226 at the end of Test 4, plus 8 new cases: F-01 ×2, F-02, F-03, F-04 ×2, F-16, F-17 |
| Smoke, all twelve phases in order from `npm run db:fresh` | see the table below |

The phase smokes build on the data the earlier phases leave behind, so they were re-run as one chain from
an empty database rather than individually.

| Phase | Result |
|---|---|
| P1 | 28/28 |
| P2 | 21/21 |
| P3 | 39/39 |
| P4 | 26/26 |
| P5 | 29/29 — includes the webhook, refund and offline-payment checks F-01 and F-05 changed |
| P6 | 23/23 |
| P7 | 21/21 |
| P8 | 16/16 |
| P9 | 24/24 |
| P10 | 21/21 |
| P11 | 27/27 |
| P12 | 28/28 — includes the five dataset exports (F-04), the reconciliation sweep (F-02, F-14), the cleanup queue merge (F-03) and the full end-to-end rehearsal |
