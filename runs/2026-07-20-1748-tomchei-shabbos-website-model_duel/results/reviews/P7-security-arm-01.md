# Security review — P7, arm-01 (blind)

**Phase:** P7 — Package engine live: grouping UI, statuses, print batches, cards (`shared/phases/PHASE-P7-EXPECTED.md`)
**Tree:** `arms/arm-01/workspace/`
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 2 |
| Low | 2 |
| Info | 1 |

## Findings

### H1 — Fulfillment page performs bulk write side-effects under `admin:view`
`src/app/(admin)/admin/fulfillment/page.tsx:8-10`, `src/domain/package-operations.ts:94-119`
The `/admin/fulfillment` GET handler calls `materializeMissingFinalizedOrders(db)` before rendering. That function scans up to 200 `FINALIZED` orders with no packages and, inside per-order `$transaction`s, creates `Package` + `PackageLine` + `PackageAudit` rows. The page is gated by `requirePermission("admin:view")`, which `STAFF` holds (`src/lib/permissions.ts:17`). The equivalent mutation surface (`split`/`regroup`/`status`/print) correctly requires `orders:manage` (MANAGER-only), but the materialization write path — which mutates order state and audit for every finalized order in the system — is reachable by a view-only role on a plain GET. This both bypasses the `orders:manage` boundary for an order-mutating operation and violates the "GET must not mutate" contract (a drive-by/reload by a `STAFF` user, or any same-origin GET trigger, performs writes). The function is idempotent per order, so repeated loads only scan, but the first load by any `STAFF` viewer materializes packages system-wide with no manager authorization.

### M1 — `regroupPackages` has no row lock; concurrent regroup/split can corrupt line quantities
`src/domain/package-operations.ts:209-282`
`splitPackage` correctly opens its transaction with `SELECT "id" FROM "Package" ... FOR UPDATE` (`:134-136`) before reading and mutating. `regroupPackages` reads both packages with a plain `findMany` (`:219-223`), then increments target line quantities, deletes/moves source lines, and flips `isActive` with only `version: { increment: 1 }` as a guard — no `FOR UPDATE`, no optimistic-version check on the update. Two concurrent regroups targeting overlapping packages (e.g. X→Y and X→Z, or X→Y and split on X) can both read X's lines, both delete them, and both emit increments — duplicating quantities or resurrecting deleted source lines, with audit rows recording contradictory outcomes. Integrity/TOCTOU on a manager-only path, but the inconsistency is silent (no error thrown) and flows into print batches and stage transitions.

### M2 — Print-artifact PDF download exposes recipient/customer PII under `admin:view`
`src/app/api/admin/print-artifacts/[artifactId]/route.ts:9-27`, `src/domain/print-batches.ts:50-78`
The artifact PDF endpoint gates on `requirePermission("admin:view")`, so `STAFF` (view-only) can download any `PrintArtifact` by id. The rendered payload (`artifactPayload`) embeds recipient name, full address snapshot, greeting snapshot, customer display name, order number, and product/SKU list. The fulfillment page (`fulfillment/page.tsx:32-37`) surfaces the 24 most recent artifact ids as download links, but the route itself has no per-artifact authorization and no scoping — any `admin:view` user fetching any artifact id (e.g. one observed in a URL/log) retrieves PII for arbitrary orders. PII read access here is broader than the role's write scope (`STAFF` cannot mutate orders), and the artifact id is the only capability token.

### L1 — Error responses echo raw `error.message`, enabling existence probing
`src/app/api/admin/packages/actions/route.ts:79-82`, `src/app/api/admin/print-batches/route.ts:53-56`, `src/domain/package-operations.ts:16,137,226`
Mutation routes catch any error and return `error.message` as the body (status 409). `findUniqueOrThrow` (`materializeOrderPackages`, `splitPackage`) and the regroup "same order" check surface Prisma/thrown messages that distinguish "record not found" from "regrouping requires two packages from the same order", letting an authorized user probe whether a given `packageId`/`orderId` exists and whether two ids share an order. Manager-only endpoints, so impact is limited to existence/relationship disclosure within an already-privileged role.

### L2 — Print-artifact route is 404/200 distinguishable; artifact ids enter browser history
`src/app/api/admin/print-artifacts/[artifactId]/route.ts:14-27`, `src/components/fulfillment-board.tsx:308-317`
The GET returns 404 on miss vs. 200 + inline PDF on hit, and the board opens each PDF via `<a target="_blank">` with `content-disposition: inline`, so the artifact id lands in the browser history/referrer of any viewer. `cache-control: private, no-store` is correctly set, and the ids are unguessable (cuid), so this is only a mild token-leakage surface (shared machines, referrer logs) on a `admin:view` path.

### I1 — CSRF continues to rely on JSON content-type preflight, no explicit token
`src/app/api/admin/packages/actions/route.ts`, `src/app/api/admin/print-batches/route.ts`
Both P7 mutation routes are cookie-authenticated POSTs consuming `application/json` with no CSRF token, inheriting the same implicit-preflight protection noted in P6 §I1. The `print-batches` and `packages/actions` bodies are JSON-only, so simple cross-site submission is blocked; the concern remains forward-looking (any future form-accepting or `multipart` route would lose this implicit guard).

## Out of scope (noted, not findings)
- `regroupPackages` not enforcing same recipient/address/method across source and target — business-rule correctness, not a security boundary.
- `renderArtifactPdf` hand-rolled PDF: `escapePdfText` strips non-ASCII and escapes `\()`; content-disposition filename is reduced to `[a-z0-9-]`. No injection vector found in the P7 payload path.
- Print batches never mutate `Package.stage` — satisfies UR-001/G-001–G-004 (printing ≠ shipped). Not a security finding; noted as correct.
- `bulkAdvancePackageStage` server-side cap (`.slice(0,100)`) and `advancePackageStage` transition allow-list + optimistic version guard — correctly enforced.
