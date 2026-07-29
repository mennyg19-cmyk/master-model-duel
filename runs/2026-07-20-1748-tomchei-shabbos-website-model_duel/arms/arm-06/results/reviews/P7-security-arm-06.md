# P7 Security Review — arm-06 (blind)

**Phase:** P7 — Package engine live (board, print batches, greeting cards)
**Scope:** `arms/arm-06/workspace/` P7 diff (new routes under `app/api/admin/packages/**`, `app/api/admin/fulfillment/**`, `app/api/cron/nightly-print`; new `lib/packages/**`, `lib/print/pdf.ts`; schema + permissions + audit + state-machine changes).
**Method:** Findings only, no fixes. Trust boundaries: session-auth admin API (`fulfillment.manage`), cron bearer secret, persisted print-batch data, PDF download headers.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 3 |

Auth is consistent: every admin route gates on `requireApiPermission("fulfillment.manage")`; server pages gate on `requirePermission("fulfillment.manage")`; the cron route gates on a `CRON_SECRET` bearer. Zod validates every body. Prisma parameterizes every query (no SQL injection). Optimistic versioning guards split/regroup/advance. Audit rows are written for all staff-initiated mutations, with the impersonator resolved correctly by `recordAudit`. CSRF is mitigated by `parseBody` requiring `application/json` (`request.json()`). The four findings below are input-validation and consistency gaps, not boundary breaches.

## Findings

### M1 — Major — Reprint `filingGroup` is unvalidated and flows into a PDF header

`app/api/admin/fulfillment/print-batches/reprint/route.ts` accepts `filingGroup: z.string().min(1).optional()`. The value is not constrained to the channel enum (`PICKUP` / `BULK_DELIVERY` / `PER_PACKAGE_DELIVERY`) that the nightly batch derives via `filingGroupForChannel`. It is written verbatim into `PrintBatch.filingGroup` (`lib/packages/print-batches.ts:170`) and, on the PDF route (`app/api/admin/fulfillment/print-batches/[batchId]/pdf/route.ts:26`), interpolated into the `Content-Disposition` filename:

```
content-disposition: `inline; filename="${data.filingGroup.toLowerCase()}-${artifact}-${batchId.slice(-8)}.pdf"`
```

Impact:
- A staff member with `fulfillment.manage` can create `PrintBatch` rows with arbitrary `filingGroup` strings (data pollution; the dashboard and package-detail batch lists render them).
- A `filingGroup` containing `"` (or control characters) breaks the quoted filename in the download header. The attacker is already authenticated staff and the body is a PDF they requested, so blast radius is small, but the input crosses a trust boundary into a response header with no sanitization.

The dashboard form only offers the three channel keys, but the API does not enforce that.

### m1 — Minor — Cron bearer compared with non-constant-time `!==`

`app/api/cron/nightly-print/route.ts:14`:

```ts
if (auth !== `Bearer ${env.CRON_SECRET}`) {
```

A direct string compare leaks the secret's length and a byte-by-byte prefix over many timed requests. Use `crypto.timingSafeEqual` over equal-length buffers (after a length check) so the comparison time is independent of the secret's contents.

### m2 — Minor — Cron config check precedes the auth check

`app/api/cron/nightly-print/route.ts:10-16` returns `503 "Cron is not configured — set CRON_SECRET"` before verifying the bearer. An unauthenticated caller can therefore probe whether `CRON_SECRET` is configured on the deployment. Check the bearer first; only then surface the "not configured" state.

### m3 — Minor — Single-package mutations are not season-scoped

`splitPackage` / `regroupPackage` (`lib/packages/moves.ts`) and `advancePackageStage` (`lib/packages/stages.ts`) load the package by `id` alone — no `order: { seasonId }` guard. `runBulkPackageAdvance` (`lib/packages/bulk.ts:40-43`) does scope to the open season. A staff member with `fulfillment.manage` can therefore split/regroup/advance a package from a past season by guessing its `id`, which the board never surfaces. Apply the same season guard the bulk path uses to keep the single-package verbs consistent and prevent cross-season mutations.
