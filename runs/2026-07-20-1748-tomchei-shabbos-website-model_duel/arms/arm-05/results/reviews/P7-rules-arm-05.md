# P7 Rules Review — arm-05 (blind)

Reviewer specialist: Rules. Phase: P7 — Package engine live: grouping UI, statuses, print batches, cards.
Scope: always-on rules adherence in P7 code (`lib/package-operations.ts`, `lib/print-batches.ts`, `app/api/admin/packages/route.ts`, `app/api/admin/print/route.ts`, `app/admin/packages/page.tsx`, `scripts/smoke-p7.ts`, `prisma/migrations/20260727235000_p7_package_engine/migration.sql`, `prisma/schema.prisma` P7 additions, `lib/checkout.ts` materialize call, `app/admin/layout.tsx`, `app/admin/page.tsx`, `.scratch/PHASE-P7-STATUS.md`, `.scratch/PHASE-P7-SMOKE.md`, `.scratch/phase-plan.md` P7 block).

Arm rules graded: `clean-code.mdc`, `ponytail.mdc`, `workflow.mdc`, `codegraph.mdc`, `vocabulary.mdc`.

Findings only — no fixes.

---

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 4 |
| Low | 2 |
| Total | 7 |

---

## HIGH-1 — Expectation files: P7 checklist never walked

**Location:** `.scratch/phase-plan.md` lines 1-9; `.scratch/PHASE-P7-STATUS.md` line 3.

**Claim:** Phase P7 "Status: complete" per `PHASE-P7-STATUS.md` line 3.

**Evidence:** The P7 block in `phase-plan.md` has five expectation items, all still unchecked `[ ]`:

```1:9:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/.scratch/phase-plan.md
# P7 — Package engine live

## Expected

1. [ ] Finalized orders materialize packages through the P2 grouping key, and staff can split or regroup before later fulfillment phases.
2. [ ] The package board provides independent `NEW` → `PRINTED` → `PACKED` → `SENT` / `PICKED_UP` status actions plus permission-gated bulk status updates.
3. [ ] The fulfillment dashboard reports channel counts, production work, and a concrete savings summary from grouped packages.
4. [ ] Nightly batches persist separate filing groups for slips, labels, and greeting cards; reruns are idempotent and reprints stay scoped.
5. [ ] Printing records artifacts and audit history without mutating package status; per-order packing slips remain available.
```

`workflow.mdc` Expectation Files: "After the todo: walk that checklist item by item, marking each with evidence… An item without evidence is unchecked; an unchecked item means the todo is not done." `workflow.mdc` Gate discipline: a gate is incomplete if "An expectation checklist item is unchecked or lacks evidence." The status file declares done while the expectation checklist is untouched — same pattern flagged in P6 HIGH-2.

---

## MEDIUM-1 — Anti-hallucination: S3 smoke overclaims "reprints wrote scoped audits"

**Location:** `scripts/smoke-p7.ts` lines 98-102; `.scratch/PHASE-P7-SMOKE.md` line 11.

**Claim:** S3 PASS — "group and order reprints wrote scoped audits, and a printed package remained unshipped."

**Evidence:** The smoke calls `reprintArtifact(artifact.id, staff.id)` (line 98) and `reprintOrderPackingSlip(order.id, staff.id)` (line 99) but never asserts any audit row count. The only post-reprint assertion is `prisma.printArtifact.count({ where: { batchId: firstBatch.batch.id } })` (line 101), which checks that no NEW artifacts were created — it says nothing about audit events. `reprintArtifact`/`reprintOrderPackingSlip` in `lib/print-batches.ts` write `auditEvent` rows (lines 47-49, 56-58), but the smoke never reads `auditEvent.count` to confirm they were written. `clean-code.mdc` Anti-Hallucination: "Do not claim 'fixed/passed/working' without tool output or running-app evidence." The S3 row in `PHASE-P7-SMOKE.md` marks PASS with the "wrote scoped audits" wording despite no evidence.

---

## MEDIUM-2 — Anti-hallucination: S3 "printed package still unshipped" checks the wrong package

**Location:** `scripts/smoke-p7.ts` lines 87-103; `.scratch/PHASE-P7-SMOKE.md` line 11.

