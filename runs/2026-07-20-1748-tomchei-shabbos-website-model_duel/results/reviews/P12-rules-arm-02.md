# Reviewer specialist — Rules

**Arm:** arm-02
**Tree / phase:** `arms/arm-02/workspace/` — P12 (Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness)
**Arm rules list:** ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
**Output:** `results/reviews/P12-rules-arm-02.md`

Scope: adherence to **this arm's** selected catalog rules only, judged against the P12 diff (new/modified files under `lib/`, `app/api/admin/*`, `app/api/cron/*`, `app/(admin)/admin/*`, `components/admin/*`, `components/test-mode-banner.tsx`, `vercel.json`, `lib/auth/permissions.ts`, `lib/env.ts`, `lib/csv.ts`). Findings only, no fixes. Blind to model name.

## Summary

The P12 build is disciplined: business decisions are logged in `DECISION-LOG.md` (P12-1 through P12-6), expectation files exist (`phase-plan.md`, `PHASE-P12-STATUS.md`, `PHASE-P12-SMOKE.md`), crons are bearer-authed and registered in `vercel.json` with GET aliases, exports stream and audit, the legacy pipeline is dry-run-then-staged-atomic and resumable, and the test console fails closed (404) outside test mode. Most rules are honored. Findings cluster around one god file and two undocumented shortcuts in the legacy importer.

## Findings

### MEDIUM

**M1. `lib/legacy-import.ts` is a 588-line god file with mixed concerns.**
Violates clean-code ("split when >500 lines or mixed concerns") and ponytail ("God files: split when >500 lines, or mixed concerns"). The file bundles six separable concerns: CSV header/row validation, customer dedup planning (email→phone→name), product planning, address normalization + review-flagging, order grouping + number-repair, and the four-stage atomic `commitLegacyImport` transaction with its resume/id-map logic. The plan half (`planLegacyImport`, pure) and the commit half (`commitLegacyImport`, transactional) are called from different routes (POST vs PUT) and have no shared mutable state — they are independent units. `lib/exports.ts` (140 lines) and `lib/payments/reconcile.ts` (157 lines) show the arm knows how to split by concern; this one wasn't.

**M2. `STATE_NAMES` ceiling is an undocumented shortcut.**
`lib/legacy-import.ts:35-38` hard-codes nine states; any other state normalizes to `null` and the row lands in the review queue. ponytail requires a `ponytail:` comment naming the ceiling and upgrade path on deliberate shortcuts — none here. workflow ("never silently choose business logic — log in DECISION-LOG") also trips: the ceiling (legacy data only contains these states) and the upgrade path (full USPS table / geocoder) are neither in `DECISION-LOG.md` nor in a comment. The behavior is safe (bad states are review-flagged, not silently coerced), but the choice is invisible to a future reader.

**M3. `mapMethodCode` silently falls back to `local_delivery`.**
`lib/legacy-import.ts:113-119` maps keyword hits to `shipping` / `pickup` / `per_package_delivery`, and returns `local_delivery` for **anything else** — no review flag, no report entry. An unrecognized carrier or a typo ("shipp", "fed-ex", "courier") becomes a local delivery with no audit trail. This is a business decision (default method for unknown legacy methods) not present in `DECISION-LOG.md` and not marked `ponytail:`. Compare `normalizeState`, which flags the unknown instead of guessing.

### LOW

**L1. Export-center season picker uses `<a href>` instead of `<Link>`.**
`app/(admin)/admin/exports/page.tsx:39-46` renders the season scope picker as plain `<a href>` anchors, causing full navigations where the rest of the admin shell uses `next/link` `<Link>` (see `app/(admin)/admin/layout.tsx`). clean-code ("one pattern per concern" / UI consistency) and ponytail's UI-consistency line. The dataset download links correctly stay `<a>` (file downloads should not client-route); the picker should not.

**L2. Banned standalone name `result`.**
clean-code bans `result` as a standalone name. P12 client handlers use it: `components/admin/recon-panel.tsx:33` and `components/admin/test-console-client.tsx:19` both `const result = await apiFetch(...)`. Scoped and idiomatic, but the rule is literal. (Server routes use `summary`/`detail` — fine.)

**L3. `runPaymentReconciliation` issues N+1 queries.**
`lib/payments/reconcile.ts:40-89` runs one `db.payment.aggregate` per checkout session and one `stripeCheckoutSession.findFirst` + one `stripePaymentIntent.findFirst` per posted Stripe payment. At the P12 scale target (1k orders / 5k packages) this is thousands of round-trips per run. ponytail ("lazy = efficient") and the P12 scale-hardening goal. Both passes could be grouped (one `groupBy`/`findMany` + in-memory join). Not incorrect — just not scaled.

**L4. `planLegacyImport` nesting exceeds three levels; one unreachable fallback.**
clean-code ("if a function has more than 3 levels of nesting, refactor it"). The customer loop (`legacy-import.ts:146-199`) reaches 4–5 levels of nested `if/else`. Separately, `legacy-import.ts:289` `zipDigits.padStart(5, "0").slice(0, 5) || "00000"` — `padStart(5,"0").slice(0,5)` always yields a 5-char string, so the `|| "00000"` branch is unreachable dead code (clean-code: delete dead code, don't comment it).

## Rules not flagged (verified)

- **workflow** — DECISION-LOG P12-1…P12-6 cover reconciliation scope, settled-history imports, product bridging, test-mode inference, wipe scope, and dedupe order. Expectation files present and STATUS cites 46/46 smoke evidence with routes/counts. Gate discipline observed (separate STATUS + SMOKE artifacts).
- **grill-protocol / spec gate** — plan sourced from `shared/MERGED-BUILD-PLAN.md` § P12; no silent product direction invented in-code.
- **clean-code security** — export `dataset` validated against `isExportDataset` before use in filename/SQL; `seasonId` validated against DB; `lapsedCustomersCsv` uses `Prisma.sql` tagged template (parameterized). No swallowed errors (`lib/cron.ts` catch logs + rethrows). No try/catch around non-throwing code. No new dependencies.
- **ponytail ladder** — no new packages; stdlib `node:crypto` reused for hashing; existing `db`/`csv`/`addresses` helpers reused rather than reimplemented.
- **codegraph / vocabulary** — not assessable from the artifact (process rules); no `refactor`/`tidy` commands issued this phase, so vocabulary scope-table is n/a.

## Severity counts

- Critical: 0
- High: 0
- Medium: 3
- Low: 4
- Total: 7
