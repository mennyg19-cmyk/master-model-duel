# Test 6 — Vague fix notes (arm-06)

Fixed from the five symptoms only. One-line root causes and diffs:

## 1. Per-package delivery zone inverted
- **Root cause:** `lib/checkout/fees.ts` — the hard zip block pushed the
  "outside the delivery area" error when the ZIP **was** in `config.deliveryZips`,
  and let out-of-zone ZIPs straight through.
- **Fix:** negated the condition: `if (!config.deliveryZips.includes(recipient.address.zip))`.

## 2. Shipping charge = lowest carrier quote (no margin)
- **Root cause:** `lib/shipping/margin.ts` — `chargeCents` was taken from
  `perCarrierBest[0]` (cheapest, list is sorted ascending) instead of the
  highest per-carrier best rate, so charge == buy cost and margin was ~0.
- **Fix:** `chargeCents = perCarrierBest[perCarrierBest.length - 1].amountCents`.
  `buy` stays the cheapest; `marginCents` now reflects the spread (UR-003).

## 3. Checkout/quote APIs accepted headerless cross-origin POSTs
- **Root cause:** `lib/public-guard.ts` — `isSameOrigin` returned `true` when
  neither `Origin` nor `Referer` was present (its own doc comment says such
  requests are refused).
- **Fix:** final fallthrough now returns `false`; curl/server-side POSTs get 403.

## 4. Pay button POST 404
- **Root cause:** `components/checkout/checkout-form.tsx` — the form POSTed to
  `/api/checkout/start`, a route that does not exist; the checkout route lives
  at `/api/checkout` (`app/api/checkout/route.ts`) and returns `{ url }`.
- **Fix:** fetch target changed to `/api/checkout`; Stripe session URL redirect works.

## 5. Driver magic link skipped the PIN gate
- **Root cause:** `lib/routes/driver-access.ts` — the PIN check was disabled by
  `if (access.link.pinHash && false)`, so URL possession alone sufficed.
- **Fix:** restored `if (access.link.pinHash)` — PIN-protected links now return
  `pin_required` until a valid PIN cookie exists.

## Verification
- `npx tsx --test tests/checkout-fees.test.ts tests/shipping-margin.test.ts` — **13/13 pass**.
- Full suite `npm test` — 62 pass / 5 fail; all 5 failures are pre-existing
  environment gaps unrelated to these fixes: DB not running on `127.0.0.1:4106`
  (legacy-plan), `SESSION_SECRET` unset (domain-db, repeat), live-mode Shippo
  account IDs unset (media-validation ×2). None import the changed modules.
- `npm run typecheck` — clean.