**Claim:** S3 PASS — "a printed package remained unshipped."

**Evidence:** The only package advanced to PRINTED is `split` (lines 87-91 advance `split.id` PRINTED → PACKED → SENT). At the end of S3, `split.status === "SENT"`. The S3 closing assertion (line 103) checks a different package:

```103:103:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/scripts/smoke-p7.ts
    assert.equal(await prisma.package.findUniqueOrThrow({ where: { id: firstPackage.id } }).then((packageRecord) => packageRecord.status !== "SENT"), true);
```

`firstPackage` is the source of the split (line 71-73). It was never printed and never advanced — it remains `NEW`. Asserting `NEW !== "SENT"` is trivially true and does not exercise the "printing does not auto-advance shipped state" guarantee that `PHASE-P7-EXPECTED.md` S3 calls for. The actual print-vs-status check lives in S2 (line 86), making the S3 "printed package still unshipped" wording misleading. `clean-code.mdc` Anti-Hallucination: claims must match tool output.

---

## MEDIUM-3 — Duplicated logic: `load()` reimplemented inside `useEffect`

**Location:** `app/admin/packages/page.tsx` lines 25-46.

**Claim:** Initial mount fetch and post-mutation refetch use two copies of the same fetch+setStates logic.

**Evidence:**

```25:46:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/admin/packages/page.tsx
  async function load() {
    const response = await fetch("/api/admin/packages");
    const body = await response.json();
    if (!response.ok) return setMessage(body.error ?? "Packages could not be loaded.");
    setPackages(body.packages);
    setChannels(body.channels);
    setSummary({ productionUnits: body.productionUnits, savedPackageMoves: body.savedPackageMoves });
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/packages", { signal: controller.signal })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (controller.signal.aborted) return;
        if (!response.ok) return setMessage(body.error ?? "Packages could not be loaded.");
        setPackages(body.packages);
        setChannels(body.channels);
        setSummary({ productionUnits: body.productionUnits, savedPackageMoves: body.savedPackageMoves });
      });
    return () => controller.abort();
  }, []);
```

`load()` is called only after mutations (line 58); the `useEffect` inlines the same GET + `setPackages`/`setChannels`/`setSummary` sequence instead of calling `load()` (with an AbortController wrapper). `clean-code.mdc` Refactor categories: "Duplicated logic — pull into `lib/` helpers"; "On every edit: scan for existing solutions… If yes → use it. If close-but-not-quite → extend it, don't fork it." The effect should reuse `load()` and add the abort concern around it.

---

## MEDIUM-4 — Audit durability: `advancePackageStatus` not transactional with its audit

**Location:** `lib/package-operations.ts` lines 153-167; `app/api/admin/packages/route.ts` lines 40-47.

**Claim:** Status update and its audit are separate writes; bulk path runs them concurrently outside any transaction.

**Evidence:**

```159:166:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/package-operations.ts
  const updated = await prisma.package.updateMany({
    where: { id: packageId, version, status: packageRecord.status, isActive: true },
    data: { status, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new Error("This package changed before its status could be saved.");
  await prisma.packageAudit.create({
    data: { packageId, actorId, action: "package.status_changed", details: { from: packageRecord.status, to: status } },
  });
```

The `package.updateMany` and `packageAudit.create` run as independent Prisma calls with no `$transaction`. If the audit insert throws, the status bump persists with no audit trail. `updatePackageStatuses` (lines 169-178) drives these via `Promise.all`, so N packages are advanced and audited concurrently with no shared transaction. The sibling P7 helpers `splitPackage` (line 181) and `regroupPackages` (line 220) both wrap state+audit in `$transaction`; `createNightlyPrintBatch` (line 14) does the same. `workflow.mdc` Security Basics expects auditability; `clean-code.mdc` Error Handling: "Error messages say what went wrong AND what the expected state was" — a partial-failure state is silently committed here. Same shape as P6 LOW-3, escalated because P7 introduces it fresh.

---

## LOW-1 — Magic values: dashboard cap, bulk caps, and PDF line cap unnamed

**Location:** `lib/package-operations.ts` line 130; `app/api/admin/packages/route.ts` lines 12, 17; `lib/print-batches.ts` line 106.

