# Test 5 residual — Rules review (arm-04)

**Reviewer:** external residual reviewer (rules)
**Mode:** blind — post-fix tree only (SELF-REVIEW / SELF-FIX-NOTES / self-fix chat not read)
**Tree graded:** `arms/arm-04/workspace/`
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Date:** 2026-07-27

## Severity summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 3 |

Overall: the post-fix tree adheres to all five selected catalog rules. Findings below are cosmetic naming nits. No structural, security, or abstraction-discipline violations found.

## Rule-by-rule

### ponytail — pass

- **Ladder / stdlib first.** `node:crypto.randomUUID` (`src/lib/payments/offline-payments.ts`, `src/lib/media/library.ts`), platform `Intl` for dates, `node:test` for the suite. No date library, no test framework dep, no convenience package added. `package.json` deps are pinned and minimal (Next, React, Prisma, Clerk, Zod, Vercel Blob, clsx, tailwind-merge).
- **No unrequested abstractions.** Helpers are pulled into `lib/` only where 2+ call sites exist (`recordAudit`, `normalizeEmail`, `normalizePhone`, `runInTransaction`, `survivorOf`, `customerSearchWhere`). No barrel files; no wrapper components under 5 lines of JSX.
- **God files.** Largest source files are `src/lib/env-spec.ts` (445 lines) and `src/lib/orders/order-service.ts` (407 lines). Both under the 500-line trigger; both single-concern. No split required.
- **Anti-slop.** README, comments, and error strings are plain English, no AI-isms (no matches for `seamless|leverage|holistic|cutting-edge|delve|testament|tapestry|realm of|comprehensive solution|pivotal moment`). No sycophancy openers, no tricolon padding.
- **`ponytail:` shortcut comments.** None present — no deliberate shortcuts taken that would need flagging.

### clean-code — pass with minor findings

- **Abstraction discipline / Rule of 2.** Shared primitives (`Card`, `Badge`, `Button`, `FlashMessages`, `ReportTabs`) are reused across admin screens; `src/app/(admin)/admin/reports/payments/page.tsx` is representative. No competing UI kits, no forked near-matches.
- **Comment quality.** Comments consistently explain *why* and cite the requirement (R-045, R-060, R-093, R-122, R-144, R-167, UR-012, UR-014, G-024, etc.). No narration comments, no change-explanation comments. Examples: `src/lib/orders/state-machine.ts:8-13`, `src/lib/payments/reconciliation.ts:8-31`, `src/lib/checkout/checkout-service.ts:19-28`.
- **Error handling.** Every `failure(...)` carries a message stating what went wrong and the expected state (`src/lib/payments/offline-payments.ts:64,71,79`, `src/lib/customers.ts:294`). No empty catch blocks. Duplicate-key paths re-read the winner rather than surfacing a 500 (`customers.ts:40-44,262-266`; `bootstrap.ts:78-80`).
- **Anti-AI-tics.** No try/catch around non-throwing code; no redundant type assertions; no "just in case" branches. `rejectWith` / `redirectWithFlash` are typed `never`, so the post-check code in `src/app/(admin)/admin/email/actions.ts` is sound.
- **UI consistency.** New screens reuse the header / tabs / flash / shared UI kit pattern. `data-testid` attributes are consistent across the admin reports screens.
- **Consistency (one pattern per concern).** Explicitly documented in `README.md` § Conventions (lines 417–438): one Prisma client, Zod at every trust boundary, `Result` for errors, integer cents, platform `Intl`, Tailwind + tokens, shadcn-style primitives, optimistic `version` columns, `runInTransaction`, `recordAudit` with typed `AuditDetails`. The code follows it.
- **Dependency discipline.** All versions pinned (`package.json`). No floating ranges. No convenience-only additions.

Findings:

1. **Minor — banned standalone name `result`.** `src/app/(storefront)/newsletter-actions.ts:22,45,59` uses `const result = await subscribe(...) / updatePreferencesByToken(...) / unsubscribeByToken(...)`. `result` is on the clean-code banned list. Rename to the domain outcome (e.g. `subscription`, `update`, `unsubscribe`).
2. **Minor — banned standalone name `data`.** `src/lib/catalog/admin.ts:95,212` and `src/lib/imports/import-service.ts:342` use `const data = { ...fields, priceCents: price }` as the Prisma `data:` argument. Idiomatic for Prisma, but the rule bans `data` as a standalone name; rename to `productData` / `rowData` to satisfy the rule literally.
3. **Minor — banned standalone name `item` in a non-loop binding.** `src/lib/testing/console.ts:56` binds `const item = SEED_ITEMS[index % SEED_ITEMS.length]`. `item` is on the banned list; rename to `seedItem` or `chosenSeed`. (Loop-iteration `for (const item of items)` in `bin-packing.ts:75` is the standard idiom and not flagged.)

