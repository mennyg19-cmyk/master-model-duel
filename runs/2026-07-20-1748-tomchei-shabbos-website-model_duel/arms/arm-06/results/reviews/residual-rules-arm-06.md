# Residual Rules Review — arm-06 (Test 5, post-fix tree)

**Arm:** arm-06 (blind — no model names)
**Tree graded:** `arms/arm-06/workspace/` (post self-fix)
**Rules in scope:** ponytail, clean-code, workflow, vocabulary, codegraph
**Reviewer posture:** findings only; did not read SELF-REVIEW.md or SELF-FIX-NOTES.md.

## Method

Walked the post-fix tree with the five selected catalog rules. Checked: god files (>500 lines / mixed concerns), dead code, naming (banned standalone names), inline styles, swallowed errors, redundant assertions, barrel files, defensive/just-in-case code, comment quality, UI consistency, dependency discipline, codegraph adherence (no grep-for-structure — not applicable to a reviewer reading files). Findings only — no scoring here (scoring lives in the residual rubric).

## Findings

### 1. Dead code — `isProductionDeploy` exported, never imported (clean-code: dead code; ponytail: deletion over addition)

`lib/env.ts:32` exports `isProductionDeploy`:

```32:32:arms/arm-06/workspace/lib/env.ts
export const isProductionDeploy = process.env.VERCEL_ENV === "production";
```

A workspace-wide search returns exactly one occurrence — the declaration itself. No module imports it. The dev-bypass predicate that lives alongside it (`isDevAuthBypass`) is wired through `lib/auth.ts`, the middleware, `/dev-login`, and every `/api/dev/*` fixture route, so the production-deploy flag was either superseded by the `VERCEL_ENV !== "production"` checks inside `lib/dev-auth.ts` or left behind a refactor. Either way it is dead and should be deleted, not left as a "might be useful later" export (ponytail Rule of 2 / YAGNI).

**Severity:** minor (blocker-class rules: none). Does not affect behavior; violates the dead-code category of the clean-code refactor checklist.

### 2. God file — `lib/shipping/labels.ts` at 597 lines (clean-code: split when >500 lines)

```597:597:arms/arm-06/workspace/lib/shipping/labels.ts
```

Single concern (carrier label lifecycle: purchase, void, refund, tracking, stuck-purchase sweep), cohesive, and the size is driven by the transactional audit + Shippo call shape — not a grab-bag. Still trips the clean-code bright line ("split when >500 lines"). A natural split is `lib/shipping/labels/purchase.ts` vs `lib/shipping/labels/sweep.ts` (the stuck-purchase resolution + `STUCK_PURCHASE_TTL_MINUTES` block is a self-contained cron helper). Borderline — flagging because the rule is a hard line, not a judgment call.

**Severity:** minor. No mixed-concern smell; the size alone is the trip wire.

### 3. Naming — `result` / `data` as standalone names (clean-code: banned vague names)

The clean-code rule bans `data`, `result`, `info`, `temp`, `val`, `item`, `thing` as standalone names. The post-fix tree has a systemic pattern of `const result = await apiFetch<...>(...)` in client components and `const data = ...` in a few lib/routes:

- `app/(admin)/admin/page.tsx:23` — `const data = canPayments ? await getDashboardData(...) : null`
- `lib/imports/customers.ts:16` — `const data = { name, email, phone: phone || null }`
- `lib/imports/legacy/customers.ts:47,116,128` — `const data = ...` (LegacyCustomerData)
- `components/admin/email/campaign-editor.tsx:85,104`, `app/(admin)/admin/imports/import-upload.tsx:58`, `components/repeat/repeat-review.tsx:78`, `components/admin/email/lists-tab.tsx:22`, `app/(admin)/admin/customers/[customerId]/customer-editor.tsx:30`, `app/(admin)/admin/bulk/bulk-schedule-form.tsx:27`, `app/(admin)/admin/routes/route-builder.tsx:25`, `app/(admin)/admin/packages/[packageId]/method-switch.tsx:55`, `app/(admin)/admin/packages/[packageId]/package-actions.tsx:64,94,115`, `app/(admin)/admin/pos/pos-shell.tsx:46,75`, `app/(storefront)/account/orders/[id]/cancel-draft-button.tsx:18`, `app/(admin)/admin/imports/[batchId]/import-preview.tsx:46` — `const result = await apiFetch<...>(...)`
- `lib/shipping/shippo.ts:285`, several `app/api/admin/.../route.ts` handlers — `const result = await ...`

The `result` pattern is pervasive enough to be a convention rather than a slip, but the rule names `result` as banned standalone. Two readings are defensible: (a) the rule is absolute and every occurrence is a finding; (b) `result` of a typed `apiFetch<T>` carries the type at the call site, so the vagueness is mitigated. Grading it as a systemic minor finding rather than 25 individual ones — a single sweep renaming to `submitResult` / `fetchResult` / the specific noun (`sendResult`, `importResult`, `switchResult`) would clear the category.