**Claim:** Bounds and rendering caps are inline literals.

**Evidence:**

```130:130:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/package-operations.ts
    take: 250,
```

```12:12:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/api/admin/packages/route.ts
    packageIds: z.array(z.string().cuid()).min(1).max(100),
```

```17:17:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/api/admin/packages/route.ts
  z.object({ action: z.literal("regroup"), packageIds: z.array(z.string().cuid()).min(2).max(25) }),
```

```106:106:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/print-batches.ts
    ...document.lines.slice(0, 55).flatMap((line) => ["0 -16 Td", `(${pdfText(line)}) Tj`]),
```

`250` (dashboard package cap), `100`/`25` (bulk/regroup caps), and `55` (PDF lines per page) appear once each with no named constant. `clean-code.mdc` Refactor categories: "Magic values — named constants / enums." A shared `PACKAGE_DASHBOARD_LIMIT`, `BULK_STATUS_MAX`, `REGROUP_MAX`, and `PDF_LINES_PER_PAGE` would document intent.

---

## LOW-2 — Duplicated logic: production-units sum computed twice

**Location:** `lib/package-operations.ts` lines 132-144.

**Claim:** `packageDashboard` computes `productionUnits` twice over the same dataset.

**Evidence:**

```132:144:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/package-operations.ts
  const channels = new Map<string, { code: string; packageCount: number; productionUnits: number }>();
  for (const packageRecord of packages) {
    const productionUnits = packageRecord.lines.reduce((sum, line) => sum + line.quantity, 0);
    const channel = channels.get(packageRecord.fulfillmentMethod.code) ?? {
      code: packageRecord.fulfillmentMethod.code,
      packageCount: 0,
      productionUnits: 0,
    };
    channel.packageCount += 1;
    channel.productionUnits += productionUnits;
    channels.set(channel.code, channel);
  }
  const productionUnits = packages.reduce((sum, packageRecord) => sum + packageRecord.lines.reduce((lineTotal, line) => lineTotal + line.quantity, 0), 0);
```

The per-channel loop already accumulates `productionUnits` per channel; the trailing `packages.reduce(...)` recomputes the same total a second time. The total can be derived as `sum of channel.productionUnits` (or accumulated in the same loop). `clean-code.mdc` Refactor categories: "Duplicated logic." Minor — two passes over 250 rows — but the second sum is exactly what the loop already computed.

---

## Notes (not findings)

- `lib/checkout.ts` is now 395 lines and mixes checkout, POS, refunds, voids, webhook signature, and now the materialize trigger. It is approaching the 500-line god-file threshold but still under it; the materialize call (line 302) is one line inside an existing transaction, not a new concern. Not a P7 finding.
- `createPdf` in `lib/print-batches.ts` hand-rolls a minimal PDF (no font embedding, 55-line cap). Per `ponytail.mdc` ladder: stdlib has no PDF writer, no native platform helper, no existing PDF dep in `package.json`. The arm chose minimum-code over a new package — ponytail-compliant.
- `codegraph.mdc` could not be applied — no `.codegraph/` index in the arm workspace and no CLI init attempted. Structural lookups used Read/Grep per the "Not initialized" fallback. Same as P6.
- `materializeFinalizedOrder` is called from `completeCheckout` without an `actorId` (line 302). Checkout completion is a webhook event, not a staff action, so `actorId: undefined` on the package audit is appropriate.
- `splitPackage` does not version-check the source package, but the transaction plus the `status: "NEW"` + `isActive: true` filter on `regroupPackages` keeps concurrent regroup/split from silently corrupting state. Not a rules violation.
- `hasSameOrigin` is enforced on both P7 POST routes; GET routes are read-only and permission-gated. Consistent with P5/P6 patterns.
- UI: `/admin/packages` reuses `eyebrow`, `card`, `grid`, `ops-list`, `ops-row`, `check-row`, `button`, `button secondary`, `notice` classes already used in P6 admin pages. `app/admin/layout.tsx` and `app/admin/page.tsx` add the Packages link/card in the same shape as siblings. `clean-code.mdc` UI Consistency: pass.
