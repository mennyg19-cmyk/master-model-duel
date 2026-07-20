# P5 Clean-code Review — arm-02

**Reviewer:** clean-code specialist
**Phase:** P5 (Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments)
**Rules:** `arms/arm-02/.cursor/rules/clean-code.mdc`
**Scope:** P5 touch-set — `lib/checkout/{fees,quote,create-order,recipients}.ts`, `lib/payments/{stripe,webhook-verify,post-payment}.ts`, `lib/domain/{finalize,payment-status}.ts`, `lib/public-guard.ts`, `app/api/checkout/route.ts`, `app/api/checkout/quote/route.ts`, `app/api/webhooks/stripe/route.ts`, `app/api/admin/orders/[id]/{finalize,discard,refund,payments,payments/[paymentId]/void}/route.ts`, `app/(storefront)/checkout/{page,success/page}.tsx`, `app/dev/stripe-checkout/page.tsx`, `app/api/dev/stripe-checkout/route.ts`, `components/checkout/{checkout-form,mock-pay-buttons}.tsx`.

Findings only. No pass/fail verdict. Blind to model name.

---

## Findings

### F1 — Dead exported `voidPayment` (dead code + divergent duplicate)
`lib/payments/post-payment.ts:63-74`

```63:74:lib/payments/post-payment.ts
export async function voidPayment(paymentId: string, staffId: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.state === "VOIDED") return payment;
    const voided = await tx.payment.update({
      where: { id: paymentId },
      data: { state: "VOIDED", voidedAt: new Date(), voidedByStaffId: staffId },
    });
    await recalcPaymentStatus(tx, payment.orderId);
    return voided;
  });
}
```

Zero callers in the workspace (grep confirms). The void route `app/api/admin/orders/[id]/payments/[paymentId]/void/route.ts:27-43` inlines the same void logic itself — and diverges: the route writes an audit row, `voidPayment` does not. So the exported helper is dead AND a divergent duplicate of the live path. Either delete `voidPayment` or have the route call it (and move audit inside). Severity: Medium.

### F2 — Duplicated checkout-context bootstrap (duplicated logic)
`app/api/checkout/route.ts:37-50` and `app/api/checkout/quote/route.ts:17-29` both run the identical 5-step preamble: `guardPublicEndpoint` → `getOpenSeason` → `resolveDraftOwner` → `findActiveDraft` → `buildCheckoutQuote`. Two real call sites now; a third (an order-review/quote endpoint) would copy it again. Extract `loadCheckoutContext(request, bucket, limit)` returning `{ season, draft, quote } | Response`. Severity: Medium.

### F3 — Duplicated issues-flattening expression (duplicated logic)
The exact expression `[...quote.priced.issues, ...quote.priced.lines.flatMap((line) => line.issues.map((issue) => `${line.productName}: ${issue}`))]` appears three times:
- `lib/checkout/create-order.ts:60-63`
- `app/api/checkout/quote/route.ts:42-45`
- `app/(storefront)/checkout/page.tsx:45-48`

Three call sites, one shape. Extract `flattenPricedIssues(priced): string[]` next to `priceCart`. Severity: Medium.

### F4 — Divergent re-implementation of `assignmentKey` in the checkout page (duplicated logic + dead prop field)
`app/(storefront)/checkout/page.tsx:60-66`

```60:66:app/(storefront)/checkout/page.tsx
        recipientKey: line.assignment
          ? line.assignment.type === "onOrder"
            ? "onOrder"
            : line.assignment.type === "addressBook"
              ? `book:${line.assignment.addressId}`
              : "new"
          : "",
```

This re-implements `assignmentKey` (`lib/checkout/recipients.ts:28-35`) inline but returns the literal `"new"` for every `newRecipient` assignment, whereas the real `assignmentKey` returns `new:${recipient|line1|zip}`. Two new-recipient lines at different addresses both collapse to `"new"` here. The `recipients` prop is built from `quote.recipients` (which uses the real key), so the `lines[].recipientKey` value is inconsistent with `recipients[].key`. `CheckoutForm` never reads `lines[].recipientKey` (only `id/productName/quantity/lineTotalCents`), so the field is also dead. Two clean-code violations in one: a divergent duplicate of a shared key fn, and a dead prop field carrying a wrong value — a maintenance trap. Either drop `recipientKey` from the `lines` prop or import and call `assignmentKey`. Severity: Medium.

### F5 — Copy-paste destination-map blocks in `computeFees` (copy-paste with minor variation)
`lib/checkout/fees.ts:63-73` (BULK_DELIVERY) and `92-102` (SHIPPING) build structurally identical `Map<destination, { methodId, label, keys }>` blocks, then two near-identical flush loops at `107-122` differ only in label prefix and which config field supplies `amountCents`. Anti-AI-tics rule: "No copy-paste patterns with minor variations — extract the pattern." A single `accumulateDestination(map, method, recipient, labelPrefix)` helper plus a parameterised flush removes the duplication. Severity: Medium.

### F6 — Inconsistent address normalization (pattern drift / one pattern per concern)
`assignmentKey` (`lib/checkout/recipients.ts:33-34`) normalizes a new-recipient key with `trim().toLowerCase()` joined by `|`; `destinationKey` (`recipients.ts:126-130`) normalizes with `trim().replace(/\s+/g, " ").toLowerCase()`. Two "same address" concepts, two normalization rules — internal whitespace is collapsed in one but not the other. A recipient at `123  Main St` and `123 Main St` collide on destination but not on assignment. One shared `normalizeAddressKey(address)` helper for both. Severity: Medium.

