# P12 Clean-code review — arm-06

**Phase:** P12 (reports / exports / reconcile / import / testops libs + admin UI)
**Reviewer specialist:** Clean-code (blind — no model names)
**Rules consulted:** `arms/arm-06/.cursor/rules/clean-code.mdc`, `vocabulary.mdc`; `kit/prompts/reviewer/review-clean-code.md`; `shared/phases/PHASE-P12-EXPECTED.md`
**Scope:** findings only — no fixes.

## Files reviewed

**Lib (`lib/`):**
- `lib/reports/margin.ts`, `lib/reports/seasons.ts`
- `lib/exports/datasets.ts`
- `lib/reconcile/matcher.ts`
- `lib/imports/engine.ts`, `lib/imports/kinds.ts`, `lib/imports/products.ts`, `lib/imports/customers.ts`
- `lib/imports/legacy/normalize.ts`, `lib/imports/legacy/seasons.ts`, `lib/imports/legacy/customers.ts`, `lib/imports/legacy/products.ts`, `lib/imports/legacy/orders.ts`, `lib/imports/legacy/cleanup.ts`
- `lib/testops/baseline-seed.ts`, `lib/testops/guard.ts`, `lib/testops/actions.ts`
- Supporting: `lib/audit.ts`, `lib/csv.ts`, `lib/money.ts`, `lib/cron-route.ts`

**API routes (`app/api/`):**
- `app/api/admin/imports/route.ts`, `[batchId]/route.ts`, `[batchId]/commit/route.ts`, `[batchId]/discard/route.ts`
- `app/api/admin/export/[dataset]/route.ts`
- `app/api/admin/reconciliation/run/route.ts`
- `app/api/admin/test-ops/route.ts`
- `app/api/cron/reconcile-stripe/route.ts`
- `app/api/dev/stripe-fixture/route.ts`, `store.ts`, `[...tail]/route.ts`
- `app/api/dev/outbox/route.ts`

**Admin UI (`app/(admin)/admin/`):**
- `reports/page.tsx`, `export/page.tsx`, `reconciliation/page.tsx`, `reconciliation/run-button.tsx`
- `imports/page.tsx`, `imports/import-upload.tsx`, `imports/[batchId]/page.tsx`, `imports/[batchId]/import-preview.tsx`
- `test-ops/page.tsx`, `test-ops/test-ops-console.tsx`
- `components/test-mode-banner.tsx`

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 6 |
| Minor | 6 |
| **Total** | **12** |

No blockers. The P12 surface is internally coherent and the import engine (stage/preview/commit/discard) is well-factored. The findings are mostly cross-module duplication that the Rule of 2 says should be centralized, plus one auth-pattern drift on the export route.

---

## Major

### M1 — Auth pattern drift on the export route
**File:** `app/api/admin/export/[dataset]/route.ts`

Every other P12 admin route (`imports/route.ts`, `imports/[batchId]/{route,commit,discard}.ts`, `test-ops/route.ts`, `reconciliation/run/route.ts`) uses `requireApiPermission(perm)` → `{ ok, response, ctx }` and passes `gate.ctx` to `recordAudit`. The export route is the only one that drops to `getAuthContext()` + `hasPermission()` and then hand-builds the audit context inline:

