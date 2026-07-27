# P11 fix notes — arm-05

Run: 2026-07-28 01:25 IDT  
Scope: one Test 4 P11 fix pass against `AGGREGATE-REVIEW-P11.md`.

## Fixed

- #1: Preference tokens now carry a key ID and operation audience, expire after seven days, fail closed when signing keys are absent, and use separate preference/unsubscribe capabilities. Confirmation redirects store the scoped capabilities in HTTP-only cookies rather than a query string.
- #2: Confirmation tokens now expire after one day. Existing confirmed or unsubscribed subscribers retain their state when they submit the subscribe form.
- #3: Production startup rejects `EMAIL_TEST_MODE=true`.
- #5 and #9: Outbox completion and failure updates require the original `PROCESSING` claim; stale-claim recovery restores the consumed attempt. Live Resend sends include the stable outbox dedupe key as `Idempotency-Key`.
- #6: Newsletter delivery failures no longer log the raw error object.
- #7: Campaign sends atomically claim only DRAFT campaigns, remain DRAFT when no message is queued, count inserted messages, and write `email.campaign_sent`.
- #15: Admin test sends queue only their test message; they do not sweep unrelated pending outbox messages.
- #29, #33, #34: Resend configuration moved behind the adapter; outbox timing values are named constants.

## Deferred

- #4, #7 remaining audit coverage, #8, #10–#14, #15 repeat-test dedupe, #16–#28, #30–#41 remain outside this single pass.
- #5 still relies on Resend's 24-hour idempotency window for provider-side duplicate suppression; a provider-independent long-running delivery lease remains deferred.

## Verification

- `npx prisma generate` exited 0.
- `npm run typecheck` exited 0.
- `npm run smoke:p11` exited 0: S1–S5 passed; migration `20260728012100_p11_newsletter_security` applied.