**Severity:** minor / systemic. No behavior impact; readability-only.

### 4. Inline styles — `app/global-error.tsx` (clean-code: no rogue styling)

```25:27:arms/arm-06/workspace/app/global-error.tsx
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafaf9" }}>
        <main style={{ padding: "4rem", textAlign: "center" }}>
```

This is the **one** screen in the tree with inline styles. It is also the **one** screen where Tailwind is unavailable — `global-error.tsx` replaces the root layout and `globals.css` is not loaded for it. The file documents the constraint in a comment at line 6–7. This is a justified exception, not a rogue-styling violation. Noting for completeness so the residual record shows it was examined, not missed.

**Severity:** not a finding (documented exception). No action.

### 5. Comment quality — narration / change-explanation comments present but bounded

The post-fix tree leans heavily on "why" comments (good — e.g., `lib/dev-auth.ts:1-13`, `lib/orders/drafts.ts:14-18`, `lib/exports/datasets.ts:35-39` formula-injection note, `lib/payments/stripe.ts:114-118` idempotency-key note). A small number drift toward change-explanation:

- `lib/env.ts:28-31` — "The bypass predicate lives in lib/dev-auth.ts (single source shared with middleware)..." — this is a change-explanation comment ("lives in", "shared with") that narrates the SR-05 fix. The code already shows the import; the comment restates the fix's rationale. Borderline — it does carry the fail-closed reasoning that the code alone doesn't convey, so most of it earns its keep. The first sentence ("The bypass predicate lives in lib/dev-auth.ts...") is the narration part.
- `lib/dev-auth.ts:1-13` — the header comment is a 13-line essay on the SR-05 fix. Lines 1–6 explain *why* this file exists (good: constraint + fail-closed reasoning). Lines 8–13 explain the Vercel-vs-APP_ENV reasoning (good: non-obvious). The "Single source for the dev-login bypass predicate (SR-05)" opening line is the change-explanation part.

Both are defensible because the non-obvious platform-gating logic genuinely needs prose. Trimming the "single source / shared with middleware" sentences would tighten them. Not a blocker.

**Severity:** minor / stylistic. No action required.

## What was checked and came back clean

- **Swallowed errors:** no empty `catch (e) {}` or `catch () {}` blocks. The one `.catch(() => {})` in `app/global-error.tsx:18` is documented ("Reporting must never mask the original error").
- **`as any`:** zero occurrences in the workspace.
- **`as unknown as`:** 27 occurrences, all legitimate — Prisma `InputJsonValue` casts (Prisma's JSON typing gap), `globalThis` singleton patterns, and session-codec payload casts. None are redundant-assertion anti-AI-tics.
- **Barrel files:** no `index.ts` re-exporting 5+ modules. The clean-code barrel rule is not tripped.
- **TODO/FIXME/HACK/XXX:** zero in the workspace.
- **Dependency discipline:** no new packages added in the post-fix diff. `lib/payments/stripe.ts` documents the ponytail-ladder decision (native fetch + node:crypto instead of the stripe SDK) at line 5–8. `lib/media/storage.ts` lazy-imports `@vercel/blob` only when the token is set — same lazy-singleton discipline as Stripe.
- **UI consistency:** storefront and admin both ride the Tailwind v4 token set in `app/globals.css` `@theme`; the only outlier is the documented `global-error.tsx` exception above.
- **SR-05 fix integrity (post-fix tree):** `lib/dev-auth.ts` is the single source for `isDevAuthBypassEnabled()`. `middleware.ts:3` imports it; `lib/env.ts:3` imports it and re-exports `isDevAuthBypass` from it. The middleware (edge bundle) reads raw `process.env` via the predicate and never pulls the zod env parse. The fail-closed defaults (`"false"`, `"production"`) are consistent across both call sites. The fix is sound; the only leftover is the dead `isProductionDeploy` (finding 1).
- **Codegraph rule:** a reviewer reading files does not run structural lookups, so the "Grep tool forbidden when index healthy" clause does not apply to this pass. No violation to record.

## Counts

| Category | Count |
|---|---:|
| Blockers | 0 |
| Majors | 0 |
| Minors | 4 |
| Notes (no action) | 1 |
| **Total findings** | **5** |

**Minors breakdown:**
1. Dead code — `isProductionDeploy` exported, never imported (`lib/env.ts:32`).
2. God file — `lib/shipping/labels.ts` at 597 lines (single concern, trips the >500 line).
3. Naming — systemic `const result = await apiFetch<...>()` / `const data = ...` standalone names (clean-code banned list).
4. Comment quality — two post-fix header comments drift toward change-explanation in their opening sentences (`lib/env.ts:28-31`, `lib/dev-auth.ts:1`).

**Notes:** `app/global-error.tsx` inline styles — documented exception, not a finding.
