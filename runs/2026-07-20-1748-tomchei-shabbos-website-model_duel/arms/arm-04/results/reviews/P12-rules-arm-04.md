# P12 Rules Review — arm-04 (blind)

**Phase:** P12 — Reporting, exports, reconciliation, legacy migration, scale hardening, launch readiness
**Arm rules graded:** ponytail, clean-code, workflow, vocabulary, codegraph
**Scope:** `arms/arm-04/workspace/` P12 additions (`prisma/migrations/20260727060000_p12_reporting_migration_launch`, `prisma/schema/{reporting,migration}.prisma`, `src/app/(admin)/admin/{reports,migration}/**`, `src/app/api/admin/exports/[slug]/route.ts`, `src/app/api/cron/payment-reconciliation`, `src/lib/{reports,migration,payments/reconciliation}/**`, `src/app/(admin)/admin/help/page.tsx`, `src/app/(admin)/admin/layout.tsx`, `src/components/admin/nav-items.ts`, `src/lib/help/tours.ts`, `scripts/{smoke-p12,smoke-p12-fixtures,fixtures-scale}.ts`, `tests/{reports,migration}.test.ts`, `docs/LEGACY-ENTITY-MAP.md`, `vercel.json`, `package.json`)
**Method:** Findings only, no fixes. Blind to model name.

## Summary by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 3 |
| Info | 3 |

## Medium

### M1 — `addressProblem` + `STATE_CODE` duplicated across the two migration modules with drifted ZIP validation
`src/lib/migration/legacy-rows.ts:177-188` and `src/lib/migration/address-cleanup.ts:54-55, 257-263`

Two independent definitions of "what makes an address unusable" exist in the same `lib/migration/` directory. `legacy-rows.ts` writes the verdict that goes onto a `LegacyImportRow` (and from there onto `CustomerAddress.needsReview`/`reviewNote`); `address-cleanup.ts` writes the verdict that the cleanup queue later scans for. They are meant to be two stages of the same pipeline — import flags, cleanup re-finds — but they already disagree:

- `legacy-rows.ts:186` rejects anything not matching `^\d{5}$` — a ZIP+4 like `08701-1234` is "The ZIP code is not five digits." and the row goes in carrying `needsReview`.
- `address-cleanup.ts:55` accepts `^\d{5}(-\d{4})?$` — the same address is usable and never re-flagsged.

So a donor with a 5+4 ZIP is flagged on import and silently un-flagged on the next cleanup scan; the queue and the import disagree about the same row. `STATE_CODE` is byte-identical (`/^[A-Z]{2}$/`) in both files, which is the other half of the duplication — two copies of the same constant with no single source of truth. This is exactly the "duplicated logic" + "type/schema drift" pair `clean-code.mdc`'s Refactor categories call out, and the drift is already observable, not hypothetical. A shared `addressProblem(address)` in `lib/migration/` (or `lib/core/addresses.ts`) with one `STATE_CODE` and one `ZIP_CODE` would carry the intent.

**Rules:** clean-code (Refactor categories — duplicated logic; Consistency — one pattern per concern; type/schema drift), ponytail (Rule of 2 met: two real call sites right now).

### M2 — `legacy-import.ts` is a 603-line god file with three separable concerns
`src/lib/migration/legacy-import.ts` (whole file)

`clean-code.mdc`'s God-files rule: "split when >500 lines, mixed concerns, or a refactor command." This file is over the line count and mixes three concerns that have no shared state:

1. **Verdict / matching** (lines 418-548): `readVerdicts`, `findCustomersByName`, `findCustomersByPhone`, `findImportedReferences` — pure read-side, depends only on `db` and `legacy-rows`.
2. **Chunking / counting** (lines 495, 551-580): `NAME_LOOKUP_BATCH`, `assignChunks`, `countVerdicts`, `sourceTotal` — pure functions over the verdict list.
3. **Commit / write** (lines 221-365, 367-416): `commitLegacyImport`, `commitChunk`, `finishRun`, `groupOrders` — the transactional write path, depends on `writePriorYearOrder` and `runInTransaction`.

