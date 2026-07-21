# Reviewer specialist — Quality (Test 5 residual)

**Arm:** `arm-01`
**Tree / phase:** post self-fix full tree (`arms/arm-01/workspace/`)
**Output:** `results/reviews/residual-quality-arm-01.md`
**Mode:** blind — graded post-fix tree only; self-review / self-fix notes were not read.

Focus: correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED. Findings only — no fixes.

---

## Summary

The post-fix tree is substantially complete: no `TODO`/`FIXME`/`stub`/`NotImplemented` markers anywhere in `src/`, real serializable-isolation concurrency guards on every contested write (order finalize, inventory reserve, package stage, staff version), idempotent Stripe-webhook dedup, timing-safe cron + test-auth comparison, checkout fingerprint + idempotency key, and phase smoke scripts that assert real behavior (not STATUS prose). The P12 EXPECTED items (multi-season reports, exports + reconciliation, legacy import dry-run/atomic/resume, scale rehearsal, E2E dress rehearsal) all have backing domain code and a `p12-smoke.ts` that exercises them.

Residual issues are correctness/robustness gaps, not missing features. The most material one is a unique-constraint collision risk in guest draft creation; the rest are transaction-boundary and throttle-key concerns.

## Severity summary

| # | Severity | Area | Finding |
|---|---|---|---|
| 1 | Medium | checkout / drafts | Random `draftReference` on a `@unique` column → birthday-paradox 500s |
| 2 | Medium | refunds | Stripe side-effect inside serializable DB transaction → reconciliation drift on rollback |
| 3 | Medium | public throttling | Rate-limit key from spoofable `x-real-ip` with shared `unknown` fallback |
| 4 | Low | repeat orders | TOCTOU on source-order version in bulk repeat (no row lock) |
| 5 | Low | delivery / pickup | `stampPickup` missing `isPickup` guard; redundant expiry condition |
| 6 | Low | delivery / reroute | `findNearbyShippingPackages` same-street heuristic is fragile |
| 7 | Low | cron / outbox | Minute-based outbox run key silently no-ops within the same minute |
| 8 | Low | shipping | External Shippo call inside serializable transaction holds row locks |
| 9 | Low | test console | `seedScaleFixture` packageLine index parsing is convention-fragile |

---

## Findings

### 1. Random draft reference collides on a unique column (Medium)

```86:86:src/app/api/order/drafts/route.ts
      draftReference: formatDraftReference(randomInt(1, 100_000_000)),
```

`Order.draftReference` is `@unique`, and `formatDraftReference` is built for sequential counters (`D-00000042`). Drawing a random 8-digit number per guest draft invites a birthday-paradox collision: at ~12k guest drafts the collision probability crosses 50%, and each collision turns `order.create` into a `P2002` 500. The sequential counter used at finalize (`Season.nextOrderNumber`) is the right pattern; draft references should follow it or use a cuid (the `id` column already does). Under the P12 scale rehearsal (1k orders) this will not fire, but it is a latent production-correctness bug on the hottest public write path.

### 2. Stripe refund issued inside a serializable transaction (Medium)

```51:65:src/app/api/admin/orders/[orderId]/refunds/route.ts
      if (isStripePayment && stripe && !isLocalPayment) {
        await stripe.refunds.create(
          {
            payment_intent: stripePaymentIntentId!,
            amount: parsed.data.amountCents,
            reason: "requested_by_customer",
            metadata: { orderId, staffReason: parsed.data.reason },
          },
          {
            idempotencyKey: `admin-refund:${payment.id}:${
              parsed.data.idempotencyKey ??
              `${payment.refundedCents}:${parsed.data.amountCents}`
            }`,
          },
        );
      }
```