### F7 — Inconsistent validation-error response shape (one error-handling approach per project)
Zod failures across sibling P5 routes return three different shapes:
- `app/api/checkout/route.ts:45` → `{ error: "Checkout payload is invalid" }` (generic, no detail)
- `app/api/checkout/quote/route.ts:25` → `{ error: "Quote payload is invalid" }` (generic)
- `app/api/admin/orders/[id]/refund/route.ts:21` and `.../payments/route.ts:23` → `{ error: parsed.error.issues[0].message }` (first issue message)

Two policies for the same concern. Pick one (first-issue message is the most useful) and apply everywhere. Severity: Low.

### F8 — Magic values
- `lib/checkout/quote.ts:34` — `shippingPlaceholderCents: rates[0]?.amountCents ?? 1500` — bare `1500` fallback cents, unlabeled.
- `.max(200)` for the choices/overrides arrays appears in `app/api/checkout/route.ts:11,16` and `app/api/checkout/quote/route.ts:8` — same magic cap in three places.

Named constants (`DEFAULT_SHIPPING_PLACEHOLDER_CENTS`, `MAX_CHECKOUT_CHOICES`) centralize both. Severity: Low.

### F9 — Redundant non-null assertions (anti-AI-tics)
`lib/checkout/create-order.ts:143` (`customerId!`) and `146`/`149` (`quote.fees!.ok`, `quote.fees!.feesCents`, `quote.fees!.feeLines`). The ok-branch of `quote.fees` is already established at lines 67-73; the `!` re-asserts narrowing the compiler lost across the `$transaction` closure. Bind a local `const fees = quote.fees` (narrowed to the ok variant) before the transaction and drop the bangs. Severity: Low.

### F10 — Duplicate open-season lookup with two accessors (redundant work + pattern drift)
`app/api/checkout/route.ts:40-41` calls `getOpenSeason()`, then `createOrderFromCart` (`lib/checkout/create-order.ts:48`) re-runs `db.season.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } })`. Two queries for the same invariant, via two different accessors (`getOpenSeason` vs raw `findFirst` with its own ordering). Two ways to read "the open season" is exactly the pattern drift the rule warns about. Severity: Low.

### F11 — UI token drift in `mock-pay-buttons.tsx` (rogue styling)
`components/checkout/mock-pay-buttons.tsx:38,46,50` uses raw Tailwind `bg-indigo-600`, `border-slate-200`, `text-slate-600`, `text-red-600` while the rest of the app uses design tokens (`bg-brand`, `border-border`, `text-muted`, `text-danger`). The mock Stripe page is intentionally visually distinct (per its comment), but that distinctness belongs on the page wrapper (`app/dev/stripe-checkout/page.tsx` already styles the page shell), not on a store component using a parallel color vocabulary. Severity: Low.

### F12 — `handleSessionCompleted` orchestrates money writes across multiple transactions (pattern drift)
`app/api/webhooks/stripe/route.ts:84-145` performs `stripeCheckoutSession.update`, then `postPayment` (own tx), then `finalizeOrder` (own tx), then `stripeCheckoutSession.update` (status=completed), then `orderDraft.updateMany` — five separate writes, only some in transactions. A failure between `finalizeOrder` and the session-status update leaves the order finalized but the session record stale. Every other money write in P5 goes through `postPayment`/`recordRefund` (one transaction + status recalc); this orchestration does not follow that pattern. One pattern per concern for money writes. Severity: Medium.

### F13 — Vague standalone names
- `safe` (`app/api/webhooks/stripe/route.ts:95`) — boolean; `chargeSafe` reads as the yes/no question it actually answers.
- `record` (`route.ts:75`) — a `StripeCheckoutSession` row; `sessionRecord`.
- `entry` (`lib/payments/post-payment.ts:8,37`) — the payment input; `paymentInput`.
- `fresh` (`components/checkout/checkout-form.tsx:89,133`) — a quote response; `freshQuote`.

Borderline; `safe` and `record` are the vaguest. Severity: Low.

### F14 — `checkout-form.tsx` mixes concerns (god-file by concern, under 500 lines)
`components/checkout/checkout-form.tsx` is 338 lines combining: quote-fetch effect + abort, order placement + conflict resolution, and the full render of items, per-recipient method grid, greeting/donation, guest contact, and totals. Not over the 500-line threshold, but mixed concerns (state orchestration + four UI sections). Candidate split: a `useCheckoutQuote` hook plus `CheckoutItemsSection` / `CheckoutRecipientSection` / `CheckoutTotalsSection`. Borderline — flag for the next refactor pass, not a blocker. Severity: Low.

---

## Summary

14 findings — **0 High, 7 Medium, 7 Low**.

Highest-impact: **F1** (dead `voidPayment` plus divergent duplicate of the live void path), **F4** (divergent re-implementation of `assignmentKey` producing a wrong-but-unused `recipientKey` prop), **F2/F3** (duplicated checkout-context bootstrap and issues-flattening across 2–3 call sites), **F5/F6** (copy-paste destination-map blocks and inconsistent address normalization), **F12** (money-write orchestration outside the transactional pattern every other payment write follows). The rest are magic-value, naming, redundant-assertion, UI-token, and validation-shape drift per the clean-code rubric.