```19:22:app/api/admin/export/[dataset]/route.ts
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "NotAuthenticated" }, { status: 401 });
  if (!hasPermission(ctx.staff, dataset.permission)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

```54:60:app/api/admin/export/[dataset]/route.ts
      await recordAudit({
        ctx: { staff: { id: ctx.staff.id, email: ctx.staff.email }, impersonator: ctx.impersonator ? { id: ctx.impersonator.id, email: ctx.impersonator.email } : null },
        action: "export_csv",
```

The hand-built `ctx` object duplicates the shape `AuditContextLike` already guarantees via `gate.ctx`. Clean-code rule "one auth pattern per project" is violated. The export route should use `requireApiPermission(dataset.permission)` like its siblings — the dataset's `permission` field is already declared for exactly this.

### M2 — `KIND_LABEL` duplicated across three import UI files with label drift
**Files:** `app/(admin)/admin/imports/page.tsx`, `app/(admin)/admin/imports/[batchId]/page.tsx`, `app/(admin)/admin/imports/import-upload.tsx`

Three separate `KIND_LABEL: Record<string, string>` declarations for the same five `ImportKind` values. The two page files use bare labels (`"Legacy customers"`); the upload component appends `"(old system)"`:

```13:19:app/(admin)/admin/imports/import-upload.tsx
const KIND_LABEL: Record<Kind, string> = {
  CUSTOMERS: "Customers",
  PRODUCTS: "Products",
  LEGACY_CUSTOMERS: "Legacy customers (old system)",
  LEGACY_PRODUCTS: "Legacy products (old system)",
  LEGACY_ORDERS: "Legacy orders (old system)",
};
```

```11:17:app/(admin)/admin/imports/[batchId]/page.tsx
const KIND_LABEL: Record<string, string> = {
  CUSTOMERS: "Customers",
  PRODUCTS: "Products",
  LEGACY_CUSTOMERS: "Legacy customers",
  LEGACY_PRODUCTS: "Legacy products",
  LEGACY_ORDERS: "Legacy orders",
};
```

Three real call sites, identical domain enum — Rule of 2 clearly satisfied. The `"(old system)"` suffix is a display concern of the upload form, not a different label. Should be one exported map next to `IMPORT_PERMISSION` / `IMPORT_HANDLERS` in `lib/imports/kinds.ts`, with the upload's suffix applied at the call site if desired.

### M3 — `slugify(year, name)` duplicated in two legacy import handlers under different names
**Files:** `lib/imports/legacy/products.ts`, `lib/imports/legacy/orders.ts`

```21:23:lib/imports/legacy/products.ts
function slugify(year: number, name: string): string {
  return `legacy-${year}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
```

```157:159:lib/imports/legacy/orders.ts
function stubSlug(year: number, productName: string): string {
  return `legacy-${year}-${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
```

Byte-identical bodies, two different names. The naming drift is the symptom of the duplication. `lib/imports/legacy/normalize.ts` already exists as the shared legacy-normalization module — the helper belongs there.

### M4 — `EMAIL_SHAPE` regex duplicated across customer import handlers
**Files:** `lib/imports/customers.ts`, `lib/imports/legacy/customers.ts`

```9:9:lib/imports/customers.ts
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

```16:16:lib/imports/legacy/customers.ts
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

Identical regex, two call sites. `normalizeEmail` already lives in `lib/text.ts`; the shape check should sit beside it (or be folded into a single `isValidEmail` helper) so the validation rule has one home.

### M5 — Customer "email vs phone mismatch" resolution rule duplicated
**Files:** `lib/imports/legacy/customers.ts` (`commitLegacyCustomerRows`), `lib/imports/legacy/orders.ts` (`resolveCustomer`)

Both implement the same domain invariant: look up by email, look up by phone, if both hit *different* existing customers → reject with a "merge those customers first" error; otherwise pick `byEmail ?? byPhone` and create if missing. The error string is identical:

```110:116:lib/imports/legacy/customers.ts
    const byEmail = data.email ? await tx.customer.findUnique({ where: { email: data.email } }) : null;
    const byPhone = data.normalizedPhone ? await tx.customer.findUnique({ where: { normalizedPhone: data.normalizedPhone } }) : null;
    if (byEmail && byPhone && byEmail.id !== byPhone.id) {
      row.verdict = "invalid";
      row.reason = `email matches "${byEmail.name}" but phone matches "${byPhone.name}" — merge those customers first`;
      continue;
    }
```

```138:142:lib/imports/legacy/orders.ts
  const byEmail = head.email ? await tx.customer.findUnique({ where: { email: head.email } }) : null;
  const byPhone = head.normalizedPhone ? await tx.customer.findUnique({ where: { normalizedPhone: head.normalizedPhone } }) : null;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    return { error: `email matches "${byEmail.name}" but phone matches "${byPhone.name}" — merge those customers first` };
  }
```

This is a non-trivial domain rule (the "never guess a merge" law from G-029) expressed twice. The customers handler additionally does address-book work on top, but the resolution core — lookup, mismatch check, pick-or-create — should be one `resolveLegacyCustomer(tx, head)` helper used by both. The legacy-phone synthetic email (`legacy-phone-…@legacy.local`) is also duplicated in both create branches.

### M6 — Money-parsing drift across import handlers
**Files:** `lib/imports/products.ts`, `lib/imports/legacy/products.ts`, `lib/imports/legacy/orders.ts`

Three different string→cents paths in the import libs:

- `lib/imports/products.ts` uses `dollarsToCents` from `lib/money.ts` — rejects fractional cents.
- `lib/imports/legacy/products.ts` uses `Math.round(price * 100)` inline — silently rounds fractional cents.
- `lib/imports/legacy/orders.ts` defines a local `parseMoney` that strips `$` and rounds — silently rounds fractional cents.

```53:60:lib/imports/legacy/orders.ts
function parseMoney(raw: string, column: string): number | { error: string } {
  const cleaned = raw.trim().replace(/^\$/, "");
  const value = Number(cleaned);
  if (cleaned === "" || !Number.isFinite(value) || value < 0) {
    return { error: `${column} must be a non-negative number (got "${raw}")` };
  }
  return Math.round(value * 100);
}
```

The legacy paths are deliberately looser for messy exports, but the choice is implicit. The local `parseMoney` (orders) and the inline `Math.round` (legacy products) are functionally the same. One legacy-money helper with the "looser than `dollarsToCents` on purpose" intent called out once would remove the drift and the local re-implementation.

---

## Minor

### m1 — `CHANNEL_LABEL` duplicated between export lib and reports page
**Files:** `lib/exports/datasets.ts`, `app/(admin)/admin/reports/page.tsx`

```47:52:lib/exports/datasets.ts
const CHANNEL_LABEL: Record<string, string> = {
  PICKUP: "Pickup",
  BULK_DELIVERY: "Bulk delivery",
  PER_PACKAGE_DELIVERY: "Per-package delivery",
  SHIPPED: "Shipped",
};
```

```13:18:app/(admin)/admin/reports/page.tsx
const CHANNEL_LABEL: Record<string, string> = {
  PICKUP: "Pickup",
  BULK_DELIVERY: "Bulk delivery",
  PER_PACKAGE_DELIVERY: "Per-package delivery",
  SHIPPED: "Shipped",
};
```

Identical content, two call sites. Should be one shared constant (the fulfillment-channel enum already exists in Prisma; a label map beside it is the natural home).

### m2 — `markProductDuplicates` name collision across two import handlers
**Files:** `lib/imports/products.ts`, `lib/imports/legacy/products.ts`

Both define a function named `markProductDuplicates` (locally scoped, not exported, so no compile error). The two implementations differ in shape — the non-legacy one marks per-row with `"a product already uses this slug"`; the legacy one uses a `Set` and a different reason template referencing `legacySeasonName(year)`. The identical name for two different dedupe strategies is confusing on read. Rename the legacy one to `markLegacyProductDuplicates`, or extract the shared "query existing slugs, mark rows whose slug is taken" shape.

### m3 — `recordAudit` inside the stream `start` callback has a subtle failure mode
**File:** `app/api/admin/export/[dataset]/route.ts`

```43:62:app/api/admin/export/[dataset]/route.ts
    async start(controller) {
      controller.enqueue(encoder.encode(toCsv([dataset.header])));
      try {
        for await (const row of dataset.rows({ seasonId })) {
          rowCount += 1;
          controller.enqueue(encoder.encode(toCsv([row])));
        }
      } catch (error) {
        controller.error(error);
        throw error;
      }
      await recordAudit({...});
      controller.close();
    },
```

The intent ("audit only on completed download") is correct. But if `recordAudit` throws (DB blip), the stream errors *after* rows were already sent — the client sees a truncated download with no audit trail, rather than a clean failure. A try/catch around `recordAudit` that logs without killing the stream, or a comment noting the trade-off, would make the choice explicit. (Minor — `recordAudit` is simple and unlikely to throw in practice.)

### m4 — `seasonPerformanceRows` private wrapper adds nothing
**File:** `lib/reports/seasons.ts`

```37:86:lib/reports/seasons.ts
async function seasonPerformanceRows(seasonIds?: string[]): Promise<SeasonPerformance[]> {
  ...
}

export async function getSeasonPerformance(seasonIds?: string[]): Promise<SeasonPerformance[]> {
  return seasonPerformanceRows(seasonIds);
}
```

The private function has exactly one caller (the export). The indirection does no work — inline the body into `getSeasonPerformance` or drop the wrapper.

### m5 — `IMPORT_ROW_LIMIT` (2000) not surfaced to the upload UI
**Files:** `lib/imports/engine.ts` (exports `IMPORT_ROW_LIMIT = 2000`), `app/(admin)/admin/imports/import-upload.tsx`

The limit is enforced server-side in `stageImport` and surfaced only after the POST fails. The upload component already lists `KIND_COLUMNS` per kind; the row cap is a sibling piece of information the user discovers too late. Not a clean-code violation per se, but the constant's reach ends at the server boundary — the UI that owns "tell the user what to expect" doesn't know it. (Minor — out of strict clean-code scope, but the kind of gap the constant's placement invites.)

### m6 — `WIPE_TABLES` / `CLEAR_TABLES` are untyped string lists for destructive operations
**File:** `lib/testops/actions.ts`

```15:67:lib/testops/actions.ts
const WIPE_TABLES = [
  "reconciliation_findings",
  ...
  "settings",
];
```

Both are `string[]`. A typo in a table name would silently TRUNCATE the wrong table (or no-op) and only surface at runtime. These are destructive operations; a `as const` tuple plus a check against Prisma's known `@@map` names (or a typed model-name union) would catch drift at compile time. (Minor — the list is small and stable, but the failure mode is silent and the operations are irreversible.)