`stripe.refunds.create` runs inside `db.$transaction`. The `payment.updateMany` (incrementing `refundedCents`) executes first, then the Stripe call, then audit/recalc/email enqueue. If any statement after the Stripe call throws, the transaction rolls back the DB refund but Stripe has already refunded — leaving the provider and ledger out of sync with no compensating record. The idempotency key also embeds `payment.refundedCents` (pre-increment value read outside the txn), so it is stable per (prior-state, amount) pair but does not protect against the rollback gap. External side-effects belong after commit, or behind a compensating void on failure.

### 3. Public throttle keyed on spoofable `x-real-ip` (Medium)

```27:27:src/lib/public-request.ts
  const source = request.headers.get("x-real-ip")?.trim() || "unknown";
```

The throttle key is `hash(action:source)` where `source` is the raw `x-real-ip` header. Two problems: (a) unless a trusted proxy overwrites/strips it, a client can set `x-real-ip` per request to rotate buckets and bypass the guest-draft / checkout / newsletter limits entirely; (b) every headerless request collapses into the single `"unknown"` bucket, so one misconfigured client (or a load test without the header) exhausts the limit for all anonymous users. The origin/host CSRF check in `guardPublicWrite` is fine; the IP source is not. Use the platform-trusted forward chain (last untrusted hop of `x-forwarded-for`, or Vercel's request geolocation) rather than a client-supplied header.

### 4. Bulk repeat TOCTOU on source-order version (Low)

```428:434:src/domain/repeat-orders.ts
    try {
      const review = await getRepeatReview(prisma, requested.orderId);
      const draft = await createRepeatDraft(prisma, {
        sourceOrderId: requested.orderId,
        sourceVersion: requested.version,
        actorStaffId,
        decisions: requested.decisions,
      }, review);
```

`getRepeatReview` runs outside any transaction, and `createRepeatDraft` only re-checks `review.sourceOrder.version === input.sourceVersion` against that stale snapshot — there is no `SELECT ... FOR UPDATE` on the source order. A concurrent edit to the source order between review and create slips through the version check only if the version happens to match, but the address/product lookups inside `createRepeatDraft` are also done against the precomputed review. Low impact (staff-only, single-actor), but it is a real race that the per-line `finalizeOrder` path correctly closes via serializable isolation.

### 5. `stampPickup` missing pickup-method guard (Low)

```582:590:src/domain/delivery.ts
    if (
      packageRecord.pickupExpiredAt ||
      (packageRecord.pickupExpiresAt && packageRecord.pickupExpiresAt <= new Date())
    ) {
      throw new Error("An expired pickup cannot be stamped.");
    }
```

`stampPickup` does not verify `fulfillmentMethod.isPickup`. A shipping package that ever had `pickupReadyAt` set (e.g., via a prior method switch that left the field populated) would pass the guard and jump to `PICKED_UP`. The expiry condition is also redundant: `expireUnclaimedPickups` already materializes `pickupExpiredAt` for past-due windows, so the second clause re-derives a state the cron owns. Defense-in-depth would add `isPickup` and drop the re-derivation.

### 6. Reroute same-street heuristic is fragile (Low)

```459:461:src/domain/delivery.ts
        address.line1.split(/\s+/).slice(1).join(" ").toLowerCase() ===
        addressText(stop.package.addressSnapshot).split(",")[0]!.split(/\s+/).slice(1).join(" ").toLowerCase();
```

`findNearbyShippingPackages` matches "same street" by stripping the first whitespace token of `line1` on both sides. For numbered addresses ("123 Main St") this drops the house number — fine. For addresses whose first token is not a number ("Apt 5 Main St", "PO Box 12") it drops meaningful data and can yield false-positive reroute suggestions or miss true neighbors. The 0.5-mile haversine fallback covers most cases, but the street heuristic is the kind of string surgery that breaks silently on edge inputs.

### 7. Outbox sweep no-ops within the same minute (Low)

```9:12:src/app/api/cron/message-outbox/route.ts
  const minute = new Date().toISOString().slice(0, 16);
  const runKey =
    request.headers.get("x-cron-run-key") ?? `message-outbox:${minute}`;
```

When no `x-cron-run-key` header is supplied, the run key is minute-granular. `runOutboxSweep` returns the prior `CronRun` unchanged if the key exists, so a second invocation within 60 s (manual retry, Vercel cron double-fire, or a warm lambda) silently no-ops while pending messages wait for the next minute. Idempotency is correct, but the granularity is coarse for a `*/5` schedule. The p12-smoke always sends a unique `x-cron-run-key`, so this only affects production cron behavior, not the smoke.

### 8. Shippo label purchase holds row locks across a network call (Low)

```300:302:src/domain/shipping.ts
      let purchased;
      try {
        purchased = await provider.buyLabel(margin.purchasedRate.id);
```

`buyPackageLabel` wraps `provider.buyLabel` in a serializable transaction with a 20 s timeout and a `SELECT ... FOR UPDATE` on the package. A slow Shippo response extends lock hold time on the package row. Single-package operations make this tolerable, but under concurrent label purchases for related packages on the same order it raises contention and deadlock-rollback odds. `quotePackage` correctly calls `getRates` outside its transaction; `buyLabel` does not follow the same pattern.

### 9. Scale-seed packageLine index parsing is convention-fragile (Low)

```120:120:src/domain/test-console.ts
    const orderIndex = Number(orderPackage.orderId.split("-").at(-1));
```

`seedScaleFixture` recovers the order index by splitting the package's `orderId` on `-` and taking the last segment. This only works because `orderId` is exactly `p12-scale-order-${index}`. Any change to the scale id convention (e.g., a UUID, or an extra suffix) silently maps every `packageLine.orderLineId` to `NaN`/wrong line and breaks the fixture join. Test-only code, but the parsing should derive the index from the package's own `id` or an explicit side table rather than reverse-engineering `orderId`.

---

## EXPECTED coverage (P12, residual check)

| EXPECTED item | Status | Evidence |
|---|---|---|
| Multi-season reports + shipping-margin view | Met | `src/domain/launch-reporting.ts`; `p12-smoke.ts` S1 asserts totals + margin vs seeded ledger |
| CSV export center + audit; Stripe reconciliation (button + cron + matcher) | Met | `src/app/api/admin/exports/route.ts`, `src/domain/stripe-reconciliation.ts`, `src/app/api/cron/stripe-reconciliation/route.ts`; S2 asserts 403/200, orphan finding, replay idempotency |
| Legacy import dry-run / atomic / resume / dedupe | Met | `src/domain/legacy-import.ts`; S3 asserts blocking dry-run, atomic commit, resume same id, dedupe |
| Imported repeat through P10 review | Met | `src/domain/repeat-orders.ts`; S4 asserts mapped product + recipient + DRAFT |
| Scale rehearsal 1k/5k + test console + crons auth | Met | `src/domain/test-console.ts`, `src/lib/cron-auth.ts`; S5 asserts seed counts, nightly print ≥1k, 10-way conflict-safe, six crons 401/200, wipe+reseed |

No smoke steps are missing or stubbed; all five S-checks have executable assertions.

## Regressions

No regressions detected relative to the EXPECTED surface. The two `self_review_fixes` migrations (`ImpersonationSession.expiresAt` + `StripePaymentIntent.checkoutFingerprint`) are reflected in `schema.prisma` and consumed by `auth.ts` (impersonation expiry) and `checkout.ts` (fingerprint commit), so the fix pass did not leave orphaned schema drift.

## Notes

- `prisma/migrations/migration_lock.toml` present; migration history is linear and matches `schema.prisma`.
- No dead-code exports flagged in the scanned domain modules; `re-export` pattern in `checkout.ts` is intentional (facade over `fulfillment-fees`).
- `tests/` covers domain-core (grouping, state machine, concurrent finalize, inventory race, discard, package stage version) and shipping margin/planner; no test covers the draft-reference uniqueness path or the refund rollback gap — both are finding 1 and 2 territories.
