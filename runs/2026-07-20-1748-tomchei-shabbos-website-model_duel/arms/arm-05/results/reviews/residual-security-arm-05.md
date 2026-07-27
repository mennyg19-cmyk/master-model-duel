# Residual security review — arm-05 (post self-fix)

**Scope:** `arms/arm-05/workspace/` tree as it stands after self-fix. Blind — no model names, no SELF-REVIEW chat.
**Method:** trust-boundary, auth, IDOR, injection, secrets pass over the tree.
**Out of scope:** fixes. Findings only.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 3 |
| Low | 5 |
| Info | 2 |
| **Total** | **11** |

---

## High

### H-1 — `/api/admin/payments/[paymentId]` DELETE voids any cash/check payment by ID (IDOR)

**Location:** `app/api/admin/payments/[paymentId]/route.ts` (full file) + `lib/checkout.ts` `voidOfflinePayment` (lines 364–373).

**Claim:** Self-fix notes say nothing about payment-void scoping. The sibling refund route (`app/api/admin/orders/[orderId]/route.ts` POST, lines 50–54) explicitly checks `prisma.payment.findFirst({ where: { id: paymentId, orderId } })` and rejects mismatches with 404.

**Evidence:** The DELETE handler authorizes `orders.write`, then calls `voidOfflinePayment(paymentId, authorization.staffMember.id)` with only the path param. `voidOfflinePayment` looks the payment up by `id` alone:

```364:373:lib/checkout.ts
export async function voidOfflinePayment(paymentId: string, actorId: string) {
  return prisma.$transaction(async (transaction) => {
    const payment = await transaction.payment.findUnique({ where: { id: paymentId } });
    if (!payment || !["CASH", "CHECK"].includes(payment.method) || payment.status !== "POSTED") throw new Error("Only a posted cash or check payment can be voided.");
    await transaction.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt: new Date() } });
    const activePayments = await transaction.payment.count({ where: { orderId: payment.orderId, status: "POSTED" } });
    await transaction.order.update({ where: { id: payment.orderId }, data: { paymentStatus: activePayments ? "POSTED" : "VOIDED" } });
    await transaction.auditEvent.create({ data: { actorId, action: "payment.offline_voided", subjectId: paymentId, details: { orderId: payment.orderId } } });
  });
}
```

No `orderId` is in scope on this route, so any staff member with `orders.write` can void any posted CASH/CHECK payment in the entire system by supplying its cuid. The order's `paymentStatus` is then recomputed and may flip to `VOIDED` on an order the staff member never had authority over. Cuids resist enumeration, but a staff insider with order-list access can harvest payment IDs from `listOrders` (`lib/admin-operations.ts` line 137 includes `payments: true`) and void payments across orders that are not theirs.

---

## Medium

### M-1 — `sendCampaign` calls `createMany` with a single object; campaigns cannot be sent

**Location:** `lib/email.ts` lines 250–261.

**Claim:** Self-fix notes do not mention email campaigns.

**Evidence:**

```250:261:lib/email.ts
      const message = await transaction.emailOutbox.createMany({
        data: {
          eventKey: "CAMPAIGN",
          recipient: subscriber.email,
          subject: campaign.subject,
          html: campaign.body,
          dedupeKey: `campaign:${campaignId}:${subscriber.id}`,
          payload: { campaignId, subscriberId: subscriber.id },
        },
        skipDuplicates: true,
      });
```

`createMany` expects an array for `data`; a single object throws a Prisma validation error. The campaign is marked `SENT` (line 233–236) before the loop, so on failure the transaction rolls back and the campaign reverts to `DRAFT` — but the manager-facing UX reports a 400 with a raw Prisma message. Not a direct security exploit, but a residual defect in a trust boundary (staff-only bulk sender) that silently disables the campaign feature and leaks provider error text.

### M-2 — Stripe `success_url` / `cancel_url` derived from request Host header

**Location:** `lib/checkout.ts` `createProviderCheckout` lines 162–163.

**Evidence:**

```162:163:lib/checkout.ts
  const successUrl = new URL("/checkout/success?session_id={CHECKOUT_SESSION_ID}", requestUrl).toString();
  const cancelUrl = new URL("/checkout", requestUrl).toString();
```

`requestUrl` is the inbound request URL, whose host comes from the `Host` header. On Vercel the platform validates Host, but on any non-Vercel deploy (the README documents a self-hosted `npm run start` on port 3105) an attacker who can influence the Host header can steer Stripe's post-payment redirect to an attacker origin. Same vector feeds the PAYMENT_LINK email body (M-3).

### M-3 — `replaceTemplateVariables` interpolates `paymentLink` into HTML without escaping

**Location:** `lib/email.ts` lines 28–30, 91–99.

**Evidence:**

```28:30:lib/email.ts
function replaceTemplateVariables(source: string, values: Record<string, string>) {
  return source.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}
```

