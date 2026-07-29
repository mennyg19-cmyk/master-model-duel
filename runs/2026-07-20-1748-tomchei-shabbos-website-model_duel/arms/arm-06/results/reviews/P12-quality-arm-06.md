# P12 Quality Review — arm-06 (blind)

**Phase:** P12 — Reporting, exports, Stripe reconciliation, legacy import, test ops, scale dress rehearsal, help.
**Scope:** correctness of report totals/margin, export quoting/encoding, reconciliation idempotency, import dry-run/atomic commit/resume/dedupe, scale honesty, smoke gaps vs EXPECTED S1–S5.
**Sources read:** `kit/prompts/reviewer/review-quality.md`, `shared/phases/PHASE-P12-EXPECTED.md`, `shared/MERGED-BUILD-PLAN.md` § P12, `arms/arm-06/workspace/.scratch/PHASE-P12-STATUS.md`, `arms/arm-06/workspace/.scratch/PHASE-P12-SMOKE.md`, `arms/arm-06/workspace/.scratch/smoke-p12.log`, `arms/arm-06/workspace/.scratch/scale-p12.log`, and the implementation surfaces under `lib/reports`, `lib/exports`, `lib/csv.ts`, `lib/reconcile`, `lib/imports/**`, `lib/testops/**`, `app/(admin)/admin/{reports,export,reconciliation,imports,test-ops,help}/**`, `app/api/admin/{export,imports,reconciliation,test-ops}/**`, `app/api/cron/reconcile-stripe/**`, `vercel.json`, `scripts/seed-scale.mts`.
**Findings only — no fixes.**

## Summary counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 1 |
| Minor | 6 |
| **Total** | **8** |

---

## Blocker

### B1 — G-029 typed-phrase confirmation gate is missing; status doc claims it ships

**Where:** `app/api/admin/imports/[batchId]/commit/route.ts`, `app/(admin)/admin/imports/[batchId]/import-preview.tsx`, `lib/imports/engine.ts` (`commitImport`).

**Evidence:**
- `PHASE-P12-STATUS.md` row G-029 states: *"Commit throws a blocking validation error (HTTP 422) unless the operator types the exact phrase shown by the dry-run summary."*
- The commit route accepts a bare `POST` with no body, no `confirmPhrase`/`typedPhrase` field, and no comparison against any dry-run summary token:

```12:25:arms/arm-06/workspace/app/api/admin/imports/[batchId]/commit/route.ts
export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });

  const gate = await requireApiPermission(IMPORT_PERMISSION[batch.kind]);
  if (!gate.ok) return gate.response;

  try {
    const committed = await commitImport({
      batchId,
      handler: IMPORT_HANDLERS[batch.kind],
      ctx: gate.ctx,
    });
```

- The preview UI fires commit on a single button click — no text input, no typed phrase:

```71:73:arms/arm-06/workspace/app/(admin)/admin/imports/[batchId]/import-preview.tsx
            <Button size="sm" onClick={() => decide("commit")} disabled={busy !== null || counts.valid === 0} data-import-commit>
              {busy === "commit" ? "Committing…" : `Commit ${counts.valid} row${counts.valid === 1 ? "" : "s"}`}
            </Button>
```

- `commitImport` in `lib/imports/engine.ts` only refuses a `batch.dryRun === true` (the 422 the smoke catches in S3a). There is no typed-phrase parameter on the function signature, the route body, the Zod schema, or the UI.
- A repo-wide search for `confirmPhrase|typedPhrase|exact phrase|confirmText|typeToConfirm|confirm-phrase` returns zero matches.

**Impact:** G-029 is a **primary P12 ID** (plan § P12: *"import pipeline … staged atomic commits + audit (R-186, G-029)"*). The intended safety gate — prove the operator saw the dry-run ledger before any write — is absent. The only protection is the `dryRun` boolean refusal, which is a different, weaker guarantee (it stops re-committing a dry-run batch; it does not stop an unverified commit of a real batch). The status doc misrepresents a missing safety control as shipped, which is the worst class of doc/code drift because downstream gates will read "G-029 ✓" and stop looking.

**Smoke gap:** S3a asserts the dry-run-refusal 422 but no smoke step exercises a typed-phrase gate, so the gap is invisible to the run.

---

## Major

### M1 — Method drill-down "Shipping charged" includes VOIDED labels; margin rollup and year-metrics export exclude them

**Where:** `lib/reports/seasons.ts` (`getMethodDrilldown`), `lib/reports/margin.ts` (`getMarginRollup`), `lib/exports/datasets.ts` (`yearMetrics`).

**Evidence:**

```103:107:arms/arm-06/workspace/lib/reports/seasons.ts
    prisma.shipment.groupBy({
      by: ["status"],
      where: { package: { order: { seasonId } }, status: { in: ["PURCHASED", "VOIDED"] } },
      _sum: { chargedCents: true },
    }),
```
```110:110:arms/arm-06/workspace/lib/reports/seasons.ts
  const shippedCharged = shipmentGroups.reduce((sum, g) => sum + (g._sum.chargedCents ?? 0), 0);
```

