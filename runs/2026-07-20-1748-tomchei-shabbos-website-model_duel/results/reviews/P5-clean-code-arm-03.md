# Reviewer specialist — Clean-code

**Arm:** `arm-03`
**Tree / phase:** P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, POS payments (`arms/arm-03/workspace/`)
**Rules:** `arms/arm-03/rules/clean-code.md`
**Output:** `results/reviews/P5-clean-code-arm-03.md`

Scope: `src/lib/checkout/{session,validation,delivery,greetings}.ts`, `src/lib/payments/{offline,webhook}.ts`, `src/lib/stripe/client.ts`, `src/lib/orders/{finalize,state-machine,lock}.ts`, `src/app/api/{checkout,checkout/offline,checkout/mock-complete,orders/lifecycle,webhooks/stripe}/route.ts`, `src/app/(storefront)/checkout/**`, `src/components/checkout/checkout-client.tsx`.

Focus: duplication, magic values, type drift, god files, error handling, dead code. Findings only.

---

## Findings — 12

### F1. `"US"` magic string — repeat of P4 F4, now 4 new P5 sites
P4 F4 asked for `export const DEFAULT_COUNTRY = "US"` in `src/lib/constants.ts`. That never happened, and P5 adds four more inlined copies:

- `src/lib/checkout/delivery.ts:66` — `(line.country ?? "US").trim().toLowerCase()`
- `src/lib/checkout/delivery.ts:77` — `(line.country ?? "US").trim().toLowerCase()`
- `src/lib/checkout/greetings.ts:21` — `(input.country ?? "US").trim().toLowerCase()`
- `src/lib/checkout/session.ts:253` — `country: line.country ?? "US"`
- `src/lib/orders/finalize.ts:148` — `country: head.country ?? "US"`

`src/lib/constants.ts` still holds only `SETUP_LOCK_KEY`. The next country addition is now a 10-site edit across P4+P5. Add `DEFAULT_COUNTRY` and import it everywhere.

### F2. `feeLines` mapping duplicated 3× in `session.ts`
The identical `order.lines.map((l) => ({ id, recipientName, addressLine1, city, state, postalCode, country, fulfillmentMethodCode }))` block is copy-pasted three times:

```106:115:src/lib/checkout/session.ts
  const feeLines: CheckoutLineForFees[] = order.lines.map((l) => ({
    id: l.id,
    recipientName: l.recipientName,
    addressLine1: l.addressLine1,
    city: l.city,
    state: l.state,
    postalCode: l.postalCode,
    country: l.country,
    fulfillmentMethodCode: l.fulfillmentMethod?.code ?? null,
  }));
```

Byte-identical copies at `src/lib/checkout/session.ts:286-295` and `src/lib/checkout/session.ts:369-378`. Rule-of-2 met (3 sites). Extract `toFeeLines(order): CheckoutLineForFees[]` and call it from `buildCheckoutSummary`, `prepareCheckout`, and `createHostedCheckoutSession`.

### F3. Order-total formula duplicated 3× in `session.ts`
`subtotalCents + breakdown.totalFeeCents + order.donationCents` is recomputed in three places:

- `src/lib/checkout/session.ts:148` — `totalCents: validation.subtotalCents + breakdown.totalFeeCents + order.donationCents`
- `src/lib/checkout/session.ts:320-321` — `const expectedTotal = validation.subtotalCents + breakdown.totalFeeCents + refreshed.donationCents;`
- `src/lib/checkout/session.ts:396-397` — `const amountCents = validation.subtotalCents + breakdown.totalFeeCents + order.donationCents;`

Extract `computeOrderTotal({ subtotalCents, feeCents, donationCents })`. The fee/donation inputs are domain values and the formula will drift the day one of them needs a surcharge or discount.

### F4. `recipients` zod schema duplicated 2× with a minor variation
The recipient array schema is copy-pasted between the two checkout routes:

```18:27:src/app/api/checkout/route.ts
  recipients: z
    .array(
      z.object({
        lineIds: z.array(z.string()).min(1),
        fulfillmentMethodCode: z.string().min(1),
        greeting: z.string().max(500).nullable().optional(),
        purimDay: z.string().nullable().optional(),
      }),
    )
    .min(1),
```

The copy in `src/app/api/checkout/offline/route.ts:20-29` is identical except the trailing `.min(1)` becomes `.optional()`. Same anti-AI-tic the rules call out: copy-paste with a minor variation. Export `recipientItemSchema` from `lib/checkout/validation.ts` (or a new `lib/checkout/schema.ts`) and compose with `.min(1)` / `.optional()` at the call site. `greetingDefault: z.string().max(500).optional()` is also shared between the two — fold it into the same module.

### F5. Dead `if (error instanceof AuthError)` branch (×2)
Both checkout routes end their POST handler with two branches that do the exact same thing:

```107:109:src/app/api/checkout/route.ts
  } catch (error) {
    if (error instanceof AuthError) return apiErrorResponse(error);
    return apiErrorResponse(error);
  }
```

```133:135:src/app/api/checkout/offline/route.ts
  } catch (error) {
    if (error instanceof AuthError) return apiErrorResponse(error);
    return apiErrorResponse(error);
  }
```

`apiErrorResponse` (`src/lib/api-error.ts:8-10`) already special-cases `AuthError`. The `if` is dead logic — both arms return the same response. Collapse to `return apiErrorResponse(error);`. Keeping the branch implies a distinction that does not exist (anti-AI-tics: no copy-paste patterns with minor variations).

### F6. `assertOfflinePaymentStaffOnly(true)` is dead code
`src/lib/payments/offline.ts:203-207`:

```203:207:src/lib/payments/offline.ts
export function assertOfflinePaymentStaffOnly(isStaff: boolean): void {
  if (!isStaff) {
    throw new AuthError(403, "Cash and check payments are staff-only.");
  }
}
```

The JSDoc says "Reject offline methods on public/customer paths (R-127)." The function is called exactly twice — `src/app/api/checkout/offline/route.ts:42` and `:141` — both with the literal `true`, immediately after `requirePermission("admin.access")` already guaranteed staff. The `!isStaff` branch can never fire. R-127 is actually enforced by routing (the public `checkout/route.ts` only offers Stripe; the offline route is gated by `requirePermission`), so this guard is "just in case" code with no live reason. Either delete it, or wire it into a public path where `isStaff` is the real runtime value. As written it is dead.

### F7. Inconsistent error handling for `assertPerPackageZipsAllowed`
The same assertion is handled two different ways inside `session.ts`:

- `prepareCheckout` catches it locally and converts to a `zip_blocked` conflict:

```298:312:src/lib/checkout/session.ts
    try {
      assertPerPackageZipsAllowed(breakdown);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return ok({
        summary: await buildCheckoutSummary(input.orderId),
        conflicts: [
          {
            kind: "zip_blocked",
            zips: breakdown.blockedZips,
            message,
          },
        ],
      });
    }
```

- `createHostedCheckoutSession` calls it unguarded inside the outer try, then catches it by string-matching the message:

```471:484:src/lib/checkout/session.ts
  } catch (error) {
    if (error instanceof Error && error.message.includes("Per-package delivery")) {
      return ok({
        sessionId: "",
        url: "",
        amountCents: 0,
        conflicts: [
          {
            kind: "zip_blocked",
            zips: [],
            message: error.message,
          },
        ],
      });
    }
    return err(maskError(error), "Could not start Stripe checkout.");
  }
```

Two problems. (1) Two error-handling patterns for one assertion — the rules require one error-handling approach per project. (2) `error.message.includes("Per-package delivery")` is string-matching against a thrown `Error` message; rename the message string and the zip-block path silently degrades to a 500. Replace `assertPerPackageZipsAllowed` with a function that returns a `Result` (or a typed `ZipBlockedError`), and handle it the same way in both call sites.

### F8. Redundant `typeof pi === "string" ? pi : String(pi)` in `webhook.ts`
`src/lib/payments/webhook.ts:118-125` and `:152-158` both do:

```118:125:src/lib/payments/webhook.ts
    const pi =
      session.payment_intent ??
      mintMockPaymentIntentId();
    await safetyRefund({
      orderId,
      amountCents: charged,
      paymentIntentId: typeof pi === "string" ? pi : String(pi),
      reason: `Charged ${charged}¢ but expected ${expected}¢`,
    });
```

`session.payment_intent` is typed `string | null` (`CheckoutCompletedObject` at line 25) and `mintMockPaymentIntentId()` returns `string`, so `pi` is always `string`. The `typeof pi === "string" ? pi : String(pi)` is a redundant type narrowing the compiler already guarantees (anti-AI-tics). Pass `pi` directly. The same pattern repeats at lines 152-158 and at the `paymentIntentId` resolution on lines 163-166 (`?? mintMockPaymentIntentId()` is already string-typed, no cast needed).

### F9. Hand-rolled `Summary` client type drifts from server
`src/components/checkout/checkout-client.tsx:7-40` redeclares the checkout summary shape by hand:

```7:40:src/components/checkout/checkout-client.tsx
type Summary = {
  draftRef: string;
  greetingDefault: string | null;
  donationCents: number;
  subtotalCents: number;
  totalCents: number;
  fees: {
    bulkDestinationCount: number;
    bulkFeeCents: number;
    perPackageRecipientCount: number;
    perPackageFeeCents: number;
    shipFeeCents: number;
    totalFeeCents: number;
    blockedZips: string[];
  };
  conflicts: Array<{ kind: string; message: string }>;
  purimDays: string[];
  methods: Array<{ code: string; label: string; description: string | null }>;
  lines: Array<{ ... }>;
};
```