### workflow — pass

- **Tone.** Plain English throughout, audience-appropriate, no jargon. Comments and README read like a developer wrote them.
- **Security basics.** `.gitignore` covers `.env*` with `!.env.example` exception, `/.pgdata/`, `/.scratch/`, `/.codegraph/`, `.vercel`, `*.tsbuildinfo`, `next-env.d.ts`. `.env.example` has a placeholder for every secret; each secret line is annotated `# Secret: rotate immediately if it ever leaves this machine.` `src/lib/env-spec.ts` rejects weak/placeholder secrets at boot (`isWeakSecret`, `checkSecretStrength`) and enforces loopback-only stand-ins for auth, payment, shipping, media, email, SMS, and cron. `TRUST_PROXY_HEADERS=false` by default so audit rows record no forgeable client IP.
- **Untrusted-content boundary.** Public endpoints validate body, rate-limit, and check same-origin (`src/lib/http/public-guards.ts`); webhook bodies are parsed with a named Zod schema before any write (`src/lib/payments/webhook-service.ts:39-58`).
- **PowerShell discipline.** N/A in product code; the workspace ships `scripts/*.ts` run via `tsx`, not inline `$` PowerShell.
- **Run-state / expectation files.** `.scratch/` exists and is gitignored. (Contents not read — out of scope for a blind rules review.)

### vocabulary — pass (N/A)

- No `refactor` / `rebuild` / `redesign` / `tidy` / `cleanup` / `hotfix` / `audit` command was issued in this residual pass, so the load-on-demand vocabulary rules were not triggered. The graded tree shows no evidence of an under-scoped refactor (no single-category-only refactors, no pixel-copy rebuilds).

### codegraph — pass

- **Index present and healthy.** `.codegraph/codegraph.db` (15 MB SQLite, last built 2026-07-27 10:34) exists. `.codegraph/.gitignore` and the root `.gitignore` `/.codegraph/` entry keep the index out of git.
- **Rule satisfied.** The arm initialized and kept a CodeGraph index; structural lookups have a deterministic surface available. (Whether every spawn used MCP vs CLI is not observable from the tree; the index existing and being gitignored is the rule's observable outcome.)

## Files sampled

- `package.json`, `.gitignore`, `.env.example`
- `src/lib/env-spec.ts`, `src/lib/audit.ts`, `src/lib/bootstrap.ts`, `src/lib/customers.ts`
- `src/lib/checkout/checkout-service.ts`, `src/lib/orders/state-machine.ts`, `src/lib/orders/order-service.ts`
- `src/lib/payments/reconciliation.ts`, `src/lib/payments/offline-payments.ts`, `src/lib/payments/webhook-service.ts`
- `src/lib/imports/import-service.ts`, `src/lib/imports/prior-year-orders.ts`
- `src/lib/migration/address-cleanup.ts`, `src/lib/migration/legacy-import.ts`
- `src/lib/reports/export-service.ts`, `src/lib/media/library.ts`, `src/lib/http/public-guards.ts`, `src/lib/auth/staff.ts`
- `src/app/(admin)/admin/reports/payments/{page,actions}.tsx`, `src/app/(admin)/admin/email/actions.ts`, `src/app/(admin)/admin/email/templates/actions.ts`
- `src/app/(storefront)/newsletter-actions.ts`, `src/lib/catalog/admin.ts`
- `prisma/schema/customers.prisma`, `prisma/migrations/20260727110000_p12_self_fix_customer_merge/migration.sql`
- `README.md` (§ Conventions, § Roles and permissions)
- Tree-wide greps for banned names, slop words, and `TODO/FIXME/HACK` markers

## Conclusion

The post-fix arm-04 tree adheres to ponytail, clean-code, workflow, vocabulary, and codegraph. The three minor findings are standalone-name nits that do not affect behavior, security, or structure. No blockers, no majors.
