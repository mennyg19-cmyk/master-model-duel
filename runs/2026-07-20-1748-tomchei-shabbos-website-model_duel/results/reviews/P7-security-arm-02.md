# P7 Security Review — arm-02 (blind)

**Phase:** P7 — Package engine live (grouping UI, statuses, print batches, cards)
**Scope:** `arms/arm-02/workspace/` files touched in P7: package board UI, split/regroup/stage/bulk-stage APIs, print-batch + print-artifact APIs, PDF renderer, schema/migration.
**Method:** Findings only — no fixes. Trust boundaries, auth, secrets, IDOR, injection.
**Reviewer model:** blind.

## Summary

Auth gates are present on every route (`requirePermissionApi` / `requirePermissionPage` with `fulfillment.manage` or `orders.view`), and version-guarded stage transitions are correct. The PDF text writer correctly escapes `(`, `)`, `\` and substitutes non-Latin-1 — no PDF stream injection. The main gaps are **missing season scoping** on the package-mutation APIs and the print-artifact model, plus a non-idempotent reprint path.

## Findings

### H-1 — `regroupPackages` can merge packages across seasons (integrity)
`lib/packages/actions.ts:141` (`regroupPackages`) loads packages by `id` only (`tx.package.findMany({ where: { id: { in: ids } } })`) with no `seasonId` filter. The matching key (`packageGroupingKey`) is recipient + address + method + greeting — **not** season. A staff member with `fulfillment.manage` who knows package CUIDs from a prior (still-`NEW`) season can pass both seasons' IDs in one call; the oldest package becomes the merge target and the other season's `OrderLine` rows are re-pointed to a package in a different season. Cross-season data corruption; audit rows are written but the line→package→season invariant is broken.

### M-1 — Split / stage / bulk-stage APIs are not scoped to the open season
`app/api/admin/packages/[id]/split/route.ts`, `.../[id]/stage/route.ts`, `.../bulk-stage/route.ts` operate on any package ID with no `seasonId` constraint. `splitPackage` and `advancePackageStage` look up by `id` alone; the `bulk-stage` `ids` branch loops over caller-supplied IDs. The board only lists the open season, but the API accepts CUIDs from any season, so a `fulfillment.manage` staff member can split or advance a past season's packages. `getOpenSeason()` is checked only on the print-batch and `bulk-stage` `methodId` paths — inconsistent. IDOR / missing least-privilege boundary.

### M-2 — `PrintArtifact` / `PrintBatch` carry no `seasonId`; download is unscoped
`prisma/migrations/20260720233353_p7_print_batches/migration.sql` and `prisma/schema.prisma:460` define `PrintBatch`/`PrintArtifact` with no `seasonId` column or FK. `app/api/admin/print-artifacts/[id]/route.ts` fetches `db.printArtifact.findUnique({ where: { id } })` and streams the PDF — any artifact ever generated is downloadable by any `fulfillment.manage` staff member by CUID, with no way to scope to the current season. The fulfillment dashboard (`app/(admin)/admin/fulfillment/page.tsx:26`) likewise lists `db.printArtifact.findMany({ ... take: 30 })` with **no season filter**, leaking artifact metadata (filing group, kind, runKey, createdAt) across all seasons.

### M-3 — Reprint batches are non-idempotent and unthrottled (resource exhaustion)
`lib/print/batches.ts:206` and `:233` build `runKey` from `Date.now()` for `REPRINT_GROUP` and `REPRINT_ORDER`, so each click creates a fresh `PrintBatch` + artifact rows. `app/api/admin/print-batches/route.ts` has no rate limit or per-actor throttle. An authenticated `fulfillment.manage` user (or a stuck client retry loop) can generate unbounded batches, growing `PrintBatch`/`PrintArtifact` tables and the audit log indefinitely. Only the `nightly` action is idempotent (date-based `runKey`).

### L-1 — Packing-slip endpoint does not enforce `FINALIZED`
`app/api/admin/orders/[id]/packing-slip/route.ts` gates on `orders.view` and calls `buildOrderPackingSlip(id)`, which (`lib/print/batches.ts:144`) only checks the order exists and has packages — it never asserts `order.status === "FINALIZED"`. Packages are expected to materialize only on finalize, so today this is defence-in-depth, but the API would happily render a slip for any order that ever acquires packages.

### L-2 — `Content-Disposition` filename built from `draftReference` without sanitization
`app/api/admin/orders/[id]/packing-slip/route.ts:18` sets `filename="packing-slip-${payload.orderRef.replace("#", "")}.pdf"`. `orderRef` is `#<orderNumber>` (numeric, safe) or `draftReference`. Only `#` is stripped; `"` and CRLF are not. If `draftReference` is ever user-influenced or non-CUID, this is a header-injection vector. `print-artifacts/[id]/route.ts:15` sanitises its filename correctly (`[^a-z0-9-]` → `-`) — the packing-slip path does not.

### I-1 — PDF writer silently substitutes `?` for non-Latin-1 characters
`lib/pdf.ts:26` (`escapePdfText`) replaces any code point outside 32–255 with `?`. This is safe against PDF stream injection but means recipient names, addresses, or greetings containing non-Latin-1 characters are silently corrupted on the printed artifact. Data-fidelity issue, not a security bypass.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 2 |
| Informational | 1 |
| **Total** | **7** |

## Notes

- Session cookie is `httpOnly; sameSite=lax; secure` in prod (`lib/auth/session.ts:25`), so CSRF on the JSON `POST` route handlers is mitigated by SameSite=Lax; no CSRF-token gap observed for P7 routes.
- All DB access is via Prisma parameterised queries — no raw SQL, no SQL-injection surface.
- `canAdvancePackage` correctly rejects backward moves and `SENT`/`PICKED_UP` mismatches per channel kind; `advancePackageStage`'s conditional `updateMany where { id, version }` is a correct optimistic-lock guard.
- Audit rows are written for every mutation; the `bulk-stage` `ids`-branch audit is outside the per-item transactions (non-atomic) but this is an integrity-of-log concern, not a security boundary.
