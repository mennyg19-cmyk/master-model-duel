# Test 5 — residual clean-code review (arm-03, post self-fix)

**Tree:** `arms/arm-03/workspace`
**Mode:** single, findings only — no fixes applied
**Scope:** Full post-P12 / post-self-fix tree. Structural lookups via `codegraph` (index healthy, 333 files / 3,417 nodes). Targeted reads for the self-fix-touched files (`lib/payments/post-payment.ts`, `app/api/webhooks/stripe/route.ts`, `lib/env.ts`, `lib/test-mode.ts`, `app/api/admin/test-console/route.ts`, `app/api/admin/reconciliation/route.ts`, `lib/reports.ts`, `lib/api/admin-handler.ts`) and the surrounding surface.

## Method note

The prior P12 clean-code review (`P12-clean-code-arm-03.md`) cited `src/lib/ops/...`, `src/lib/reports/performance.ts`, `src/lib/exports/center.ts`, a second `src/lib/payments/reconcile.ts`, `src/lib/ops/test-ops-keys.ts`, and `src/lib/ops/import.ts` (magic values `800000`, `2025-03-01T12:00:00Z`, `orderNumber_repaired`). **None of those paths/symbols exist in this workspace** — the real layout is `lib/` (no `src/`, no `lib/ops/`, no `lib/reports/` or `lib/exports/` subfolders, one `lib/payments/reconcile.ts`, one `lib/reports.ts`, one `lib/exports.ts`). `codegraph` and a literal-string grep for the cited magic values return zero matches. The P12 findings 1, 2, 3, 4, 6, 7, 9, 10, 11, 12, 13, 14, 15 are phantom against this tree and are not re-filed. This review is a fresh pass over the actual current tree.

## Summary counts

- Total findings: **8**
- Major (inconsistent pattern / mixed-concern god file / customer-visible defect): **3**
- Minor (duplication, redundant assertions, count drift, boilerplate): **5**
- Blocker / critical: **0**

## Findings

### 1. Partial `adminHandler` migration — two parallel admin route patterns (MAJOR)

`lib/api/admin-handler.ts` centralizes permission gate → optional open-season 409 → Zod parse → `ActionError` mapping. SR-M6 migrated **only ~6 routes** onto it (reconciliation, refund, payments, void, settings, season-status, plus the earlier season-bound fulfillment routes). At least **25 other admin handlers still hand-roll** `requirePermissionApi` + `safeParse` + status mapping:

- `app/api/admin/products/route.ts` (GET + POST) and `products/[id]/route.ts`
- `app/api/admin/add-ons/route.ts` + `[id]/route.ts`
- `app/api/admin/customers/route.ts`
- `app/api/admin/email/{campaigns,campaigns/[id],campaigns/[id]/send,campaigns/[id]/test-send,lists,templates,test}/route.ts`
- `app/api/admin/legacy-import/route.ts` (3 handlers)
- `app/api/admin/media/route.ts` + `[id]/route.ts`
- `app/api/admin/orders/[id]/{finalize,discard}/route.ts`, `orders/bulk/route.ts`
- `app/api/admin/packages/[id]/{label,split}/route.ts`
- `app/api/admin/pickup-locations/route.ts` + `[id]/route.ts`, `package-types/route.ts`
- `app/api/admin/pos/{draft,checkout}/route.ts`, `print-batches/route.ts`, `repeat/bulk/route.ts`
- `app/api/admin/seasons/route.ts` + `[id]/route.ts`, `shipments/[id]/tracking/route.ts`, `test-console/route.ts`

The self-fix made the inconsistency **worse**, not better: the codebase now holds two competing patterns for the same concern (admin auth + body parse + error mapping). Any future change to the gate contract (e.g. a new `ActionError` status, or the season-409 shape) has to be applied in two places, and the unmigrated routes keep their own divergent status-code mappings. SR-M6's own recommendation was to migrate "the remaining admin POST/PATCH/DELETE handlers onto the helper" — that half was not done.

### 2. Mojibake in customer-visible UI strings (MAJOR)

UTF-8 em dash / minus mis-decoded as Latin-1 (`â€"`, `âˆ'`). SR-m5 flagged only `lib/public-guard.ts` + `lib/shipping/margin.ts` (comments). The defect is broader and reaches the storefront:

- `components/checkout/checkout-form.tsx:136` — fallback conflict message `"Could not start the payment â€" try again"`; `:241` `<option value="">Choose a dayâ€¦</option>`; `:329` `"Starting secure paymentâ€¦"` (the `â€¦` is a separate mis-decode of `…`).
- `lib/checkout/fees.ts:77,86,92,106` — rate-option labels (`${method.name} â€" ${recipient...}`) and `"… is not available for … â€" ZIP … is outside the delivery area"` shown to shoppers; `:126,142` — `"Live shipping rates are unavailable for … â€" try again in a moment"` and `"That delivery day is not offered this season â€" pick one of the listed days"`.
- `lib/public-guard.ts:36` — 429 body `"Too many requests â€" try again in a minute"`.
- `lib/shipping/margin.ts:13,15` — JSDoc comments (`chargeCents âˆ' buy.amountCents`, `… quote â€" the comparison set`).

