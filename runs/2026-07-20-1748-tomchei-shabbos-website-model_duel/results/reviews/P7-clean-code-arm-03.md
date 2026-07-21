# P7 Clean-Code Review — arm-03 (blind label)

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Phase: P7
Tree: `arms/arm-03/workspace/src`
Reviewer role: clean-code specialist (external)
Scope: duplication, naming, god files, pattern drift per `rules/clean-code.mdc`.
Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 6 |
| Medium | 7 |
| Low | 3 |
| **Total** | **16** |

The tree is well-typed and consistently structured at the API boundary, but two parallel domain implementations (packages, print batches) and one duplicated helper layer (row locks, pagination, audit writes, money formatting) account for most of the drift. Two files cross the 500-line god-file threshold; one file (`finalize.ts`) has a formatting anomaly that doubles its line count.

## Findings

| ID | Severity | Location | Claim |
|---|---|---|---|
| CC-03-01 | High | `lib/ops/packages.ts` vs `lib/packages/actions.ts` | Two parallel implementations of `splitPackage` / `regroupPackages` / package-stage advance. `lib/ops/packages.ts` exposes `splitPackage`, `regroupPackages`, `bulkAdvancePackageStage`; `lib/packages/actions.ts` exposes `splitPackage`, `regroupPackages`, `advancePackageStage`. Routes are split across both (`api/admin/packages/[id]/route.ts` imports from `ops/packages`; `api/admin/packages/[id]/split/route.ts` and `regroup/route.ts` import from `packages/actions`). Same domain, two sources of truth — drift is inevitable. |
| CC-03-02 | High | `lib/ops/print-batch.ts` vs `lib/print/batches.ts` | Two parallel print-batch implementations. `ops/print-batch.ts` (439 lines) exposes `runNightlyPrintBatch`, `reprintFilingGroup`, `reprintOrder`, `listPrintBatches`, `getPrintArtifact`, `packageStagesForBatch`. `print/batches.ts` (310 lines) exposes `runNightlyBatch`, `reprintFilingGroup`, `reprintOrder`, `buildOrderPackingSlip`. `api/admin/print-batches/route.ts` uses the former; `api/admin/orders/[id]/packing-slip/route.ts` uses the latter. Same domain, two implementations, two `packageInclude` shapes, two `PackageRow` types, two `filingGroup` derivations. |
| CC-03-03 | High | `lib/orders/package-stages.ts`, `lib/packages/actions.ts`, `lib/ops/packages.ts` | Three implementations of the package stage transition (lock → `assertPackageTransition` → version-guarded update → `packageAuditLog` + `auditLog`). `transitionPackage`, `advancePackageStage`, and `bulkAdvancePackageStage` each re-do the same skeleton. The audit-log meta shape also differs (`bulk: true` flag only in the bulk path). |
| CC-03-04 | High | `lib/orders/lock.ts`, `lib/orders/package-stages.ts:42`, `lib/ops/packages.ts:196`, `lib/ops/refunds.ts:17` | Four near-identical row-lock helpers (`lockOrderForUpdate`, `lockPackageForUpdate`, `lockPackage`, `lockPaymentForUpdate`). Each is `SELECT id FROM "<Table>" WHERE id = $1 FOR UPDATE` then `findUniqueOrThrow`. Same pattern, four copies, four error messages. |
| CC-03-05 | High | `lib/checkout/session.ts:348-358, 423-441, 535-547` | The `zip_blocked` conflict envelope `{ kind: "zip_blocked", zips: error.zips, message: error.message }` is constructed three times verbatim, once inside `prepareCheckout` and twice inside `createHostedCheckout` (inner `assertPerPackageZipsAllowed` catch and outer `processStripeWebhook`-style catch). Trivially extractable to a `zipBlockedConflict(error)` helper. |
| CC-03-06 | High | `lib/orders/finalize.ts` (whole file) | Formatting drift: every code line is followed by a blank line, doubling the file to 539 lines for ~200 LOC. `prettier`/`eslint` would reformat on save; this file escaped that. Hurts readability and makes the file look like a god file when it is not. |
| CC-03-07 | Medium | `lib/ops/orders.ts:8-23`, `lib/ops/packages.ts:13-28`, `lib/ops/customers.ts:10-11`, `lib/audit.ts:25-26` | Pagination constants and `clampPageSize` are duplicated across four files. `orders.ts` uses `DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE`; `packages.ts` uses `DEFAULT_PAGE`/`MAX_PAGE`; `customers.ts` inlines `DEFAULT_PAGE = 50; MAX_PAGE = 100` with no helper; `audit.ts` uses `DEFAULT_AUDIT_LIMIT`/`MAX_AUDIT_LIMIT` with inline clamp. One shared `lib/pagination.ts` would cover all four. |
| CC-03-08 | Medium | `lib/storefront/catalog-shared.ts:32` vs `app/(admin)/admin/page.tsx:7-10`, `components/admin/catalog-admin.tsx:245`, `components/admin/order-detail.tsx:122,133,134`, `components/admin/orders-list.tsx:193`, `components/admin/addon-admin.tsx:134` | `formatCents` exists and is used by storefront + builder + checkout, but admin components re-implement money formatting inline as `$${(cents / 100).toFixed(2)}` (5 files, 6 sites). `admin/page.tsx` even defines a local `money()` helper instead of importing. Two money-formatting patterns coexist. |
| CC-03-09 | Medium | `lib/audit.ts:6` (`writeAudit`) vs ~12 files using `db.auditLog.create` directly | Centralized `writeAudit` helper is used by ~15 call sites, but ~12 other sites call `tx.auditLog.create` / `db.auditLog.create` directly: `lib/orders/drafts.ts` (3x), `lib/ops/packages.ts` (3x), `lib/ops/print-batch.ts` (1x), `lib/ops/refunds.ts` (3x), `lib/payments/webhook.ts` (4x), `lib/payments/offline.ts` (3x), `lib/orders/finalize.ts` (3x), `lib/orders/package-stages.ts` (1x), `lib/packages/actions.ts` (3x), `lib/checkout/session.ts` (1x), `lib/inventory/reserve.ts` (1x), `lib/address/book.ts` (3x). The helper exists; half the codebase ignores it. |
| CC-03-10 | Medium | `lib/ops/customers.ts:13-55` (`listCustomers`) vs `lib/ops/customers.ts:270-290` (`searchCustomersForPos`) | The customer OR-search predicate (displayName / email / phone / emailNorm / phoneNorm) is built twice in the same file. The `listCustomers` version adds `_count` includes and pagination; `searchCustomersForPos` adds `take` and orderBy — but the OR clause is duplicated. |
| CC-03-11 | Medium | `components/order/assign-dialog.tsx:252-298` vs `302-369` | The "edit saved address" form and the "new recipient" form share 5+ identical `<Input>` fields (recipientName, line1, city, state, postalCode, label) bound to the same `form` state. Two ~30-line JSX blocks differ only by `data-testid` prefixes and the autocomplete widget. Extractable to a single `<AddressFields form={form} setForm={setForm} testIdPrefix="..." />` component. |
| CC-03-12 | Medium | `lib/orders/drafts.ts` (540 lines) | God file: mixes draft creation, line add/update/remove, three-way assignment, guest-token lifecycle, and cancellation. Splits naturally: `drafts/create.ts`, `drafts/lines.ts`, `drafts/assign.ts`, `drafts/guest.ts`. Crosses the >500-line threshold in `clean-code.mdc`. |
| CC-03-13 | Medium | `lib/checkout/session.ts` (512 lines) | God file: mixes order loading, fee-line mapping, validation-line mapping, price refresh, summary build, prepare flow, hosted-checkout flow. `buildCheckoutSummary`, `prepareCheckout`, `createHostedCheckoutSession` each warrant their own file under `lib/checkout/`. |
| CC-03-14 | Low | `lib/ops/packages.ts:458` (file length) | At 458 lines, `ops/packages.ts` is under the 500-line threshold but bundles list query + dashboard + split + regroup + bulk stage. Same concern cluster as CC-03-01; resolving the duplication also resolves this. |
| CC-03-15 | Low | `lib/ops/refunds.ts:157-170, 173-177` | `Object.assign(new Error(...), { code: "..." })` pattern is used to thread error codes out of the transaction, then re-checked in the catch. The codebase already has a `Result<T, E>` type with `err(code, message)` — refunds should return `Result` from inside the transaction rather than throwing decorated errors. Two error-signaling patterns in one file. |
| CC-03-16 | Low | `lib/checkout/session.ts:51-69` (`loadOrderForCheckout`) and `lib/ops/print-batch.ts:46-65` (`packageLoadInclude`) and `lib/ops/packages.ts:30-54` (`packageInclude`) and `lib/print/batches.ts:8-30` (`packageInclude`) | Four separate Prisma `include` shapes for `Package`/`Order` loading, each slightly different (different `order` selects, different `items` includes). No single source of truth for "what fields does a printable package need" vs "what fields does a list view need" — but the overlap is large. Resolving CC-03-02 collapses two of these. |

## Notes

- No dead code blocks found in the sampled files; `eslint.config.mjs` is minimal and `tsconfig.tsbuildinfo` is committed (1.1 MB) — that is a build artifact that should be in `.gitignore`, but that is a hygiene finding, not a clean-code finding.
- Naming is generally strong: boolean `isSoldOut`, `hasPermission`, `canTransitionOrder`; plural collections `lines`, `methods`, `packages`; domain abbreviations (`id`, `db`, `sku`) used consistently.
- `lib/orders/grouping.ts`, `lib/orders/state-machine.ts`, `lib/result.ts`, `lib/permissions.ts`, `lib/brand.ts` are tight single-concern files — these are the templates the rest of `lib/` should follow.
- The `lib/ops/` vs `lib/<domain>/` split is itself a pattern-drift signal: `lib/ops/packages.ts` and `lib/packages/actions.ts` both deal with packages; `lib/ops/print-batch.ts` and `lib/print/batches.ts` both deal with print batches. The codebase has not decided whether ops lives under `ops/` or under the domain folder.