versus the rollup (PURCHASED only):

```85:88:arms/arm-06/workspace/lib/reports/margin.ts
  const where: Prisma.ShipmentWhereInput = {
    status: "PURCHASED",
    ...(seasonId ? { package: { order: { seasonId } } } : {}),
  };
```

and the year-metrics export (PURCHASED only):

```180:182:arms/arm-06/workspace/lib/exports/datasets.ts
        prisma.shipment.aggregate({
          where: { package: { order: { seasonId: season.id } }, status: "PURCHASED" },
          _sum: { chargedCents: true, costCents: true, marginCents: true },
        }),
```

- The in-code comment on the drill-down claims it books *"the margin ledger's charged side"* — but the margin ledger's charged side is PURCHASED-only. The two surfaces disagree as soon as a label is purchased then voided.
- The dress rehearsal **creates exactly this situation**: S5h reroutes a SHIPPED package — *"label voided, package joined the route as a stop."* S5m then checks the margin ledger (*"the voided reroute label stays out of the kept spread"*) but never compares the method drill-down's SHIPPED "Shipping charged" against the margin rollup's "Charged" for the same season. The smoke does not catch the discrepancy.
- The domain test (`scripts/test-p12-domain.mts` line ~332) only asserts `Number.isFinite(row.shippedChargedCents)` — it does not assert the VOIDED-exclusion behavior, so the regression is uncaught by tests too.

**Impact:** A staff member comparing the Performance → "By method" SHIPPED row to the Shipping-margin rollup (or to the year-metrics CSV) for a season that had any reroute/void will see different "charged" totals with no explanation. The margin ledger is the money truth (PURCHASED-only is correct — a void returns the spread); the method drill-down is wrong. At crunch scale with frequent reroutes, the overstatement compounds.

---

## Minor

### m1 — Help center tour count and `?tour=` deep-linking misreported

**Where:** `app/(admin)/admin/help/page.tsx`, `PHASE-P12-STATUS.md` row 6.

The status doc claims *"`/admin/help` + 7 `?tour=` targets."* The help page renders **6** static tour cards (`TOURS` array, lines 9–75) and there is no `?tour=` query handling anywhere in the codebase (repo-wide search for `\?tour=` returns no matches). The help content is present and useful; the deep-link targeting and the count are wrong.

### m2 — Export center route names misreported

**Where:** `app/(admin)/admin/export/page.tsx`, `PHASE-P12-STATUS.md` row 2.

Status doc claims *"`/admin/exports` + `/admin/exports/history`"* as separate routes. The actual surface is a single page at `/admin/export` (singular) with the audit history table rendered on the same page. No `/admin/exports/history` route exists. Functionality is complete (streamed downloads + audit row + history table all present); only the doc's URL inventory is wrong.

### m3 — "Intent-window matcher" wording overstates the design

**Where:** `lib/reconcile/matcher.ts` (`runReconciliation`), `lib/payments/stripe.ts` (`listPaymentIntents`), `PHASE-P12-STATUS.md` row 3.

Status doc calls the reconciler an *"intent-window matcher."* `listPaymentIntents` pages through `/v1/payment_intents` with no `created`/`starting_after` time bound — it pulls the full intent list (paginated by `starting_after` cursor only). The matcher is correct and idempotent (it never writes payments; each run persists its own run + findings rows, so reruns reproduce the same finding set without duplicate adjustments — confirmed by S2c). The "window" label is inaccurate but not a behavior defect.

### m4 — STALE_MIRROR false positives in fixture mode with an empty dev double

**Where:** `lib/reconcile/matcher.ts` lines 113–125.

```113:125:arms/arm-06/workspace/lib/reconcile/matcher.ts
    if (stripeSide.length > 0 || mode === "live" || mode === "fixture") {
      for (const mirror of mirrors) {
        if (!stripeIds.has(mirror.intentId)) {
          add({
            kind: "STALE_MIRROR",
            intentId: mirror.intentId,
            orderId: mirror.orderId,
            detail: `Local mirror for ${mirror.intentId} ("${mirror.status}") is not in the Stripe-side list.`,
          });
        }
      }
    }
```

In `fixture` mode, if the dev double returns an empty intent list (e.g., a payment was posted via the signed webhook but the fixture has no intents), the guard `mode === "fixture"` is still true, so **every** local mirror is flagged `STALE_MIRROR`. Live mode is correct (empty Stripe side ⇒ mirrors really are stale); capture mode correctly skips the loop. Smoke S2a uses a populated fixture, so the edge case is unexercised.

### m5 — Legacy refunded orders import as `paymentStatus: PAID` with no payment rows

**Where:** `lib/imports/legacy/orders.ts` lines 252, 307–318.