The checkout-form and fees strings are on the payment path and render broken glyphs to customers. Self-fix did not address any of SR-m1–m9.

### 3. God file `lib/routes/service.ts` — over the 500-line hard split, mixed concerns (MAJOR)

510 lines (SR-m9 reported ~476 as borderline; it has since crossed the threshold). The file mixes route build, day-of notify, stop delivery, and method-switch / reroute. Per `clean-code.mdc` the split is mandatory when **>500 lines OR mixed concerns** — this file trips both. Split into lifecycle / notify / reroute modules before the next route change set.

### 4. Duplicated SQL in `marginReport` totals branch (MINOR)

`lib/reports.ts:183-213` — the `seasonId` and non-`seasonId` totals queries are byte-identical except for one `WHERE` predicate (`AND pkg."seasonId" = ${seasonId}`). Two ~12-line SQL templates differ by one line. Hoist the shared SQL and append the optional predicate, or branch only on the `WHERE` fragment.

### 5. Redundant type assertions / escape-hatch casts (MINOR)

- `app/api/admin/reconciliation/route.ts:33` — `detail: summary as unknown as Record<string, number>`. `writeAudit`'s `detail` is `Prisma.InputJsonValue`; the plain `ReconcileSummary` object is directly assignable. The double cast is the anti-AI-tic the rule flags.
- `app/api/admin/test-console/route.ts:35` — `detail: detail as never`. `detail` is typed `Record<string, unknown>`; the `as never` is an escape hatch to dodge the `InputJsonValue` constraint instead of typing `detail` as `Prisma.InputJsonValue` (or building it as the audit entry directly).

### 6. Count divergence in legacy-import addresses stage (MINOR)

`lib/legacy-import/commit.ts:151-188` — the addresses stage writes its `LegacyImportStage` marker from an inner `created` / `flagged` that only counts addresses with a matching `customerId` (line 157 `if (!customerId) continue`). The `completed.push` at line 187-188 then reports `addresses: plan.addresses.length` and a **separately recomputed** `flagged = plan.addresses.filter(a => a.reviewReason).length` — counting ALL planned addresses, not just the ones actually written. Two sources of truth for the same metric; the run's reported counts can exceed the rows committed in the transaction. Use the inner counters for both, or skip unmatched addresses before computing the reported totals.

### 7. Cron route boilerplate duplicated across 6 routes (MINOR)

`app/api/cron/{stripe-reconciliation,email-log-purge,notification-sweeper,payment-reminders,pickup-expiry,season-flip}/route.ts` each repeat the same three-line skeleton: `const denied = requireCronAuth(request); if (denied) return denied;` → `runCronJob(jobName, fn)` → `return Response.json({ ok: true, ...result })` → `export { POST as GET }`. A `cronHandler(jobName, fn)` helper would collapse it. Borderline under the "leave stable duplication" rule (3 lines/route), but the pattern is now at 6 call sites and growing.

### 8. God file `scripts/smoke-p12.ts` — 809 lines, single `main()` (MINOR)

SR-m8 residual. Longest file in the tree; one `main()` walks S1–S5 plus wipe/reseed. Harder to localize failures than per-scenario scripts. Lower priority (test/smoke script, not shipped code), but it is the largest file in the repo and the only one over 500 lines besides `lib/routes/service.ts`.

## Notes

- Self-fix fixes (SR-B1, SR-M1–SR-M6) verified in place: `recordRefund` claims the `pending_*` placeholder (post-payment.ts:59-95); `handleChargeRefunded` no longer books under synthetic `${charge.id}:refunded:…` keys and waits for expanded refunds / `charge.refund.updated` (webhooks/stripe/route.ts:224-258); `AUTH_MODE=clerk` refused at env load (lib/env.ts); destructive test console gated on `allowsDestructiveTestConsole()` (lib/test-mode.ts, test-console route); reconciliation PATCH requires `payments.refund` (reconciliation route:42); `marginReport({ seasonId, limit })` filters per-label rows and season totals by season (lib/reports.ts:156-237, reports page:19).
- `codegraph` confirms no dead-code duplicates of the reports/exports/reconcile/test-mode modules exist in this tree (single file each).
- No regressions introduced by the self-fix were found in the touched files; the residuals above are pre-existing items the self-fix did not reach (1, 2, 3, 4, 7, 8) or new minor smells in self-fix-touched code (5, 6).