The dry-run (79-137), map/discard (157-212), and read helpers (139-155) are the only pieces that genuinely span concerns. A split into `legacy-verdicts.ts` (read + match + chunk + count) and `legacy-commit.ts` (commit + chunk-write + finish) would put each new file under 300 lines with a single concern, and the dry-run orchestrator would import both. The file's own header comment ("Three properties, in the order they matter") names the three concerns — the code just hasn't followed its own organisation. `ponytail.mdc`'s God-files clause and `clean-code.mdc`'s split-by-concern rule both trigger.

**Rules:** ponytail (God files — split when >500 lines or mixed concerns), clean-code (Refactor categories — god files; "split files by concern, not by line count").

## Low

### L1 — `Figure` UI component defined locally in three new P12 pages with three prop shapes
`src/app/(admin)/admin/reports/[seasonId]/page.tsx:149-156`, `src/app/(admin)/admin/reports/margin/page.tsx:118-138`, `src/app/(admin)/admin/migration/[runId]/page.tsx:173-195`

Three new `Figure` components ship in P12, each a `<Card><dt/><dd/></Card>` with a different prop set: `[label, value]`, `[label, value, note?, testId?]`, `[label, value, tone?, testId?]`. A fourth copy already exists in `fulfillment/page.tsx` (pre-P12), so the contestant followed the established per-page pattern — and the same P12 phase *did* extract shared UI where reuse was high-value (`reports-tabs.tsx`, `season-picker.tsx`). The leftover `Figure` is the case where the convention itself violates `clean-code.mdc`'s "duplicated UI — extract shared components." Flagging Low rather than Medium because (a) the three variants genuinely differ (`tone` vs `note`, optional `testId`) so a shared component would carry four optional props, and (b) `clean-code.mdc`'s counter-rule "If removing duplication adds more lines than it saves and the code is stable, leave it duplicated" is in play — a shared `Figure` with all optionals is ~15 lines plus three call sites of ~3 lines, against ~30 lines today. Borderline; the inconsistency is the prop shape, not the existence.

**Rules:** clean-code (Refactor categories — duplicated UI; Consistency — one pattern per concern), ponytail (Rule of 2 met across 4 call sites if the pre-existing one is counted; counter-rule on lines saved).

### L2 — `METRIC_ROW_COUNT` declared after the object that uses it
`src/lib/reports/datasets.ts:198` (declaration), `:171` (use)

`METRIC_ROW_COUNT = 13` is declared on line 198, immediately after the `yearMetrics` `ExportDefinition` whose `count` callback returns it on line 171. It works (the const is in scope by the time `count` is called at runtime), but the constant is coupled to the row count of the `yearMetrics.page` array — if someone adds a metric row they must update both the array and the constant, and the 27-line gap hides the coupling. A reader scanning top-down hits the unexplained `13` reference before its definition. Lifting `METRIC_ROW_COUNT` above `yearMetrics` (or deriving it as `yearMetricsRows().length` in the `count` callback) would make the dependency visible.

**Rules:** clean-code (Naming / Consistency — magic value coupled to a sibling structure), ponytail ("boring over clever" — the const is fine, its placement is the only issue).

### L3 — `formatBytes` is a local helper in the exports page next to reused `lib/core` formatters
`src/app/(admin)/admin/reports/exports/page.tsx:111-113`

The page imports `formatDateTime` from `@/lib/core/dates` and `formatCents` from `@/lib/core/money`, then defines `formatBytes` locally for the one byte-count column. Single call site, so `clean-code.mdc`'s Rule of 2 does not mandate extraction — and `ponytail.mdc`'s Rule of 2 says "needs 2+ real call sites right now," so leaving it local is the rule-compliant choice. Flagging only because the page already reaches into `lib/core/*` for the same family of "format a number for display" helpers, so a future second caller (any other screen that shows a file size) would naturally look in `lib/core/` and miss this one. Borderline; the rule as written says leave it.

