# Reviewer specialist — Clean-code

**Arm:** `arm-06` (blind — no model names)
**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Tree / phase:** P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments
**Rule source:** `arms/arm-06/.cursor/rules/clean-code.mdc` (active)
**Reviewer scope:** Findings only, no fixes. Severity: Blocker / Major / Minor.

## Scope reviewed

P5 surface: `lib/checkout/{checkout,fulfillment,validate,reservations}.ts`, `lib/payments/{stripe,post}.ts`, `lib/public-guard.ts`, `lib/orders/{state-machine,drafts,numbers,guest-token,guest-draft-cookie,resolve-lines}.ts`, `lib/inventory/reserve.ts`, `lib/{rate-limit,audit,permissions,money,errors,api-fetch,parse-body,text}.ts`, `app/api/checkout/{submit,pay}/route.ts`, `app/api/webhooks/stripe/route.ts`, `app/api/admin/orders/[orderId]/{finalize,payments}/route.ts`, `app/api/admin/payments/[paymentId]/void/route.ts`, `app/(storefront)/checkout/{page.tsx,checkout-form.tsx,zip-check-form.tsx}`, `app/(admin)/admin/settings/settings-tabs.tsx` (Shipping tab), `prisma/schema.prisma` (P5 models).

---

## Findings

### Major-1 — Client/server bulk-delivery dedupe keys diverge (duplicated logic + drift)

`checkout-form.tsx:87-104` claims to "mirror the server's fee math for display only," but the bulk-delivery dedupe key is a different function than the server's `bulkAddressKey`.

Server (`lib/checkout/fulfillment.ts:84-94` + `checkout.ts:140-151`):

```84:94:lib/checkout/fulfillment.ts
export function bulkAddressKey(parts: {
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}): string {
  return [parts.line1, parts.city, parts.region, normalizePostalCode(parts.postalCode), parts.country]
    .map((part) => normalizeWhitespace(part).toLowerCase())
    .join("|");
}
```

Client (`app/(storefront)/checkout/checkout-form.tsx:93-96`):

```93:96:app/(storefront)/checkout/checkout-form.tsx
        const key = normalizePostalCode(recipient.postalCode) + recipient.addressLine.toLowerCase();
        if (!seen.has(key)) fee = feeRules.bulkPerDestinationCents;
        seen.add(key);
```

`addressLine` is the formatted `${line1}${line2 ? `, ${line2}` : ""}, ${city}, ${region} ${postalCode}` string from `page.tsx:146`. Differences:

1. The client does **not** call `normalizeWhitespace` on the address parts — it only lowercases the formatted string. A recipient stored with `line1 = "123  Main St"` (double space) collapses to `"123 main st"` on the server but stays `"123  main st"` on the client. Two recipients that the server treats as one destination (one fee) can render as two fees on the client, or vice versa.
2. The client key includes `line2` (via `addressLine`); the server's `bulkAddressKey` does **not**. Two recipients sharing line1/city/region/zip but differing in line2 dedupe on the server but not on the client.

Net effect: the displayed total can differ from the server's frozen total on bulk-delivery orders, surfacing as a misleading 409 "totals changed since the draft was saved" on a clean re-submit. The rule (`clean-code.mdc` Consistency / one pattern per concern; duplicated logic with minor variations) is violated twice over — the math is duplicated *and* the two copies use different keys.

**Severity: Major.** Fix is to expose `bulkAddressKey` from `fulfillment.ts` and call it from the client with the recipient's structured fields (pass `line1/city/region/postalCode/country` into the component instead of the pre-formatted `addressLine`).

---

### Major-2 — `lib/checkout/checkout.ts` is a mixed-concerns module (406 lines, 7+ exports)

`clean-code.mdc` Abstraction Discipline: "Split files by concern, not by line count — split when >500 lines, mixed concerns, or a refactor command." Mixed concerns applies here regardless of the sub-500 line count.

`lib/checkout/checkout.ts` exports: `OfflinePaymentForbiddenError`, `submitCheckout`, `CheckoutSummary`, `payCheckout`, `StripeSessionCompleted`, `completeCheckoutSession`, `expireCheckoutSession`, `syncChargeRefunded`, `finalizePosOrder` — plus private helpers `loadAccessibleOrder`, `orderRefForSession`, `findOrderForSession`, `safetyRefund`. That is the entire checkout lifecycle: public submit, hosted-Stripe handoff, webhook completion, session expiry, refund sync, POS finalize, and the safety-refund side-path. Each is a distinct stage with its own callers and its own audit semantics.

