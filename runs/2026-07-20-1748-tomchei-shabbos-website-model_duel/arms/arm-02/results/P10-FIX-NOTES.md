# P10 Fix Notes — arm-02 (single fix pass)

**Input:** `arms/arm-02/results/AGGREGATE-REVIEW-P10.md` (1 Blocker, 7 Majors, 21 Minors)
**Tree:** `arms/arm-02/workspace/` · Web 3102 · DB 4102

## Fixed

### B1 (Blocker) — non-transactional cart append / TOCTOU draft creation

New atomic primitive `appendLinesToDraft` in `lib/order-builder/draft-store.ts`; `lib/repeat.ts` `appendToDraft` now routes through it instead of the read-modify-write `findActiveDraft` → merge → `saveDraft`.

- **Existing draft:** optimistic lock — `updateMany` guarded on the `updatedAt` read (`where: { id, status: "ACTIVE", updatedAt }`); a concurrent write matches 0 rows and the loop re-reads the fresh cart and re-merges. No lost lines.
- **No draft, guest/POS owner:** create relies on `@@unique([seasonId, guestTokenHash])`; a P2002 loser loops back into append/skip. Non-ACTIVE hash holders are resurrected with a status-guarded `updateMany`.
- **No draft, customer owner** (no unique constraint): existence check + create ride one SERIALIZABLE transaction; the P2034 loser retries into the append path. No duplicate customer drafts.
- **Bulk skip-check atomic with creation:** `repeatOrderIntoPosDraft` gained `ifDraftExists: "skip"` — the skip decision happens inside the atomic append, not in a separate pre-read. The bulk route keeps a cheap `findActiveDraft` fast-path but correctness lives in the atomic path (also neutralizes minor m14's redundant-lookup complaint). Assignment rules now run on the new lines only, before the lock; address-book writes dedupe per customer so a retry is idempotent.

### M1 — bulk loop failure isolation + audit on partial failure

`app/api/admin/repeat/bulk/route.ts`: each customer iteration is wrapped in try/catch (per-customer draft write already atomic via B1); a failure is recorded in `failedCustomers` instead of 500ing the run, and the `order.repeat.bulk` audit row always lands, with the failure list in `detail`. Response now includes `failedCustomers` count + `failed` array, so a partial run is distinguishable from a completed one.

### M2 — unaudited implicit season close

Both the cron open path (`app/api/cron/season-flip/route.ts`) and the manual open path (`app/api/admin/season-status/route.ts`) now close each displaced OPEN season individually inside the same transaction and write an audit row per closure (`season.autoflip.close` / `season.status` with `displacedBy`). The cron's `closed` array no longer undercounts (smoke shows `closed:["Purim 2026"]` where it was `[]` before).

### M3 — catalog fetch hoisted across the bulk loop

New `loadRepeatCatalog()` in `lib/repeat.ts`; `buildRepeatPlan` accepts an optional preloaded catalog. The bulk route fetches the catalog once per run and passes it through `repeatOrderIntoPosDraft` — a 200-customer run is now 1 full-catalog scan instead of 200. Chain walk + price-smart candidates share the same map as before.

### M4 — competing HTTP clients

`components/admin/catalog-manager.tsx`: local `requestJson` deleted; all nine call sites (products/add-ons CRUD, replacement picker, season reload GETs) now use the shared `apiFetch` from `lib/api-client.ts`, with `act()` typed on `ApiResult`.

## Not fixed (one pass, correctness-first per brief)

- M5 (shared date helpers), M6 (`buildRepeatPlan` line-map split), M7 (`seasons` POST god handler split) — pure refactors, deferred.
- Minors m1–m21 untouched, except m14 (redundant bulk lookup) which the B1 design addresses.

## Verification

- `npm run ci` — PASS: lint, typecheck, migration guard, **71/71 tests** (`.scratch/p10-fix-ci-output.log`).
- Re-smoke S1–S3 per `shared/phases/PHASE-P10-EXPECTED.md` — **22/22 PASS** (`.scratch/PHASE-P10-SMOKE.md`, rerun 2026-07-21; log `.scratch/p10-fix-smoke-output.log`).
- B1 concurrency proof (`.scratch/p10-fix-b1-concurrency.ts`, output `.scratch/p10-fix-b1-output.log`) — **7/7 PASS**:
  - 5 concurrent `/api/repeat` confirms → 5/5 succeed, exactly 1 ACTIVE draft, all 5 lines present (no lost lines, no duplicate drafts).
  - 2 concurrent bulk runs → both 200, customer drafted exactly once across runs, exactly 1 POS draft row with exactly the order's lines.

## Blockers remaining

None. B1 fixed and proven under concurrency; M1–M4 fixed; M5–M7 deferred as refactor-only majors.
