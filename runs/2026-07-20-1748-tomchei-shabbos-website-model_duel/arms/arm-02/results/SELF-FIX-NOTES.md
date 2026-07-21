# Test 5 — Self-fix notes (arm-02, single pass)

Fix pass against `results/SELF-REVIEW.md` (0 blockers · 3 majors · 4 minors). All 7 findings fixed. No re-plan; no schema/migration changes.

## Majors

### SR-01 — email verification before claiming an existing customer row (fixed)

Registering against an existing **passwordless** customer (staff phone orders, guest checkout) no longer sets the password directly. The flow now:

- `app/api/account/register/route.ts`: looks the row up directly (no `findOrLinkCustomer` patching by an unverified caller). Fresh emails keep the instant account+session path. Existing passwordless rows get a signed verification email; existing registered rows get a "you already have an account" email (correct password still just signs in). Both existing branches return the same `{ok, pendingVerification}` shape — no enumeration. Outbox rows are deduped per email per 15-minute bucket so registration can't flood an inbox.
- New `lib/auth/registration-token.ts`: HMAC token in the newsletter-token shape but purpose-scoped (`register.` prefix in the MAC input), 24 h TTL — tokens from one flow can't be replayed in the other.
- New `app/api/account/register/complete/route.ts`: verifies the token, attaches the password, creates the session. Rate-limited; 409 if a password landed meanwhile.
- New `app/(storefront)/verify-email/page.tsx` + `components/account/verify-email-form.tsx`: set-password landing page for the emailed link (outside `/account`, whose layout redirects sessionless visitors).
- `components/account/auth-forms.tsx`: shows "check your email" on `pendingVerification` instead of redirecting.

### SR-02 — webhook concurrency claim (fixed)

`app/api/webhooks/stripe/route.ts`: the event ledger is now pending → **processing** → processed. After the unique insert (or P2002), a conditional `updateMany` claims the event; only the delivery whose claim count is 1 proceeds. Concurrent redeliveries of the same event can no longer both pass the `priorCharge` check and double-book the charge row. A crash mid-work leaves the event in `processing`; Stripe's retry reclaims it after a 5-minute grace window (`processedAt` doubles as the claim timestamp), so no event is ever lost.

### SR-03 — TRUST_PROXY rate-limit bucket (fixed)

`lib/env.ts`: production startup (not build phase) now **fails closed** when `TRUST_PROXY` is unset, with a message explaining the shared-bucket lockout DoS. `.env.example` documents it as required in production behind Vercel/any reverse proxy. Dev direct-serve is unchanged.

## Minors

- **SR-04 (fixed)** — `lib/csv.ts` `csvField`: string values starting with `=` `+` `-` `@` get a leading tab and quoting, defanging spreadsheet formula execution in staff exports. Numbers (including negatives) untouched; round-trips through `parseCsv`. Regression test added to `tests/exports-csv.test.ts`.
- **SR-05 (fixed)** — `lib/legacy-import.ts` (547 lines) split by concern into `lib/legacy-import/plan.ts` (parse + normalize + plan, pure) and `lib/legacy-import/commit.ts` (four staged transactions). Pure mechanical move; the two importers (`app/api/admin/legacy-import/route.ts`, `tests/legacy-plan.test.ts`) updated.
- **SR-06 (fixed)** — `lib/env.ts`: the shipped dev `SESSION_SECRET` (`dev-only-secret-not-for-production-1748`) added to the real-mode blocklist alongside the `.env.example` placeholder.
- **SR-07 (fixed)** — `lib/checkout/create-order.ts`: guest checkout with an email belonging to a **registered** account (passwordHash or clerkUserId) now returns a conflict prompting sign-in instead of silently attaching the order. Passwordless staff-created records keep the link (same person, phone + web).

## Verification

- `npm run ci` — PASS end to end: eslint clean, `tsc --noEmit` clean, migration guard "No difference detected", **78/78** unit tests (was 77 + 1 new CSV-injection test).
- `npm run smoke:concurrency` — PASS (1 committed, 9 conflicts).
- Live HTTP smoke against the running dev server (`.scratch/self-fix-smoke.ts`) — **11/11 PASS**: takeover attempt gets `pendingVerification`, no session, no password write; verification email queued with token; tampered token rejected; valid token sets password + session; garbage `/verify-email` token shows the invalid message; two concurrent webhook deliveries of one event → exactly 1 processed + 1 replay; third delivery is a replay no-op.
- SR-03 guard check (`.scratch/env-guard-check.ts`) — PASS: simulated production env without `TRUST_PROXY` refuses startup with the new message.

## Blockers remaining

None. All majors and minors from the self-review are closed.