`paymentLink` is sourced from `provider.url`, which for the local harness is `new URL("/checkout/local", requestUrl)` (lib/checkout.ts line 160) — Host-header-derived. Combined with M-2, a Host-header injection becomes a phishing link in the PAYMENT_LINK email. Templates are staff-authored (`settings.manage`), so template HTML itself is trusted; the unescaped variable is the gap.

---

## Low

### L-1 — In-memory rate limiting keyed on `x-forwarded-for`; resets every cold start

**Location:** `app/api/checkout/[draftId]/route.ts` lines 7–19; `app/api/newsletter/route.ts` lines 29–50.

**Evidence:** Both store attempts in a module-level `Map` keyed by `x-forwarded-for` (or `"unknown"`). On Vercel serverless each invocation may be a fresh instance, so the map is empty most of the time. `x-forwarded-for` is also client-controllable on any misconfigured proxy. The checkout limiter (12/min) and subscribe limiter (5/min) are effectively advisory only. Enables checkout-spam and newsletter-subscription flooding.

### L-2 — Newsletter preference/confirmation tokens travel in URL query

**Location:** `app/api/newsletter/route.ts` line 70 (GET `?token=`); `app/api/newsletter/confirm/route.ts` line 9.

**Evidence:** Preference tokens (7-day TTL) are accepted from `searchParams.get("token")`. Confirmation tokens are single-use (hash cleared on confirm), but preference tokens are reusable and leak via server logs, browser history, and `Referer` on any image/link loaded from the preferences page. Standard for unsubscribe links but worth noting given the long TTL.

### L-3 — `test-console` TRUNCATE via `$queryRawUnsafe` with env-only gating

**Location:** `app/api/admin/test-console/route.ts` lines 13–24.

**Evidence:** `wipeTestData` builds `TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE` via `$queryRawUnsafe`. Table names come from `pg_tables` (schema, not user input) and are escaped with `replaceAll("\"", "\"\"")`. The gate is `TEST_MODE=true` + `settings.manage` + `NODE_ENV in [development, test]`. Irreversible bulk delete behind an env flag rather than a per-action confirmation; defense-in-depth concern only.

### L-4 — Driver PIN-failure audit events have no `actorId`

**Location:** `lib/delivery.ts` lines 168–174.

**Evidence:**

```168:174:lib/delivery.ts
    await prisma.auditEvent.create({
      data: {
        action: "delivery.driver_pin_failed",
        subjectId: link.routeId,
        details: { driverRouteLinkId: link.id, failedAttempts, throttledUntil: throttledUntil?.toISOString() ?? null },
      },
    });
```

`actorId` is omitted. PIN brute-force attempts against a magic link are throttled (5 attempts / 15 min) but never attributed. Audit trail gap; cannot later correlate who hammered a route link.

### L-5 — `bulk` action on `/api/admin/operations` increments order versions with no business effect

**Location:** `app/api/admin/operations/route.ts` lines 54–65.

**Evidence:** Staff with `orders.write` can pass arbitrary finalized order cuids + versions and bump `version` by 1 with no other change. Audited as `orders.bulk_version_probed`. A staff member could intentionally desync concurrent optimistic-lock updates on orders they do not own. The route has no scoping by customer or assignment.

---

## Info

### I-1 — `approveLegacyAddress` does not require `reviewStatus === "PENDING"`

**Location:** `lib/reporting.ts` lines 305–316.

**Evidence:** `transaction.address.update({ where: { id: addressId }, data: { reviewStatus: "APPROVED", ... } })` updates any address by cuid regardless of current status. Re-approving an already-approved address just rewrites `reviewedAt`. No security impact beyond redundant audit entries; the route is `imports.manage` gated.

### I-2 — `parseCsv` in `lib/admin-operations.ts` does not handle quoted commas

**Location:** `lib/admin-operations.ts` lines 33–58.

**Evidence:** `line.split(",")` with no quote handling. Customer/product names containing commas mis-parse into wrong columns. Data-quality issue only; Prisma parameterizes all writes so no injection path. The reporting import (`lib/reporting.ts` `parseCsvRecords`) has a proper quoted-CSV parser.

---

## Notes on what self-fix claimed and what was verified

- SR-001 (multi-page PDF): `lib/print-batches.ts` `createPdf` paginates at 55 lines/page — verified.
- SR-002 (Mapbox required in production): `lib/delivery.ts` `geocodeAddress` + `shouldUseFixtureGeocodes` — verified.
- SR-003 (package board paging): `lib/package-operations.ts` `packageDashboard` page size 100 — verified.
- SR-004 (item-sales finalized only): `lib/reporting.ts` `exportCsv` `where: { order: { status: "FINALIZED" } }` — verified.
- SR-005 (shipping-margin excludes voided): `lib/reporting.ts` `shippingMarginReport` `labelVoidedAt: null` — verified.
- SR-006 (legacy import PackageLine): `lib/reporting.ts` `commitLegacyImport` creates `package.lines` — verified.
- SR-007 (anonymous POS distinct customers): `lib/admin-operations.ts` `createWalkInPosOrder` — verified.
- SR-008 (lint set-state-in-effect): not in scope for security residual.

None of the eight claimed fixes address the residual issues above.
