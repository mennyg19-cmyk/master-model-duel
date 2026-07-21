# P7 Fix Notes — arm-03

**Engine choice:** Keep live `@/lib/ops/*` (UI + smoke). Deprecate dead `@/lib/packages/*` + `@/lib/print/*` routes (410). Deleted unused `fulfillment-actions.tsx`.

## Blockers fixed

1. **Season scope** — list/detail/dashboard/split/regroup/stage + print list/download/reprint require current `seasonId`.
2. **Reprint/download scoped** — `reprintOrder` / `getPrintArtifact` / `listPrintBatches` filter by season.
3. **Regroup key match** — rejects mismatched recipient/address/method/greeting.
4. **Audit preserved** — donors emptied + retained (no cascade-delete of `PackageAuditLog`).
5. **Split stage** — split-off keeps source stage; `suffixedKey` only (greeting clean).
6. **Method terminals** — PICKUP→PICKED_UP only; else SENT (`assertMethodTerminal`).
7. **Nightly** — `stage: NEW` only (not PRINTED/PACKED backlog).
8. **PDF sizes** — labels `LABEL_4X6`, cards `CARD_5X7`, slips letter via `@/lib/pdf`.
9. **Reprint idempotent** — runKeys use package-stage fingerprint; identical reprint returns existing batch.
10. **`stagesUnchanged` measured** — post-print stage check; `packageStagesForBatch` returned on reprint (capped on huge nightly).

## Smoke

`npm run smoke:p7` → **16/16 PASS** (see `PHASE-P7-SMOKE.md`).