Suggested split by concern (each a clear single concern, not a line-count chop):
- `lib/checkout/submit.ts` — `submitCheckout`, `OfflinePaymentForbiddenError`, `CheckoutSummary`, `loadAccessibleOrder`.
- `lib/checkout/pay.ts` — `payCheckout`.
- `lib/checkout/webhook.ts` — `completeCheckoutSession`, `expireCheckoutSession`, `syncChargeRefunded`, `safetyRefund`, `StripeSessionCompleted`, `orderRefForSession`, `findOrderForSession`.
- `lib/checkout/pos.ts` — `finalizePosOrder`.

`reservations.ts` already broke out one shared seam for a module-cycle reason; the same discipline applies to the four lifecycle stages co-located here.

**Severity: Major.**

---

### Minor-1 — Duplicated greeting-remembering loop (Rule of 2 met)

The "remember effective greeting on each book-linked recipient" block appears verbatim in two functions in `lib/checkout/checkout.ts`:

```360:366:lib/checkout/checkout.ts
    for (const recipient of order.recipients) {
      if (!recipient.addressId) continue;
      const greeting = effectiveGreeting(recipient.greeting, order.greetingDefault);
      if (greeting) {
        await tx.address.update({ where: { id: recipient.addressId }, data: { lastGreeting: greeting } });
      }
    }
```

and again:

```426:432:lib/checkout/checkout.ts
    for (const recipient of order.recipients) {
      if (!recipient.addressId) continue;
      const greeting = effectiveGreeting(recipient.greeting, order.greetingDefault);
      if (greeting) {
        await tx.address.update({ where: { id: recipient.addressId }, data: { lastGreeting: greeting } });
      }
    }
```

Two real call sites right now (`completeCheckoutSession`, `finalizePosOrder`). Extract `rememberGreetings(tx, order)`.

**Severity: Minor.**

---

### Minor-2 — Duplicated stock-commit + reservation-clear block (Rule of 2 met)

Same two functions repeat the stock commit + `stockReserved=false` update:

```331:335:lib/checkout/checkout.ts
    const needs = await inventoryNeedsForLines(tx, order.lines);
    for (const [itemId, qty] of needs) {
      await commitStockTx(tx, itemId, qty, true);
    }
    await tx.order.update({ where: { id: order.id }, data: { stockReserved: false } });
```

and:

```420:424:lib/checkout/checkout.ts
    const needs = await inventoryNeedsForLines(tx, order.lines);
    for (const [itemId, qty] of needs) {
      await commitStockTx(tx, itemId, qty, true);
    }
    await tx.order.update({ where: { id: order.id }, data: { stockReserved: false } });
```

Extract `commitOrderReservation(tx, order)`. Pairs with Minor-1 — both duplications live in the same two functions and would collapse together if a shared `finalizeSubmittedOrder(tx, order)` helper absorbed the post-submit commit + greeting + finalize core.

**Severity: Minor.**

---

### Minor-3 — Duplicated checkout access-context construction

`app/api/checkout/submit/route.ts:28-33` and `app/api/checkout/pay/route.ts:30-34` build the same `access` object:

```28:33:app/api/checkout/submit/route.ts
  const customerCtx = await getCustomerContext();
  const access = {
    customerId: customerCtx?.customer.id,
    guestToken: await readGuestDraftToken(parsed.data.draftRef),
  };
```

Two call sites, identical. A `checkoutAccess(draftRef)` helper in `lib/orders/drafts.ts` (next to `DraftAccess`) would dedupe and keep the session-or-guest-token ownership rule in one place. Borderline under "if removing duplication adds more lines than it saves" — but the ownership construction is a security-relevant pattern worth centralizing.

**Severity: Minor.**

---

### Minor-4 — Duplicated same-origin + rate-limit guard preamble

Both checkout routes repeat the same 5-line public-guard preamble:

```19:23:app/api/checkout/submit/route.ts
  const originBlock = assertSameOrigin(request);
  if (originBlock) return originBlock;
  if (!checkoutRateLimit(clientIp(request.headers) ?? "unknown")) {
    return NextResponse.json({ error: "Too many checkout attempts — try again in a minute" }, { status: 429 });
  }
```

(`pay/route.ts:21-25` is identical.) Two call sites now; a third public mutation route would tip this over. A `guardPublicCheckoutMutation(request)` returning `NextResponse | null` would consolidate the 429 message string (currently duplicated verbatim) and the guard order.

**Severity: Minor.**

---

### Minor-5 — Duplicated domain-error → HTTP mapping pattern (5 sites)

Five P5 routes repeat the same `NotFoundError → 404, DomainRuleError → 422, rethrow` ladder, each with one or two extra branches:

- `submit/route.ts:38-49` adds `OfflinePaymentForbiddenError → 403`, `CheckoutConflictError → 409`.
- `pay/route.ts:41-52` adds `StripeNotConfiguredError → 503`.
- `finalize/route.ts:29-37`, `payments/route.ts:55-63`, `void/route.ts:38-46` are the plain ladder.