```252:252:arms/arm-06/workspace/lib/imports/legacy/orders.ts
        paymentStatus: head.paymentStatus === "unpaid" ? "UNPAID" : "PAID",
```
```307:314:arms/arm-06/workspace/lib/imports/legacy/orders.ts
    if (head.paymentStatus === "paid" && totalCents > 0) {
      await postPaymentTx(tx, {
        orderId: order.id,
        method: head.paymentMethod,
        amountCents: totalCents,
        externalRef: `legacy:${orderNo}`,
      });
    }
    // Refunded legacy orders keep paymentStatus PAID with no payment rows:
    // the money was collected AND returned inside the old system (net zero),
    // and a VOIDED pair here would drop the order into this year's collection
    // queues. The entity map documents this terminal-state choice.
```

A refunded legacy order lands as `paymentStatus: "PAID"` with zero posted payments. Reports correctly count $0 revenue (they aggregate `POSTED` payments, not the cached status), but the **year-end CSV export** (`lib/exports/datasets.ts` `yearEnd`) emits `payment_status: PAID`, `paid_dollars: 0.00`, `balance_dollars: <total>` for such an order — an accountant reconciling the CSV will see a "PAID" order with a non-zero balance and no payment method. The tradeoff is documented in the entity map per the comment, but the cached status label is misleading at the export edge.

### m6 — Deliveries export package-stage lookup picks the first matching recipient name

**Where:** `lib/exports/datasets.ts` line 94.

```94:94:arms/arm-06/workspace/lib/exports/datasets.ts
        const pkg = row.order.packages.find((candidate) => candidate.recipientName === row.name);
```

If two packages in the same order share a recipient name (different addresses — legal under the grouping key, which splits on recipient+address+method), `find` returns the first match and the second draft-recipient's `package_stage` cell reports the wrong stage. Edge case; not exercised by smoke.

---

## Smoke vs EXPECTED S1–S5 — verdict

| Smoke | EXPECTED check | Verdict |
|---|---|---|
| S1a–S1c | Report totals + drill-downs match seeded ledger; margin matches seeded shipments | PASS for the seeded ledger. **Gap:** no smoke compares the method drill-down's "Shipping charged" to the margin rollup after a void (see M1). S5h creates the void; S5m checks only the margin side. |
| S2a–S2e | Authorized exports; unauthorized 403; orphan PaymentIntent flagged; rerun without duplicate adjustments | PASS. Authorization, audit row, cron bearer auth, idempotent rerun all verified. |
| S3a–S3g | Dry-run messy fixture; mapping + atomic commit; resume after interruption; dedupe rules | PASS for what it exercises. **Gap:** the typed-phrase gate (G-029) is not exercised because it does not exist (B1). "Resume after interruption" is covered by the STAGED-batch-then-commit flow (S3b), which is honest. |
| S4a–S4c | Repeat imported prior-year order through P10 review page | PASS. |
| S5a–S5p | Full E2E with zero manual DB edits; nightly batch over 5k acceptable; wipe+reseed restores clean test season | PASS for the executed path. **Gap:** "wipe + reseed restores a clean test season" is asserted by S5a (reset) but the smoke does not re-verify a *second* wipe+reseed cycle leaves no stale rows (e.g., `import_batches`, `cron_runs` from the first act). The `clear`/`wipe` TRUNCATE lists in `lib/testops/actions.ts` look correct by inspection, but no smoke step re-runs reset and asserts counts return to baseline. |

**Overall smoke honesty:** the log matches the code paths (33 PASS / 0 FAIL is credible — each PASS maps to a real assertion in `smoke-p12.ps1`/`smoke-db.mts`). The two material gaps (M1 voided-charge comparison, B1 typed-phrase gate) are gaps in *what* the smoke asserts, not gaps in *whether* the asserted steps ran.

---

## Notes for the aggregator (not findings)

- `lib/exports/csv.ts` (claimed by status doc) does not exist; the CSV writer lives at `lib/csv.ts` and is shared with import parsing. The status doc's path is wrong; the implementation is fine — RFC-4180 quoting, `""` escapes, CRLF terminator, comma/newline/quote detection all correct.
- `lib/payments/reconcile.ts` (claimed by status doc) does not exist; the matcher lives at `lib/reconcile/matcher.ts`. Same class of doc/path drift as the CSV note — code is present, path in the doc is wrong.
- Scale dress rehearsal (`scripts/seed-scale.mts` + `.scratch/scale-p12.log`) is honest: deterministic PRNG, real domain shapes, real order-number claiming, real grouping key, real nightly-batch/route-builder/concurrency probes. 1002 orders / 5004 packages (baseline + 1000/5000) reconciles with the log. The "nightly over 5k" evidence (S5p, 75ms / 0 filed) is the idempotent rerun after the probe already filed 4450 — accurately described in the status doc's "deferred gaps" section.
- All 8 crons are registered in `vercel.json` with bearer-secret auth via `cronRoute` → `isCronAuthorized` (401 on missing/wrong bearer confirmed by S2d for the new reconcile-stripe cron).
