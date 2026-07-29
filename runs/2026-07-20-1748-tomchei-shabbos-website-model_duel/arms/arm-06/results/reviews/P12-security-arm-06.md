# P12 Security Review — arm-06 (blind)

**Phase:** P12 — Reporting, exports, Stripe reconciliation, legacy import, test ops, scale dress rehearsal, help/tours, cron auth.
**Scope reviewed:** `app/api/admin/export/`, `app/api/admin/reconciliation/`, `app/api/cron/reconcile-stripe/`, `app/api/admin/imports/` (+ handlers in `lib/imports/`), `app/api/admin/test-ops/` (+ `lib/testops/`), `app/(admin)/admin/reports/`, `app/(admin)/admin/reconciliation/`, `app/(admin)/admin/imports/`, `app/(admin)/admin/test-ops/`, `app/(admin)/admin/help/`, `app/api/dev/*` fixture doubles, `lib/cron-route.ts`, `lib/cron-auth.ts`, `lib/env.ts`, `lib/env-spec.ts`, `lib/auth.ts`, `lib/permissions.ts`, `middleware.ts`, customer/address merge routes.
**Reviewer:** Security specialist.
**Findings only — no fixes.**

## Summary

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 1 |
| Minor | 2 |
| **Total** | **4** |

The P12 trust boundaries are mostly well-built: cron bearer auth is constant-time and fail-closed on an unset secret; the reconciliation matcher never writes payments; the import engine is staged/atomic with re-checked duplicates inside the commit transaction; CSV values flow only through parameterized Prisma calls (no raw SQL with user input); the address-merge route verifies every keep/drop row belongs to the path customer; dev fixture doubles 404 unless the dev bypass is on; the test-ops route layers manager permission **and** a deployment-class guard. One defect in that deployment-class guard is severe enough to block the phase.

## Blocker

### B1 — `APP_ENV` defaults to `"test"`, fail-opening the destructive test-ops gate

`lib/env-spec.ts:57`:

```57:    schema: z.enum(["test", "production"]).default("test"),
```

`lib/testops/guard.ts` is the entire guard for the destructive test-ops routes (`wipe`, `clear`, `reset` — full-DB `TRUNCATE ... CASCADE`):

```7:export function requireTestEnv(): void {
8:  if (env.APP_ENV !== "test") {
9:    throw new DomainRuleError("Test operations are disabled outside the test environment");
10:  }
11:}
```

`env.APP_ENV` is loaded via `z.enum(["test","production"]).default("test")`. A production deployment that omits `APP_ENV` gets the default `"test"`, so `requireTestEnv()` passes and the wipe/clear/reset endpoints become callable by any manager (`settings.manage`). `runTestOps` then issues `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` against the full domain schema (`lib/testops/actions.ts:111`) — including `orders`, `payments`, `customers`, `seasons`, and `settings`. The test-ops console page (`app/(admin)/admin/test-ops/page.tsx:14`) reads the same default and renders live buttons.

A destructive gate must fail **closed**. The default must be `"production"` so that forgetting to set the env var leaves the destructive routes disabled. As written, the safe path (production) requires an explicit positive action and the dangerous path (test) is what you get for doing nothing — the inverse of safe defaults.

This is the single most important P12 defect: a misconfigured production deploy is one manager click away from a total data wipe.

## Major

### M1 — Dev-auth bypass and dev fixture doubles are guarded solely by `VERCEL_ENV`

`lib/env.ts:32-34`:

```32:const vercelEnv = process.env.VERCEL_ENV;
33:export const isProductionDeploy = vercelEnv === "production";
34:export const isDevAuthBypass = env.DEV_AUTH_BYPASS === "true" && vercelEnv !== "production" && vercelEnv !== "preview";
```

`isDevAuthBypass` keys off `VERCEL_ENV`, a variable Vercel injects. On any non-Vercel host (self-hosted, container, another platform) `VERCEL_ENV` is `undefined`, so `vercelEnv !== "production"` and `vercelEnv !== "preview"` are both `true` and the bypass is active whenever `DEV_AUTH_BYPASS=true`.

When the bypass is active:

- `POST /api/dev-auth` (`app/api/dev-auth/route.ts:17-43`) logs the caller in as **any active staff user by ID**, no password, no rate limit, no second factor — a complete authentication subversion.
- `POST /api/dev/stripe-fixture` accepts arbitrary payment-intent state injection; `POST /api/dev/shippo-fixture` and `GET /api/dev/email-fixture` expose the provider doubles.
- `GET /api/dev/outbox` returns every outbox row.

The merged plan pins hosting to Vercel, so under the stated assumption this is local-dev-only and safe. The risk is the assumption breaking silently: a Docker/preview deploy on another platform, a migration off Vercel, or a CI matrix that runs `next start` without `VERCEL_ENV` all turn `DEV_AUTH_BYPASS=true` into a full auth bypass on a reachable URL. The guard should also fail closed on a platform-agnostic signal (e.g. `NODE_ENV === "production"` or an explicit `IS_DEPLOYED` flag), not a Vercel-only one. Severity is Major rather than Blocker because the plan's Vercel-only assumption currently holds; it becomes a Blocker the moment that assumption changes without re-reviewing this guard.

