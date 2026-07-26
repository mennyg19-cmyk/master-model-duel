# P5 Rules Review — arm-04 (blind)

Reviewer: external, rules specialist. Scope: P5 delta only (checkout, fees, hosted Stripe, webhook, POS, order lifecycle). Graded against this arm's selected catalog rules: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`. Findings only — no fixes.

## Summary

The P5 delta is unusually disciplined. The ladder is respected (no Stripe SDK — `fetch` against the REST API, `node:crypto` for HMAC), the `Result<T>` pattern is the single error shape, comments explain intent rather than narrate, and the smoke harness exercises the running app over HTTP rather than asserting from code. The findings below are narrow.

## Findings

### Major

1. **Refund-then-transition is not atomic** — `src/lib/payments/webhook-service.ts:234`
   `handBackUnsafeCharge` commits the `PaymentRefund` row in `db.$transaction` (lines 211-232), then calls `await transitionOrder(unsafe.orderId, 'CANCELLED', null)` *outside* that transaction. If the transition fails (race, concurrent cancel, illegal-transition guard), the charge is refunded in full but the order stays `PLACED` — reserved stock is not released and the cached payment status recounts to `UNPAID`/`PARTIALLY_PAID` against a refunded payment. The comment block (lines 184-189) argues for refund-first as a deliberate trade-off, which satisfies `ponytail`'s "never silently choose business logic" rule (the decision is documented), but `clean-code`'s error-handling rule ("error messages say what went wrong AND what the expected state was") is violated by the *outcome*: there is no audit or recovery path that flags a refund whose matching cancel failed. The `payment.auto_refunded` audit row is written inside the inner transaction, so it claims success before the cancel is attempted.

### Minor

2. **Error-code name drift** — `src/lib/checkout/greetings.ts:94,98`
   `setRecipientDeliveryDay` returns `failure(INVALID_GREETING, ...)` for a delivery-day validation failure and `failure(GREETING_NOT_ALLOWED, ...)` for a missing recipient. The error *codes* are greeting-scoped but the *domain* is delivery days. `clean-code` naming: "Function names describe what they DO" — by extension, error codes should describe what broke. A reader tracing a `INVALID_GREETING` log entry for a day-choice failure will be misled. No runtime impact; the public messages are correct.

3. **`payAction` parses the tamper-guard total without a guard** — `src/app/(storefront)/order/checkout/actions.ts:80`
   `expectedTotalCents: Number(trimmedField(formData, 'expectedTotalCents'))` produces `NaN` on an empty or malformed field. `startCheckout`'s `input.expectedTotalCents !== summary.totalCents` check (checkout-service.ts:63) happens to refuse `NaN` correctly, so the failure mode is safe today, but the safety is *incidental* rather than explicit. `clean-code` anti-AI-tics: "No 'just in case' code — every line must have a reason" cuts the other way here too — a one-line `z.number().int()` parse would make the intent observable instead of relying on `NaN !== number`.

4. **`rememberGreetings` writes per-row in a loop** — `src/lib/checkout/greetings.ts:136-141`
   Each recipient's `lastGreeting` is written with a separate `db.customerAddress.updateMany` inside a `for...of`. For an order with N recipients this is N round trips. `ponytail` ladder rung 5 ("one line") does not apply, but `clean-code` consistency ("one data-fetching pattern per project") is fine. This is a minor scale concern only — flagged because P5's own smoke notes the 1k-order/5k-package crunch target (G-024) and the pattern will not scale to a bulk repeat. No correctness issue.

## Rules adherence scoreboard

| Rule | Verdict |
|---|---|
| `ponytail` (ladder, anti-bloat) | Strong. No new deps; Stripe via `fetch`; `node:crypto` for HMAC. `PaymentGateway` abstraction has 2 call sites + 2 impls (Rule of 2 satisfied). |
| `clean-code` (naming, comments, error handling) | One naming drift (finding 2); one non-atomic error outcome (finding 1). Comments are intent-bearing, no narration. |
| `workflow` (verify in running app, gates, security) | Strong. `scripts/smoke-p5.ts` drives the real app over HTTP; CHECK constraint added to `migration-guard.ts`; `.env.example` carries placeholders. |
| `vocabulary` | No command words issued in this delta; n/a. |
| `codegraph` | Not evaluable from the delta alone; no grep-for-structure evidence in P5 files. |

## Counts

- blocker: 0
- major: 1
- minor: 3
