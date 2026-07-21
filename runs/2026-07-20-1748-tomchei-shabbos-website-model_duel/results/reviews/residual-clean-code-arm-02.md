# Residual Clean-Code Review — arm-02 (post self-fix, Test 5)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-02`
**Tree reviewed:** `arms/arm-02/workspace/` (full post-fix tree)
**Reviewer:** Clean-code specialist (blind — no SELF-REVIEW / SELF-FIX-NOTES / self-review chat read)
**Scope:** duplication, naming, god files, pattern drift. Findings only — no fixes.

The post-fix tree is large (~300 TS/TSX files across `app/`, `components/`, `lib/`). The largest file is 475 lines; nothing crosses the 500-line god-file threshold. The self-fix legacy-import split (`lib/legacy-import.ts` → `lib/legacy-import/plan.ts` + `commit.ts`) is a clean concern split. Residual issues are concentrated in **pattern drift**: shared abstractions exist and are documented as "the one place," but adoption is partial, leaving hand-rolled duplicates next to the helper.

## Severity summary

| # | Severity | Category | Finding | Location |
|---|---|---|---|---|
| 1 | **High** | Pattern drift | `adminHandler` helper adopted in only 11 of ~50 admin route files; the rest hand-roll the same permission→season→parse→ActionError boilerplate it was written to replace | `lib/api/admin-handler.ts` vs `app/api/admin/**` |
| 2 | **Medium** | Pattern drift | `apiFetch` helper is the documented single read point for the `{error}` convention, but customer-facing forms duplicate the fetch+error boilerplate verbatim | `lib/api-client.ts` vs `components/account/*`, `components/storefront/*` |
| 3 | **Medium** | Pattern drift | `writeAudit` centralizes impersonation-aware actor formatting; `lib/routes/service.ts` bypasses it and inlines `db.auditLog.create` 4× | `lib/routes/service.ts` vs `lib/audit.ts` |
| 4 | **Medium** | Duplicated logic | "Closest-priced product" reducer implemented twice with different shapes and tie-breaking | `lib/repeat.ts` vs `lib/legacy-import/commit.ts` |
| 5 | **Low** | Type/schema drift | Two distinct `CommitResult` types exported from the same `lib/` tree | `lib/imports.ts` vs `lib/legacy-import/commit.ts` |
| 6 | **Low** | Inconsistent patterns | Conditional className built two ways in the same app: `cn()` helper vs template-literal ternary | `components/account/auth-forms.tsx` vs `components/admin/email-hub.tsx` |
| 7 | **Low** | Duplicated UI | Tab-list header pattern hand-rolled twice with different styling | `auth-forms.tsx`, `email-hub.tsx` |
| 8 | **Low** | Duplicated UI | Admin page header snippet (`<h1 className="text-2xl font-semibold mb-1">` + subtitle) repeated across 6 pages | `app/(admin)/admin/**/page.tsx` |
| 9 | **Info** | God files | Largest file 475 lines — under the 500-line split threshold; `lib/routes/service.ts` mixes route lifecycle + package method-switch (adjacent concerns, one file) | `lib/routes/service.ts` |
| 10 | **Info** | Naming | No banned vague names (`data`/`result`/`info`/`temp`/`val`/`item`/`thing`) found as standalone identifiers; no swallowed catch blocks | tree-wide |

## Findings

### 1. `adminHandler` exists but is barely adopted (High — pattern drift)

`lib/api/admin-handler.ts` (68 lines) is explicitly documented as the kill-the-boilerplate helper:

```1:9:lib/api/admin-handler.ts
// Shared admin route-handler plumbing: permission gate → open-season 409 →
// body parse 400 → ActionError mapping. Every admin POST/PATCH/GET repeated
// this verbatim; handlers now declare only what varies.
```

But it is imported by only **11** route files — almost all under `app/api/admin/routes/**` and `app/api/admin/packages/**` plus a handful of others. The remaining ~40 admin handlers still hand-roll the exact sequence the helper centralizes. Example, `app/api/admin/packages/[id]/stage/route.ts`:

```12:23:app/api/admin/packages/[id]/stage/route.ts
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const parsed = stageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });
```

Then the `try / catch (error instanceof ActionError)` block at the bottom. The same six-step skeleton repeats in `app/api/admin/orders/[id]/refund/route.ts`, `app/api/admin/seasons/route.ts`, and dozens of siblings. The abstraction was introduced and then not rolled out — the codebase now carries both the helper and the boilerplate it was meant to delete, which is worse than either alone (a reader has to know two patterns).

### 2. `apiFetch` is the documented single convention, but customer forms duplicate it (Medium — pattern drift)

`lib/api-client.ts` carries the same "one place" comment:

```1:3:lib/api-client.ts
// Shared fetch + error extraction for admin client components. Every staff API
// returns `{ error }` on failure; this is the ONE place that convention is read.
```

It is used by ~25 admin components, but the customer-facing forms bypass it and re-implement the identical fetch + JSON headers + `body?.error ?? "Something went wrong"` shape. `components/account/auth-forms.tsx`:

```28:39:components/account/auth-forms.tsx
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setIsSubmitting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrorMessage(body?.error ?? "Something went wrong");
      return;
    }
    const body = await response.json().catch(() => null);
```

The same block appears in `components/account/verify-email-form.tsx` (the new self-fix file) and, with minor variation, in `profile-form.tsx`, `addresses-manager.tsx`, `preferences-form.tsx`, `newsletter-signup.tsx`, and `setup-form.tsx`. The error string `"Something went wrong"` is duplicated verbatim across these files instead of living in the one helper. The self-fix added a new form (`verify-email-form.tsx`) that *copied* the boilerplate rather than routing through `apiFetch` — the drift was reproduced by the fix itself.

### 3. `lib/routes/service.ts` bypasses `writeAudit` (Medium — pattern drift)

`writeAudit` (`lib/audit.ts`) is the central audit writer — it derives the actor email with impersonation formatting (`"real@x (impersonating acting@y)"`) and is called from ~50 sites. `lib/routes/service.ts` inlines `db.auditLog.create` four times instead:

```213:221:lib/routes/service.ts
    await tx.auditLog.create({
      data: {
        actorEmail: by.kind === "link" ? `route-link:${by.linkId}` : by.staffEmail,
        action: "route.stop.delivered",
        targetType: "Package",
        targetId: stop.packageId,
        detail: { routeId, stopId: stop.id, linkId: by.kind === "link" ? by.linkId : undefined },
      },
    });
```

The magic-link branch legitimately can't use `writeAudit` (no `StaffContext`). But the staff branches (`route.started`, `package.method_switched`, `route.rerouted_package`) pass a raw `staff.email` and so lose the impersonation annotation that every other audited staff action gets. A manager impersonating another staff member who starts a route is recorded without the `(impersonating …)` tag the rest of the audit log carries — inconsistent audit shape for the same role.

### 4. "Closest-priced product" reducer implemented twice (Medium — duplicated logic)

Both call sites find the product whose `basePriceCents` is nearest a target. `lib/repeat.ts` exposes it as a named, tie-aware function:

```67:84:lib/repeat.ts
export function closestPricedProduct(
  targetCents: number,
  candidates: RepeatCandidate[]
): RepeatCandidate | null {
  let best: RepeatCandidate | null = null;
  for (const candidate of candidates) {
    if (!best) {
      best = candidate;
      continue;
    }
    const bestDiff = Math.abs(best.basePriceCents - targetCents);
    const diff = Math.abs(candidate.basePriceCents - targetCents);
    if (diff < bestDiff || (diff === bestDiff && candidate.basePriceCents < best.basePriceCents)) {
      best = candidate;
    }
  }
  return best;
}
```

`lib/legacy-import/commit.ts` re-derives the same idea as an inline closure with different behavior (returns `.id` only, no tie-break — ties fall to `reduce`'s first-wins):

```87:92:lib/legacy-import/commit.ts
        const closestActive = (priceCents: number) =>
          activeProducts.length === 0
            ? null
            : activeProducts.reduce((best, candidate) =>
                Math.abs(candidate.basePriceCents - priceCents) < Math.abs(best.basePriceCents - priceCents) ? candidate : best
              ).id;
```

Same domain intent ("closest active product by price"), two implementations, two tie rules. The repeat version is the more complete one; the commit version could call it and read `.id`.

### 5. Two `CommitResult` types in the same `lib/` tree (Low — type/schema drift)

`lib/imports.ts` exports:

```112:114:lib/imports.ts
export type CommitResult =
  | { ok: true; created: number; skippedDuplicates: number }
  | { ok: false; error: string; invalidLines?: number[] };
```

`lib/legacy-import/commit.ts` exports a different shape under the same name:

```15:19:lib/legacy-import/commit.ts
export type CommitResult = {
  runId: string;
  completedStages: { stage: string; counts: Record<string, number>; skipped: boolean }[];
  status: "COMPLETED" | "COMMITTING";
};
```

Both are `lib`-level exports named `CommitResult`. A caller importing from the wrong path gets a silently wrong shape. Distinct features (staged CSV import vs legacy migration), but the name collision is an unnecessary trap — rename one (e.g. `LegacyCommitResult` / `StagedCommitResult`).

### 6. Conditional className built two ways (Low — inconsistent patterns)

`components/account/auth-forms.tsx` imports `cn` from `@/lib/cn` and uses it for its tab styling:

```69:72:components/account/auth-forms.tsx
            className={cn(
              "flex-1 rounded px-2 py-1.5 text-xs font-medium",
              tab === candidate.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
            )}
```

`components/admin/email-hub.tsx` does the same kind of conditional with a template-literal ternary and no `cn`:

```34:36:components/admin/email-hub.tsx
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${
              tab === tabName ? "border border-b-0 border-border bg-surface text-brand-strong" : "text-muted hover:text-foreground"
            }`}