**Rules:** clean-code (Consistency — one pattern per concern; Rule of 2 says leave it), ponytail (Rule of 2 — single call site, leave duplicated).

## Info

### I1 — `codegraph` adherence not verifiable from artifacts; reuse pattern is consistent with the rule's fallback
No `.codegraph/` directory exists in `arms/arm-04/workspace/`, so `codegraph.mdc`'s fallback ("Read/grep fallback for this run only") applies. The P12 code reuses existing helpers consistently — `recordAudit`, `requirePermission`, `runCronJob`/`runCronJobBody`, `runInTransaction`/`abort`, `formatCents`/`sumCents`/`formatDate`/`formatDateTime`, `normalizeEmail`/`normalizePhone`/`normalizeName`, `parseCsv`/`CSV_MAX_ROWS`, `writePriorYearOrder`/`priorYearContext`, `redirectWithFlash`/`rejectWith`/`trimmedField`, `FlashMessages`, `Card`/`Badge`/`Button`/`Label`/`Select` — rather than reimplementing them. The new modules (`lib/reports/*`, `lib/migration/*`, `lib/payments/reconciliation.ts`) are additive and import from `lib/core`, `lib/db`, `lib/audit`, `lib/imports`, `lib/transaction`, `lib/cron`, `lib/forms` — the existing structure. No competing reimplementations of indexed helpers. The M1 finding (duplicated `addressProblem`) is a *missed* extraction, not a grep-for-symbol violation; the M2 finding (god file) is a *missed* split, not a structural-lookup failure. No structural evidence of a grep-for-symbol violation.

**Rules:** codegraph (unverifiable from artifacts; fallback applied correctly).