`buildCheckoutSummary` (`session.ts:96-185`) returns an inline object literal — there is no shared type. The client redeclares it, and in doing so collapses `CheckoutConflict` (a 7-variant discriminated union in `validation.ts:30-38`) to `Array<{ kind: string; message: string }>`, losing every discriminant and payload field (`stale_price.expected`, `stock.needed`, `zip_blocked.zips`, …). Same class as P4 F3. Export a `CheckoutSummary` type from `lib/checkout/session.ts` (and reuse `CheckoutConflict` directly) so the client can't drift.

### F10. `finalize.ts` double-line spacing — inconsistent pattern
`src/lib/orders/finalize.ts` is 538 lines with 241 blank lines — every other line is blank:

```33:71:src/lib/orders/finalize.ts
async function claimNextOrderNumber(

  tx: Tx,

  seasonId: string,

): Promise<number> {

  const rows = await tx.$queryRaw<Array<{ nextOrderNumber: number }>>`

    SELECT "nextOrderNumber"

    FROM "Season"

    WHERE id = ${seasonId}

    FOR UPDATE

  `;
```

No other P5 file does this — `session.ts`, `validation.ts`, `delivery.ts`, `offline.ts`, `webhook.ts` all use normal single-spacing. The blank-line-per-token style is an inconsistent pattern (rules: one pattern per concern) and doubles the file's apparent size. Reformat to standard spacing. With the blank lines stripped the file is ~270 lines, well under the god-file threshold, so this is formatting only.

### F11. Three near-identical mock-id minters in `stripe/client.ts`
`src/lib/stripe/client.ts:38-48`:

```38:48:src/lib/stripe/client.ts
export function mintMockSessionId(): string {
  return `cs_mock_${randomBytes(12).toString("hex")}`;
}

export function mintMockPaymentIntentId(): string {
  return `pi_mock_${randomBytes(12).toString("hex")}`;
}

export function mintMockEventId(): string {
  return `evt_mock_${randomBytes(12).toString("hex")}`;
}
```

Three functions, identical bodies modulo the prefix. Rule-of-2 met. Extract `function mintMockId(prefix: string): string { return \`${prefix}_mock_${randomBytes(12).toString("hex")}\`; }` and keep the three named wrappers as one-liners if their call-site names matter for grep.

### F12. `checkoutSnapshot` + `order.update` block duplicated 2× in `session.ts`
The snapshot construction and the `order.update` that persists `expectedTotalCents` / `fulfillmentFeeCents` / `checkoutSnapshot` / `version: { increment: 1 }` appear twice with near-identical bodies:

```323:339:src/lib/checkout/session.ts
    const snapshot: Prisma.InputJsonValue = {
      fees: breakdown,
      subtotalCents: validation.subtotalCents,
      donationCents: refreshed.donationCents,
      expectedTotalCents: expectedTotal,
      capturedAt: new Date().toISOString(),
    };

    await db.order.update({
      where: { id: order.id },
      data: {
        expectedTotalCents: expectedTotal,
        fulfillmentFeeCents: breakdown.totalFeeCents,
        checkoutSnapshot: snapshot,
        version: { increment: 1 },
      },
    });
```

The second copy is at `src/lib/checkout/session.ts:399-412` (omits `capturedAt`). Rule-of-2 met. Extract `persistCheckoutSnapshot(orderId, { breakdown, subtotalCents, donationCents, expectedTotalCents })`. The two copies will drift the moment one snapshot gains a field the other doesn't.

---

## Summary

12 findings. Severity counts:

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 6 (F1, F2, F3, F4, F7, F9) |
| Low | 6 (F5, F6, F8, F10, F11, F12) |
| Info | 0 |

Highest-impact: **F1** (`"US"` magic now at 10 sites across P4+P5 — P4 F4 fix was never applied), **F2/F3/F12** (three duplications inside the same file — `feeLines` mapping ×3, total formula ×3, snapshot-persist block ×2), **F7** (two error-handling patterns for one assertion plus fragile string-matching), **F9** (client `Summary` type drifts from server and erases the `CheckoutConflict` discriminant). F5/F6/F8 are dead-code / dead-logic cleanups. F4 is a schema-sharing extraction. F10 is a formatting anomaly. F11 is a small minter consolidation.

No god files in the P5 surface: `session.ts` (488 lines) is the largest and is single-concern (checkout orchestration); `checkout-client.tsx` (374), `webhook.ts` (331), `finalize.ts` (538 raw / ~270 stripped), `validation.ts` (179), `delivery.ts` (152) are all under the 500-line threshold once `finalize.ts` is reformatted. Error handling is mostly consistent across P5 routes (everything routes through `apiErrorResponse` and the `Result`/`maskError` pattern from P2 is reused) — the one exception is F7 inside `session.ts`.