```

The clean-code rule calls for one styling approach per project. `cn` exists for exactly this; the email hub (and a few other admin components) skip it. Minor, but it's the kind of drift that compounds.

### 7. Tab-list pattern hand-rolled twice (Low — duplicated UI)

The tab-list container (`role="tablist"` + mapped buttons with `aria-selected` + per-tab conditional styling) appears in `auth-forms.tsx` (2 tabs) and `email-hub.tsx` (4 tabs) with different markup and styling. Two call sites is the Rule-of-2 floor, but the shapes diverge enough that a shared `<Tabs items=…>` would absorb the role/aria/conditional-class logic and leave only the labels. Borderline — leaving it duplicated is defensible if the two tab UIs are expected to stay visually distinct.

### 8. Admin page header snippet repeated 6× (Low — duplicated UI)

The exact `<h1 className="text-2xl font-semibold mb-1">` + `<p className="text-sm text-muted mb-6">` subtitle block appears in 6 admin pages (`help`, `exports`, `page`, `test-console`, `import`, `reports`). A `<PageHeader title subtitle>` would be a 5-line component used 6 times — roughly break-even on lines, positive on consistency. Borderline; stable enough to leave per the "if removing duplication adds more lines than it saves" rule, but the subtitle class is the kind of token that drifts per-page over time.

### 9. No god files (Info)

Largest files by line count:

| Lines | File |
|---|---|
| 475 | `lib/routes/service.ts` |
| 350 | `lib/repeat.ts` |
| 339 | `components/admin/email-hub.tsx` |
| 319 | `components/checkout/checkout-form.tsx` |
| 316 | `lib/legacy-import/plan.ts` |
| 309 | `components/admin/catalog-manager.tsx` |
| 308 | `app/(admin)/admin/orders/[id]/page.tsx` |
| 299 | `components/admin/package-board.tsx` |
| 298 | `app/api/webhooks/stripe/route.ts` |
| 298 | `lib/shipping/labels.ts` |

None exceed 500. `lib/routes/service.ts` (475) bundles five route-lifecycle operations plus `switchPackageMethod` (a package-level concern) under one file. The header comment scopes the file to "delivery route lifecycle," but `switchPackageMethod` is invoked from `confirmReroute` and from the package board — it's a package operation living in the routes file. A split (`routes/service.ts` for build/start/deliver/reroute, `packages/method-switch.ts` for `switchPackageMethod`) would separate the two concerns before the file crosses 500. Not a god file today; the seam is visible.

### 10. Naming / error handling clean (Info)

No banned vague names (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) found as standalone identifiers in `lib/`. No empty `catch` blocks anywhere in the tree. `ActionError` messages consistently state what went wrong and the expected state (e.g. `"Only an active label can be voided"`, `"This package sits on a delivery route — remove the stop before switching it to shipping"`). Comments are intent-bearing (rule IDs, atomicity notes, retry-safety notes), not narration. This is the strongest aspect of the tree.

## Notes on the self-fix scope

The self-fix touched the legacy-import split and the registration/email-verification flow. Both are clean at the structure level:
- `lib/legacy-import/plan.ts` (pure planning) / `commit.ts` (staged atomic writes) is a textbook concern split, and the four-stage resume loop is well-factored.
- `components/account/verify-email-form.tsx` and `lib/auth/registration-token.ts` are small, named, and scoped.

The self-fix did **not**, however, touch the two drift points it traveled through: the new `verify-email-form.tsx` copied the hand-rolled fetch/error boilerplate (Finding 2) instead of using `apiFetch`, and the registration route handlers (`app/api/account/register/route.ts`, `app/api/account/register/complete/route.ts`) hand-roll the permission/parse/ActionError skeleton instead of going through `adminHandler` (Finding 1, customer-side variant). The fix was correct on the feature logic but reproduced the surrounding pattern drift.

## Overall

The tree is well-named, well-commented, and free of god files and swallowed errors. The residual debt is **adoption debt**, not structural debt: three helpers (`adminHandler`, `apiFetch`, `writeAudit`) were written to be the one place a convention lives, and each is only partially adopted, leaving hand-rolled duplicates — including in code the self-fix just wrote. Closing that gap is mechanical and low-risk; the abstractions already exist.
