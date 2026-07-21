# Test 5 — Self-review (arm-02, single mode)

Fresh-context review of `arms/arm-02/workspace/` against the arm rules (`clean-code`, `ponytail`, `workflow`, `vocabulary`) and general correctness/security. Findings only — nothing fixed.

Scope covered: auth (staff/customer sessions, setup, impersonation, login rate limiting), payments (checkout, webhook, refund ledger), finalize/inventory concurrency, cron auth, driver magic links + PIN gate, public-endpoint guard, CSV import/export, env validation, media serving, god-file / naming / comment / error-handling rule compliance.

## Findings

| ID | Severity | Location | Claim | Suggested fix |
|---|---|---|---|---|
| SR-01 | major | `app/api/account/register/route.ts:34-58` (with `lib/customers.ts findOrLinkCustomer`) | No email verification: anyone who knows the email of a passwordless customer record (created by staff phone orders or guest checkout) can register against it, set the password, get a session, and read that customer's full order history and saved addresses (PII) under `/account`. The code comments this linking as deliberate, but the takeover-of-existing-records consequence crosses the "never cut trust-boundary validation" line in `ponytail.md`. | Require a verification step before attaching a password to an existing customer row — e.g. an emailed signed token (the `newsletter-token` HMAC pattern already exists). Fresh emails can keep the instant path. |
| SR-02 | major | `app/api/webhooks/stripe/route.ts:60-71` + `lib/payments/post-payment.ts:12-34` + `prisma/schema.prisma` Payment model | Webhook idempotency is retry-safe but not concurrency-safe: a redelivery of a still-`pending` event falls through and reprocesses. Two concurrent deliveries of the same event can both pass the `priorCharge` check and both `postPayment`, double-booking the positive charge row — `Payment.stripeRefundId` is unique but there is no unique key on the charge side (`stripePaymentIntentId` with `amountCents > 0`). | Claim the pending event with a conditional update (`pending → processing`, proceed only when `count === 1`), or add a partial unique index on positive-amount `stripePaymentIntentId` rows so the second insert fails like refunds do. |
| SR-03 | major | `lib/rate-limit.ts:28-37` (`clientIp`) | With `TRUST_PROXY` unset (the default; nothing sets it in `.env`, `.env.example` deploy guidance, or `vercel.json`, and the app is clearly Vercel-targeted), every client resolves to the shared key `"direct"`. 20 failed login attempts from anyone lock out ALL staff and customers for 15 minutes (`login:ip:direct`), and the per-IP checkout/registration limits become one global bucket — a trivial, anonymous denial of service on sign-in and checkout. | Fail startup (or loudly warn) when `NODE_ENV=production` and `TRUST_PROXY` is false, and document `TRUST_PROXY=true` as required for Vercel; alternatively drop the shared-bucket fallback and rely on per-account limits + PIN-style lockouts when no trustworthy IP exists. |
| SR-04 | minor | `lib/csv.ts:10-18` (`csvField`, used by `lib/exports.ts` datasets) | CSV exports do not neutralize spreadsheet formula injection: customer-controlled values (recipient names, greetings, address lines) that start with `=`, `+`, `-`, or `@` will execute as formulas when staff open the export in Excel. | Prefix such fields with `'` (or a space) in `csvField`, or gate it behind an `escapeFormulas` flag used by the export writer. |
| SR-05 | minor | `lib/legacy-import.ts` (547 lines) | Exceeds the 500-line god-file ceiling that both `clean-code.md` ("split when >500 lines") and `ponytail.md` set. It also mixes concerns: CSV column mapping, plan/dry-run building, and the four staged commit transactions. | Split by concern — e.g. `legacy-plan.ts` (parse + plan/report) and `legacy-commit.ts` (staged transactions); tests already treat the plan separately (`tests/legacy-plan.test.ts`). |
| SR-06 | minor | `lib/env.ts:11` (`PUBLIC_SESSION_SECRET_DEFAULTS`) + `.env:3` | The real-mode blocklist covers only the `.env.example` placeholder (`change-me-to-a-random-string`). The dev `.env` shipped in this tree carries `dev-only-secret-not-for-production-1748`, which is exactly as public but passes the guard — an operator promoting the dev `.env` to real mode gets forgeable staff sessions with no startup error. | Add the shipped dev value to the blocklist, or better: stop shipping a fixed dev secret and have `db-start`/bootstrap generate one into `.env`. |
| SR-07 | minor | `lib/checkout/create-order.ts:89-98` | Guest checkout with an email belonging to an existing registered customer silently attaches the order to that account (`findOrLinkCustomer` matches by email with no verification). The account owner sees a stranger's order in their history; combined with SR-01's linking model this is the same unverified-email root cause on the order path. | When the matched customer already has a `passwordHash` (or `clerkUserId`), prompt the guest to sign in instead of silently linking, or store the order under a separate unclaimed record for staff to merge. |

## Counts

- blocker: 0
- major: 3 (SR-01, SR-02, SR-03)
- minor: 4 (SR-04, SR-05, SR-06, SR-07)

## What was checked and found clean (for the aggregate reviewer)

- Session design (HMAC-keyed token hash, httpOnly/secure cookies, DB-backed revocation) — staff and customer worlds correctly separated.
- Stripe webhook signature verification (timing-safe, timestamp tolerance), fail-closed env guards for real mode, mock gateway exercising the real webhook route.
- Finalize concurrency (guarded status flip, conditional inventory reservation, advisory locks with sorted keys for package find-or-create).
- Cron bearer auth (constant-time, 503 when unset), driver PIN gate (per-link DB lockout + IP throttle), setup route race guard, impersonation permission + audit.
- Refund ledger idempotency (unique `stripeRefundId`, DB-first staff refunds with placeholder collision).
- No empty catch blocks, no TODO/FIXME debt, no narration comments, naming and one-pattern-per-concern rules hold; only two files exceed 400 lines (547 and 475).
