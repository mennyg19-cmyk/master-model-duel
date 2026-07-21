# Reviewer specialist — Quality

**Arm:** arm-02
**Tree / phase:** P12 (Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness)
**Output:** results/reviews/P12-quality-arm-02.md
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs `shared/phases/PHASE-P12-EXPECTED.md`. Findings only — no fixes. Blind to model name.

## Evidence reviewed

- `lib/reports.ts`, `lib/exports.ts`, `lib/legacy-import.ts`, `lib/payments/reconcile.ts`, `lib/test-console.ts`, `lib/test-mode.ts`, `lib/cron.ts`, `lib/imports.ts`, `lib/env.ts`, `lib/auth/permissions.ts`
- `app/api/admin/exports/[dataset]/route.ts`, `app/api/admin/legacy-import/route.ts`, `app/api/admin/legacy-import/review/route.ts`, `app/api/admin/reconciliation/route.ts`, `app/api/admin/test-console/route.ts`
- `app/api/cron/{notification-sweeper,payment-reminders,pickup-expiry,season-flip,email-log-purge,stripe-reconciliation}/route.ts`
- `app/(admin)/admin/{reports,exports,import,test-console,help}/page.tsx`, `app/(admin)/admin/layout.tsx`, `app/(storefront)/layout.tsx`
- `components/admin/{recon-panel,legacy-import-client,test-console-client}.tsx`, `components/test-mode-banner.tsx`
- `prisma/schema.prisma` (P12 models), `vercel.json`
- `.scratch/PHASE-P12-SMOKE.md` (46/46 PASS), `.scratch/PHASE-P12-STATUS.md`, `.scratch/p12-smoke-output.log`

## Phase coverage vs EXPECTED

All five P12 "must be true" items are implemented and covered by smoke S1–S5 (46/46 PASS, `npm run ci` + `npm run build` green). No stubs, no missing smoke, no broken flows observed. Findings below are quality defects, not phase gaps.

## Findings

### M1 — Mojibake em-dashes in user-visible reports UI (Medium)
`app/(admin)/admin/reports/page.tsx:79` and `:175` contain `â€"` (UTF-8 em-dash `E2 80 94` mis-decoded as Latin-1 and re-encoded). The drill-down card title renders as `{seasonName} â€" drill-down` and the per-label order-number cell renders `"â€""` for unlabeled shipments. Garbled text is shown to staff on `/admin/reports`. Confirmed via byte grep — only this file is affected.

### M2 — Export audit row is skipped on client disconnect (Medium)
`app/api/admin/exports/[dataset]/route.ts:34-54` writes the `export.run` audit row only inside `pull()` when `next.done` fires. If the client disconnects mid-stream, `ReadableStream.cancel()` runs `generator.return()` and the audit never writes. A partial/aborted CSV download leaves no audit trail, undercutting the "every download is audited" guarantee (R-092, S2 checks only the full-stream path).

### M3 — Reconciliation matcher is N+1 over sessions and payments (Medium)
`lib/payments/reconcile.ts:40-89` issues one `db.payment.aggregate` per checkout session, and `:96-114` issues up to two `findFirst` calls per posted Stripe payment. At the 1k-order / 5k-package scale baseline this is bounded today, but the nightly cron cost grows linearly with posted Stripe payments and sessions; a single batched lookup (or a join) would remove the loop. Performance, not correctness — reruns are idempotent and smoke S2 passes.

### L1 — `PaymentReconFlag.kind` schema comment drift (Low)
`prisma/schema.prisma:1012` documents the kind set as `orphaned_payment | amount_mismatch | unmatched_refund | missing_payment_row`, but `reconcile.ts` emits `refund_failed` and `ledger_only_payment`. The inline contract is stale; nothing validates the enum string, so the drift is silent.

### L2 — `LegacyImportRun.status` `FAILED` is unreachable dead state (Low)
The `LegacyImportStatus` enum includes `FAILED` and the UI badges it red (`legacy-import-client.tsx:176`), but `commitLegacyImport` only transitions `DRY_RUN → COMMITTING → COMPLETED`. A crash leaves the run `COMMITTING` (resumable by design — S3). There is no code path that ever sets `FAILED`, so the badge branch is dead and the status is misleading.

### L3 — `wipeOpenSeason` deletes recon flags and webhook events globally (Low)
`lib/test-console.ts:49-50` deletes every `paymentReconFlag` and every `stripeWebhookEvent` row, ignoring the open-season scope the rest of the wipe enforces. Recon flags can reference orders in other seasons (`orderId` is nullable / cross-season). Test-only and the smoke proves catalog/customers/audit survive, but cross-season recon history is lost on each wipe. Acceptable for a test console, but the scope asymmetry is undocumented.

### L4 — `planLegacyImport` repeat-email rows don't record merge lines (Low)
`lib/legacy-import.ts:179-198`: when a row matches an existing customer by email, the collapse branch (`customersByKey.has(key) && !emailValid`) and the email-hit branch both skip the `mergedFromLines.push(line)` that the phone-merge branch performs. `mergedFromLines` is currently unused in the report, so no user impact, but the asymmetry is a latent bug if the field ever feeds the report.

### L5 — `seasonDrilldown` "line revenue" excludes add-ons/options (Low)
`lib/reports.ts:100` computes `lineRevenueCents` as `SUM(quantity * unitPriceCents)` only. Line add-ons and options (which contribute to `Order.itemsCents`/`totalCents` in `seasonPerformance`) are excluded, so per-method revenue won't tie back to the season-performance totals. Labeled "Line revenue" so arguably by design, but staff reconciling the two views will see a mismatch with no explanation on the page.

## Severity counts

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 3 |
| Low | 5 |
| **Total** | **8** |

No blockers. Phase P12 is functionally complete and smoke-green; findings are quality/polish defects.