## Minor

### m1 — Import preview/commit/discard leak batch existence via 404-vs-403 ordering

`app/api/admin/imports/[batchId]/route.ts:10-16` (and the identical pattern in `commit/route.ts:12-18` and `discard/route.ts:12-18`):

```10:  const { batchId } = await params;
11:  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
12:  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
13:
14:  const gate = await requireApiPermission(IMPORT_PERMISSION[batch.kind]);
15:  if (!gate.ok) return gate.response;
```

The batch is fetched before the permission check. A caller without the batch's kind-permission gets `403` for an existing ID and `404` for a non-existent one — an existence oracle across import batches. The batch payload is not returned on the 403, so this is existence-only disclosure; combined with cuid batch IDs the practical risk is low. The permission check should precede the fetch (or the not-found and forbidden branches should return the same status). Same pattern in three routes.

### m2 — Export audit row is written only on stream completion; a mid-stream abort leaves no audit

`app/api/admin/export/[dataset]/route.ts:42-62`:

```42:  const stream = new ReadableStream<Uint8Array>({
43:    async start(controller) {
44:      controller.enqueue(encoder.encode(toCsv([dataset.header])));
45:      try {
46:        for await (const row of dataset.rows({ seasonId })) {
47:          rowCount += 1;
48:          controller.enqueue(encoder.encode(toCsv([row])));
49:        }
50:      } catch (error) {
51:        controller.error(error);
52:        throw error;
53:      }
54:      await recordAudit({ ... action: "export_csv", ... rows: rowCount, filename });
```

`recordAudit` runs only after the row loop finishes and the stream closes cleanly. The comment (lines 11-13) frames this as "an abandoned download leaves no fake success trail" — which is true and desirable — but the same code path also means a caller who reads rows off the stream and then aborts the connection before completion leaves **no audit row at all**, even though PII (customer emails, names, addresses, payment totals) was already transmitted. The export center's audit history (R-092) is therefore bypassable for any partial download. Writing the audit row at start-of-stream (with `rows: null`, updated on completion) or recording on first-byte-sent would close the gap.

## What was checked and found sound

- **Cron auth** (`lib/cron-auth.ts`): constant-time comparison of SHA-256 hashes of both sides; refuses every caller when `CRON_SECRET` is unset (no config-state leak, no length oracle). All eight cron routes go through `cronRoute`.
- **Reconciliation matcher** (`lib/reconcile/matcher.ts`): never writes payments — only flags. Reruns are idempotent (findings keyed by `kind:intentId:orderId`). Cron path passes no actor ctx; the run row and audit row both record `actor: null`, which is correct for an unattended run.
- **Import engine** (`lib/imports/engine.ts`): staged/atomic; duplicates re-checked inside the commit transaction; dry-run batches refuse commit (G-029); `commitRows`/`markDatabaseDuplicates` use parameterized Prisma calls. The `truncateAll` helper in `lib/testops/actions.ts:109-112` uses `$executeRawUnsafe` but the table list is hardcoded constants — no injection surface.
- **CSV parsing** (`lib/csv.ts`): RFC-4180 quoted-field parser; values flow into Prisma `create`/`update`/`upsert` (parameterized). `stubSlug` builds a slug from user input but it is used in a Prisma `where: { slug }` (parameterized), not raw SQL.
- **Address merge IDOR** (`app/api/admin/customers/[customerId]/addresses/merge/route.ts` + `lib/imports/legacy/cleanup.ts`): verifies `keep.customerId === customerId` and every dropped address belongs to the same customer; rejects `keepId ∈ dropIds`; blocks merges of addresses referenced by shipped packages (RESTRICT). No cross-customer merge path.
- **Customer merge (legacy import)**: email/phone pointing at different existing customers is flagged invalid for human resolution — the import never guesses a merge.
- **Export authz** (`app/api/admin/export/[dataset]/route.ts`): each dataset declares a `permission`; route checks `hasPermission` before streaming. `seasonId` from the query string is used in parameterized Prisma queries; the data model has no per-season authz (seasons are org-global), so no IDOR.
- **Reconciliation run button** (`app/api/admin/reconciliation/run/route.ts`): `payments.manage` required. Cron twin uses bearer auth via `cronRoute`.
- **Reports page** (`app/(admin)/admin/reports/page.tsx`): `payments.manage` required; server-rendered read-only ledger.
- **Help/tours** (`app/(admin)/admin/help/page.tsx`): `requireStaff()` only; lives under the admin layout which requires `admin.access` (drivers lack it), so drivers cannot reach it.
- **Test-ops destructive gating** (aside from B1): permission is `settings.manage` (manager-only), audit is recorded, `audit_logs` and `staff_users` survive every wipe action.
- **Import preview payload authz**: GET returns `batch.payload` only after the kind-permission check passes, so a `customers.manage` user cannot read `LEGACY_ORDERS` batch payloads.
- **Import list page** (`app/(admin)/admin/imports/page.tsx`): filters batches by the viewer's permitted kinds server-side; no unfiltered list API.