### I2 — `vocabulary` and `clean-code` UI Consistency / Dependency Discipline / Anti-Hallucination / Error Handling / Security / Shell / Expectation Files / Tone not flagged
- **vocabulary:** No `refactor`/`tidy`/`rebuild`/`redesign` commands issued mid-phase. The new screens are "add" (new feature, existing patterns); the migration dry-run/commit/discard are domain actions on a run, not vocabulary commands. No finding.
- **clean-code UI Consistency:** All four reports pages and both migration pages reuse `Card`, `CardTitle`, `CardDescription`, `Button`, `Badge`, `Label`, `Select`, `FlashMessages` from the existing library. Header pattern (`text-2xl font-semibold` + `text-sm text-[var(--color-ink-muted)]`) matches every other admin screen. `ReportTabs` mirrors the existing settings/email tabs and says so in its comment. The export download link is a styled `<a>` rather than `<Button>` because it needs the `download` attribute; the class string matches `Button`'s secondary look. No rogue styling. No finding.
- **clean-code Dependency Discipline:** No new packages added for P12 (`package.json` deps unchanged). The CSV writer is hand-rolled in `lib/reports/csv-write.ts` matching the existing hand-rolled reader in `lib/imports/csv.ts` — same ponytail-ladder reasoning ("one input, quoted fields, no edge cases worth a dep"). Streaming uses native `ReadableStream`/`TextEncoder`. `node:crypto` already in use. Versions pinned. No finding.
- **clean-code Anti-Hallucination:** `ReadableStream` + `controller.enqueue`/`close`/`error` match the web Streams API. `TextEncoder.encode` returns `Uint8Array` whose `byteLength` is the right count for `Content-Length`-style accounting. Prisma `groupBy`, `aggregate`, `updateMany` (with the `committedChunkCount: chunkIndex` guard for optimistic claim), `findUniqueOrThrow`, `distinct` all match the current client. `timingSafeEqual` on SHA-256 digests is the existing pattern. `ANALYZE` is valid Postgres. The `csvRow` CRLF join matches RFC 4180. No invented APIs observed. No finding.
- **clean-code Error Handling:** No swallowed errors. `export-service.ts` wraps the stream body in try/catch and calls `controller.error(error)` so a mid-stream failure surfaces. `dryRunLegacyImport` catches `CsvError` specifically and rethrows everything else. `commitChunk` uses `abort(failure(...))` to convert a lost-race into a typed Result. Error messages say what went wrong and the expected state ("That import run is no longer here.", "Somebody else is committing this run.", "Choose which season this history is."). No finding.
- **workflow Security Basics:** `vercel.json` registers all six crons; `payment-reconciliation` goes through `runCronJob`, which refuses every request when `CRON_SECRET` is empty and uses `timingSafeEqual` on SHA-256 digests. The export route checks `requirePermission('reports.view')` — the same permission the export centre page checks — so a guessed URL is worth nothing without it. The smoke test confirms anonymous → 401 and a staff member without the permission → 403 on both the file and the page. CSV formula injection is escaped at the one write point (`csv-write.ts:52-55`). `MAX_UPLOAD_BYTES = 8_000_000` bounds the legacy upload. No secrets hardcoded; `.env.example` carries `CRON_SECRET` with the rotate header. No finding.
- **workflow Shell execution:** No PowerShell written by the contestant in P12 (all `.ts`/`.tsx`/`.sql`/`.md`/`.json`). N/A.
- **workflow Expectation Files:** `.scratch/phase-plan.md` is gitignored and not in the tree; cannot verify the pre-build EXPECTED blocks. The smoke script `scripts/smoke-p12.ts` encodes verifiable expectations per check (S1a–S5g, P12-1–P12-4) and maps them onto the EXPECTED table's S1–S5 in its header, including the plan's own S5d2/S5d3 (ten staff at once, help centre) that the EXPECTED table does not name. No finding from artifacts.
- **workflow Tone / ponytail Anti-slop:** Comments are plain English, no jargon. No sycophancy, no "delve/tapestry/seamless", no em-dash pileups (max 2 per paragraph observed), no tricolon padding, no significance inflation. Every long comment explains a non-obvious constraint (the chunk-resume invariant, the fingerprint idempotency rule, the "file says X / database holds Y" reconciliation, the "spread is what funds the campaign" framing). No finding.
- **clean-code Naming:** No `data`/`result`/`info`/`temp`/`val`/`item`/`thing` as standalone names. `Finding` is declared as a type in both `reconciliation.ts` and `address-cleanup.ts` — same name, both internal to their module, different shapes; not a collision. Function names describe what they do (`readSeasonPerformance`, `readMarginReport`, `repairOrderReference`, `assignChunks`). Boolean fields read as questions (`isFinished`, `needsReview`). No finding.

### I3 — `ORDERS_PER_CHUNK = 5` and `MAX_CHUNKS_PER_COMMIT = 3` are business rules with clear comments but no DECISION-LOG entry
`src/lib/migration/legacy-import.ts:50, 58`

These two constants are domain rules (how big is a safe transaction? how many transactions per request before the platform times out?). Each has a comment that explains the *why* in plain English (the chunk size is "small enough to never hold a lock long"; the commit cap is "in front of the timeout, and the screen offers Continue until it is done"). `workflow.mdc` says "Never silently choose business logic — log in DECISION-LOG.md and flag." No DECISION-LOG is in the P12 tree (gitignored or absent), so this is not verifiable from artifacts — but the constants are exactly the kind of domain decision the rule is written for. Flagging as Info rather than Low because the comments carry the reasoning the DECISION-LOG would carry, and because both numbers are the kind of thing a manager would want to tune in code review rather than at runtime.

**Rules:** workflow (Never silently choose business logic — log in DECISION-LOG.md and flag; unverifiable from artifacts here).
