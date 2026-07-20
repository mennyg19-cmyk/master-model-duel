# Decision log

Business-logic decisions made without an explicit spec answer, flagged per
workflow. Newest last. (P4 entries moved here from `.scratch/PHASE-P4-STATUS.md`.)

## P4 — order builder, address book, customer account

- **DECISION-P4-1 (draft ≠ Order):** builder drafts are a new `OrderDraft` row holding the cart as validated JSON. Mid-build lines have no recipient, which would break Order/OrderLine's finalize invariants; P5 checkout converts ACTIVE drafts into real Orders and marks them COMPLETED (the only guest-clear path).
- **DECISION-P4-2 (customer auth):** mirrors P1 dev-mode staff auth (scrypt + HMAC-hashed DB session) in a separate table + cookie (`tomchei_customer`) so customer and staff identity can never cross. Clerk path unchanged behind AUTH_MODE=clerk (no keys in harness). Seed credential: sample.customer@example.com / customer-demo-1234.
- **DECISION-P4-3 (no external address/geocode APIs):** no API keys exist in this environment. Autocomplete = customer's saved book + a local delivery-area street index; geocode = local ZIP-centroid provider through the GeocodeCache contract (R-162). Each is one function to swap for a real provider.
- **DECISION-P4-4 (on-order semantics):** the "on-order" pick means the address typed on this order (usually the buyer), stored once per draft as `cart.onOrderRecipient` — it is not saved to the address book. The assignment dialog states this and warns before an edit re-addresses already-assigned on-order lines.
- **DECISION-P4-5 (issues don't block autosave):** `priceCart` reports stock/option/restriction problems per line but saving never fails on them — autosave must not lose work; checkout (P5) is the gate that refuses a cart with issues.

## P4 fix pass

- **DECISION-P4-6 (registration matches by email only):** `findOrLinkCustomer` no longer matches or links by phone. Possessing a phone number proves nothing, so a phoneless staff-created customer record must not be claimable by whoever types that number at registration (B1). Phone-based dedupe of staff-entered orders becomes a staff-side concern; a phone number already on another record is stored raw-only (unique `phoneNormalized` stays consistent).
- **DECISION-P4-7 (register is anti-enumeration, like login):** registration always answers `200 {ok:true}`. Fresh/passwordless email → password set + session; already-registered email → no state change (unless the supplied password happens to be correct, which is just a sign-in). The old `409 "already exists"` confirmed which emails hold accounts. Residual: session-cookie presence still differs — full indistinguishability needs an email-verification flow, out of scope for dev auth.
- **DECISION-P4-8 (X-Forwarded-For is untrusted by default):** `clientIp` ignores XFF unless `TRUST_PROXY=true` (deployed behind exactly one reverse proxy, in which case the last hop — the one the proxy appended — is used). Direct-served dev shares one `"direct"` rate-limit bucket; limits were sized to tolerate that.
## P5 — checkout, delivery fees, Stripe, order lifecycle

- **DECISION-P5-1 (no Stripe keys → mock gateway, real path):** the harness has no Stripe account. The gateway is real REST-over-fetch when STRIPE_SECRET_KEY is set; without it, a mock hosted-checkout page signs and posts checkout.session.completed through the REAL webhook route, so signature verification, idempotency, amount safety, finalize, and refunds run identical code in both modes. No stripe npm package (resolution 8b + dependency ladder).
- **DECISION-P5-2 (order created at pay-time, stock reserved at webhook):** checkout converts the draft into a DRAFT Order with full price snapshots but reserves NO stock; reservation happens inside finalizeOrder when the payment webhook lands. An abandoned Stripe session never holds inventory. A retry for the same builder draft discards and replaces its predecessor order (one draft = one payable order).
- **DECISION-P5-3 (refunds are negative payment rows):** refunds land as negative-amount POSTED Payment rows keyed by the unique stripeRefundId — recalcPaymentStatus needs no changes and refund sync is idempotent by construction.
- **DECISION-P5-4 (guest cookie cleared on success page):** webhooks have no browser cookies, so the webhook completes the OrderDraft row and the success page drops the guest cookie after verifying the cookie's own draft is COMPLETED.
- **DECISION-P5-5 (fee semantics):** bulk delivery bills per distinct destination ADDRESS (two recipients at one address share a fee); per-package bills per RECIPIENT with the hard zip block and a required Purim-week day. Shipping uses the first configured flat rate as the placeholder until P8's Shippo margin engine (R-032).
- **DECISION-P5-6 (charged-amount safety on both sides):** the webhook requires amount_total to equal both the session's amount and the order's current total, and the order to still be a live DRAFT with an open session; anything else is auto-refunded in full and the order discarded, with BOTH sides (charge in, refund out) recorded so the books match Stripe.

- **DECISION-P4-9 (guest sign-in drops the guest draft cookie):** login/register/logout clear `tomchei_guest_draft` so a shared-device guest draft (recipient names, addresses) can never re-attach to the next user. A guest's draft row is untouched; merging a guest cart into a customer account on sign-in is a product feature deferred with a note, not silently half-done.
