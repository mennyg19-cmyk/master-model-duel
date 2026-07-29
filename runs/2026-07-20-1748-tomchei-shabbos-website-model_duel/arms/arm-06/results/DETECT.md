# Test 6 — DETECT (arm-06)

Detection method: read money/security-critical files, then installed deps + `prisma generate` and ran the unit suite (`npm test`). Suite result: 5 test failures caused by real code bugs (below); 4 other failures are missing local env/DB only (SESSION_SECRET, SHIPPO vars, Postgres not running) — not app bugs.

| Bug ID | Location | What's wrong | How you found it |
|---|---|---|---|
| B1 | `lib/checkout/fees.ts:84` | Per-package zip gate is inverted: `if (config.deliveryZips.includes(zip))` pushes the "outside the delivery area" error for IN-zone zips and lets out-of-zone zips through. Reverses rule G-014 (hard zip block) and contradicts the comment on line 83. | Unit tests: "per-package delivery bills per recipient", "hard-blocks out-of-zone zips", and "missing or unlisted delivery day is refused" all fail — test 13's actual error shows zip 08701 (in-zone) being blocked. |
| B2 | `lib/shipping/margin.ts:30` | `chargeCents = perCarrierBest[0].amountCents` charges the LOWEST per-carrier best rate; spec (UR-003, comment lines 3-5) says charge the HIGHEST and keep the spread. Since `buy` is also `[0]`, `marginCents` is always 0 — the tzedakah loses the entire shipping margin. | Unit tests: "charge highest per-carrier best" (expected 1200, got 900), "margin flips with the cheaper carrier" (expected 1900, got 1100), "mock fixtures…ZIP parity" (margin not > 0) all fail. |
| B3 | `lib/public-guard.ts:22` | Fail-open same-origin check: when a request has neither `Origin` nor `Referer`, `isSameOrigin` returns `true`. The docstring on line 9 says "Requests with neither header are refused." Curl-style cross-site posts bypass the CSRF guard on every public state-changing route (checkout, register, etc.). | Code review: `return true` contradicts the function's own contract; guard then only rate-limits by a shared "direct" bucket. |
| B4 | `lib/routes/driver-access.ts:23` | Driver PIN gate disabled: `if (access.link.pinHash && false)` — the `&& false` makes the whole PIN/cookie check dead code. Anyone with a route magic-link URL gets full driver access without the PIN, defeating UR-015 and the lockout logic in `lib/routes/links.ts` (which itself is intact). | Code review: constant-false condition; grep for `&& false` patterns confirmed this is the only one in the tree. |
| B5 | `components/checkout/checkout-form.tsx:109` | `placeOrder` POSTs to `/api/checkout/start`, but no such route exists — the checkout handler is at `app/api/checkout/route.ts` (`/api/checkout`), and `next.config.ts` has no rewrites. Clicking "Pay with card" always 404s and shows "Could not start the payment". Checkout is completely broken. | Route audit: glob of `app/api/checkout/**` shows only `route.ts` and `quote/route.ts`; grep for `checkout/start` has exactly one hit (this fetch). |

## Observation (likely seed-tool collateral, reporting for completeness)

| Bug ID | Location | What's wrong | How you found it |
|---|---|---|---|
| B6 | `components/checkout/checkout-form.tsx` (lines 136, 162, 241, 329), `lib/checkout/fees.ts` error strings, `lib/public-guard.ts:36` | UTF-8 mojibake in user-visible strings: "Ã—" for "×", "â€"" for "—", "â€¦" for "…". Confined to the same files as B1–B5 (rest of the tree is clean), so likely an encoding side effect of whatever rewrote them. Garbled text reaches the UI and API error messages. | Grep for "â€" matches only these 4 files; test 13's failure output shows the mojibake at runtime ("Recipient a â€" ZIP 08701"). |

## Notes

- Nothing fixed; detection only.
- Env/DB-dependent test failures (domain-db, repeat, legacy-plan, media-validation) trace to missing `.env` and no local Postgres — reproduce with env present before attributing to code.
- Suspected un-seeded state: `lib/routes/links.ts`, `lib/checkout/create-order.ts`, `lib/checkout/quote.ts`, `app/api/webhooks/stripe/route.ts`, `app/api/cron/email-log-purge/route.ts` all reviewed clean.
