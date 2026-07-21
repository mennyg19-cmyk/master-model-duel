# Test 6 — Detect seeded bugs (arm-02)

Found 5 bugs. Not fixed (per instructions).

| Bug ID | Location | What's wrong | How you found it |
|---|---|---|---|
| D1 | `lib/routes/driver-access.ts` line 23 | PIN gate is dead code: `if (access.link.pinHash && false)` — the `&& false` makes the condition permanently falsy, so a PIN-protected driver magic link never asks for the PIN. Anyone with the URL gets straight into the route (security bypass; defeats UR-015 PIN + lockout). | `npm run typecheck` flagged this file (3 TS errors around the unreachable block); reading the code showed the injected `&& false`. Also the only `&& false` hit in a workspace-wide grep. |
| D2 | `lib/checkout/fees.ts` line 84 | Hard ZIP block for PER_PACKAGE_DELIVERY is inverted: `if (config.deliveryZips.includes(recipient.address.zip))` errors when the ZIP **is** in the delivery area. In-zone recipients are refused ("outside the delivery area") and out-of-zone recipients sail through and get billed the per-package fee — the exact opposite of G-014. The check should be `!includes`. | `npm test`: 3 failures in `tests/checkout-fees.test.ts` (per-package billing, hard zip block, delivery-day tests). Read the function against its own header comment. |
| D3 | `lib/shipping/margin.ts` line 30 | Margin engine charges the **cheapest** rate instead of the highest per-carrier best: `chargeCents = perCarrierBest[0].amountCents` (index 0 of an ascending sort = the buy rate). `marginCents` is therefore always 0 — the tzedakah keeps no spread (UR-003/G-006 broken). Should be `perCarrierBest[perCarrierBest.length - 1].amountCents`. | `npm test`: 3 failures in `tests/shipping-margin.test.ts` (charge/margin assertions, `marginCents > 0`). Code contradicts the doc comment two lines above it. |
| D4 | `components/checkout/checkout-form.tsx` line 109 | "Pay with card" posts to `/api/checkout/start`, but no such route exists — the checkout API lives at `/api/checkout` (only `app/api/checkout/route.ts` and `.../quote/route.ts` exist). Every checkout submit 404s; the form shows the generic "Could not start the payment" error and nobody can pay. | Grepped the app tree for the fetch target: `/api/checkout/start` has no matching route file. File was also in the recently-modified cluster (below). |
| D5 | `lib/public-guard.ts` line 22 | Same-origin guard fails open: when a request has neither `Origin` nor `Referer` header, `isSameOrigin` returns `true`. The doc comment on the function says such requests "are refused". Any non-browser client (curl, scripts) omits both headers, so every state-changing public endpoint (checkout, register, newsletter, etc.) loses its CSRF/same-origin protection (R-122). Should `return false`. | Reviewed the file after spotting it in the modified cluster; the `return true` directly contradicts the docstring one line above the function. |

## Method notes

- Ran `npm run typecheck` (3 errors → D1) and `npm test` (72 pass / 6 fail → D2, D3).
- Cross-checked failing tests against the implementation and each file's own documented intent.
- Corroborating signal: exactly these 5 source files share one `LastWriteTime` (2026-07-21 11:43:36), later than every other source file in the tree — consistent with a single seeding pass. All 5 contain a verified concrete defect; no other file in that cluster exists.
- Not fixed anything; workspace untouched apart from read-only inspection.