`lib/errors.ts` already owns `NotFoundError` / `DomainRuleError`; a sibling `mapDomainError(error, extras)` that returns a `NextResponse | null` (and accepts an `extras` map for the route-specific typed errors) would collapse the five copies and keep the error-handling approach "one per project" per `clean-code.mdc` Consistency.

**Severity: Minor.**

---

### Minor-6 — `// P5:` change-explanation comment prefixes

`clean-code.mdc` Comment Quality: "No change-explanation comments ('Updated to fix the bug', 'Added per user request')." Several P5 files carry `// P5: ...` prefixes that mark *when* a block was added rather than *why* it exists:

- `lib/orders/drafts.ts:121` `// P5: editing after checkout started returns the reservation...`
- `lib/orders/drafts.ts:146` `// P5: editing after checkout started returns the reservation and kills the session`
- `lib/orders/state-machine.ts:38` `// P5: the checkout engine finalizes inside its own transaction`
- `lib/inventory/reserve.ts:21` `// P5: the checkout engine runs reserve/release/commit inside its own transaction`
- `lib/payments/post.ts:5` `// P5: checkout/POS engines post and void inside their own transactions`
- `lib/checkout/reservations.ts:4` `// P5 stock lifecycle shared by drafts (save/cancel release) and checkout`
- `lib/checkout/checkout.ts:81` (implied by surrounding `// Step 1 ...` / `// Step 2 ...`), `:299`, `:403` carry phase/step markers.

The "why" content of each comment is good and should stay; the `P5:` / `Step N` prefixes are the change-explanation tics and should be dropped so the comments read as durable intent rather than changelog entries.

**Severity: Minor.**

---

### Minor-7 — `fulfillmentChoice` schema-as-string vs typed enum (type/schema drift)

`prisma/schema.prisma:389` declares `fulfillmentChoice String?` as a free string, while code treats it as a closed enum:

```12:13:lib/checkout/fulfillment.ts
export const FULFILLMENT_CHOICES = ["PICKUP", "BULK_DELIVERY", "PER_PACKAGE_DELIVERY"] as const;
export type FulfillmentChoice = (typeof FULFILLMENT_CHOICES)[number];
```

The zod schema (`recipientChoiceSchema`) validates the enum on the way in, but nothing at the schema/DB level stops a stray write (a future script, a manual fix, a Prisma raw query) from storing `"FOO"`. Readers of `order.recipients[].fulfillmentChoice` get `string | null`, not the union. `clean-code.mdc` Abstraction Discipline flags "Type/schema drift — centralize types, single source of truth." The enum is the single source of truth in code; the column should reflect it (Prisma enum, or at minimum a DB CHECK constraint in the migration).

**Severity: Minor.**

---

### Minor-8 — Unsafe cast of webhook `data.object` to `StripeSessionCompleted`

`app/api/webhooks/stripe/route.ts:48-50` casts arbitrary webhook JSON:

```48:50:app/api/webhooks/stripe/route.ts
      const result = await completeCheckoutSession(
        event.data.object as unknown as Parameters<typeof completeCheckoutSession>[0],
      );
```

`event` itself is `JSON.parse(rawBody) as StripeEvent` (line 34) — also unvalidated. The signature check guarantees authenticity, but the *shape* of the payload is still external input asserted via `as unknown as ...`. `completeCheckoutSession` reads `session.id`, `session.amount_total`, `session.payment_intent`, `session.client_reference_id`, `session.metadata.orderId` — a malformed (but correctly signed) payload yields `undefined` flowing into domain logic rather than a clean 400. `clean-code.mdc` Anti-AI-Tics: "No redundant type assertions the compiler already guarantees" — this is the inverse: the compiler guarantees nothing here. A zod schema for the three webhook event shapes (`checkout.session.completed`, `checkout.session.expired`, `charge.refunded`) would make the assertion honest and the 400 path explicit. (Same applies to `expireCheckoutSession` and `syncChargeRefunded` casts on lines 54-55 and 59-60.)

**Severity: Minor** (clean-code lens; a security reviewer may rate higher).

---

### Minor-9 — Vague standalone names

- `lib/rate-limit.ts:17` `function hit(key: string, limit: number, now: number): boolean` — `hit` is a vague standalone name (the banned list calls out `temp`, `val`, `item`, etc.; `hit` is the same class). `tryConsume` or `allowRequest` reads as the yes/no the function returns.
- `lib/payments/stripe.ts:21` `let cached: StripeConfig | null = null` — `cached` is a vague standalone name for a module-level singleton. `stripeConfigCache` (or just inline the config object, since it's read once and never invalidated) would be clearer.

**Severity: Minor.**

---

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 9 |
| **Total** | **11** |

The two Majors are the same root theme — the checkout lifecycle is one module in code but spans several concerns, and its fee math is mirrored client-side with a subtly different dedupe key. The Minors are mostly Rule-of-2 duplications and one type/schema drift, all local to the P5 surface.
