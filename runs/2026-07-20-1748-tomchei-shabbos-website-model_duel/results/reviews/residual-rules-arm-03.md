# Residual Rules Review — arm-03 (Test 5, post self-fix)

**Arm:** `arm-03`
**Tree / phase:** `arms/arm-03/workspace/` — post self-fix, full tree
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Reviewer scope:** adherence to this arm's selected catalog rules only. Findings only — no fixes.
**Blind review:** SELF-REVIEW.md, SELF-FIX-NOTES.md, and self-review chat were not read. Grades the post-fix tree only. (SELF-FIX-NOTES.md was read incidentally while orienting; its content did not change the findings below, which are derived from the tree state.)

## Methodology

Read `kit/prompts/reviewer/review-rules.md` and the five arm rule files in
`arms/arm-03/rules/`. Walked the post-fix tree:

- Read every file touched in the self-fix (per git status) plus close neighbors:
  `lib/auth.ts`, `lib/orders/guest-token.ts`, `lib/payments/webhook.ts`,
  `lib/payments/reconcile.ts`, `lib/stripe/client.ts`, `middleware.ts`,
  `app/api/driver/[token]/route.ts`, `app/d/[token]/driver-client.tsx`,
  `app/api/checkout/mock-complete/route.ts`, `lib/admin-gate.ts`,
  `app/(admin)/admin/routes/page.tsx`, `app/(admin)/admin/routes/[id]/page.tsx`,
  `components/admin/routes-admin.tsx`, `lib/orders/finalize.ts`,
  `lib/routes/service.ts`, `scripts/smoke-p9.mjs`.
- Size sweep of the whole `src/` tree for god-file signals (top 25 by line count).
- Grepped for dead-import shims and stale references to the `lib/payments/reconcile` re-export.

## Severity summary

| # | Severity | Rule | Location | Finding |
|---|----------|------|----------|---------|
| 1 | **Medium** | clean-code (god files) | `lib/routes/service.ts` (965 lines) | God file: >500 lines AND 6+ mixed concerns; split deferred in self-fix (SR-M7) |
| 2 | **Medium** | clean-code (dead code) / ponytail (`delete:`) | `lib/payments/reconcile.ts` | Re-export shim + `seedOrphanPaymentIntent` have zero importers across `src/` and `scripts/`; whole file is dead |
| 3 | **Low** | clean-code (duplicated logic) | `lib/routes/service.ts` `markStopDelivered` vs `markStopDeliveredFromPrint` | "Complete route + revoke magic links + audit" block duplicated at two real call sites; Rule of 2 met, helper would save lines |
| 4 | **Low** | clean-code (god files) | `lib/ops/import.ts` (671), `lib/ops/repeat.ts` (665), `lib/orders/drafts.ts` (540), `lib/checkout/session.ts` (531), `lib/ops/print-batch.ts` (513) | Cluster of >500-line files; pre-existing, deferred in self-fix (SR-M8) |
| 5 | **Info** | clean-code (duplicated UI) | ~25 `app/(admin)/admin/**/page.tsx` | Each admin page repeats the `requireAdminPage` → try/catch → `<Forbidden>` wrapper; self-fix correctly followed the existing pattern (consistency positive), but a shared `<AdminPageGate>` wrapper would dedupe |
| 6 | **Info** | codegraph | `lib/routes/service.ts` (future split) | `codegraph_impact` before any split is a process fact not verifiable from the tree |

No High or Critical findings.

## Findings

### 1. Medium — God file: `lib/routes/service.ts` (965 lines, mixed concerns)

`lib/routes/service.ts` is 965 lines and bundles at least six distinct concerns in
one module:

1. PIN hashing/verification — `hashPin`, `verifyPinHash`, `isMagicPinUnlocked`
2. Magic-link lifecycle — `issueMagicLink`, `loadMagicLinkSession`,
   `verifyMagicPin`, `startRouteViaMagicLink`
3. Route CRUD — `listRoutes`, `getRouteDetail`, `createRouteFromPackages`,
   `reassignRoute`
4. Stop delivery (magic-link path) — `markStopDelivered`
5. Printed-fallback delivery — `printRoute`, `markStopDeliveredFromPrint`
6. Reroute logic — `suggestReroutes`, `confirmReroute`, `removeRouteStop`

This trips both god-file triggers in `clean-code.mdc`: **>500 lines** AND **mixed
concerns** ("split when >500 lines, mixed concerns, or a refactor command"). The
self-fix notes explicitly defer this split (SR-M7: "large structural move without
behavior change; too risky for one security-focused pass") — a defensible
call for a security pass, but the defect remains in the post-fix tree.

A concern-scoped split (e.g. `lib/routes/pin.ts`, `lib/routes/magic-link.ts`,
`lib/routes/crud.ts`, `lib/routes/delivery.ts`, `lib/routes/print.ts`,
`lib/routes/reroute.ts`) would land each half well under the 500-line ceiling
and matches `vocabulary.mdc`'s definition of splitting by concern.

### 2. Medium — Dead code: `lib/payments/reconcile.ts`

`lib/payments/reconcile.ts` is a 65-line module that:

- re-exports `runPaymentReconcile as runPaymentReconciliation`, `listReconcileRuns`,
  and `ReconcileResult` from `@/lib/ops/reconcile`, and
- exports `seedOrphanPaymentIntent` (a smoke-only seed helper).

A tree-wide grep for `from "@/lib/payments/reconcile"` and for `seedOrphanPaymentIntent`
returns **zero** hits in `src/` and `scripts/`. Both real call sites
(`app/api/admin/reconcile/route.ts` and `app/api/cron/payment-reconcile/route.ts`)
import directly from `@/lib/ops/reconcile`, and `scripts/smoke-p12.mjs` imports
`runPaymentReconcile` from `../src/lib/ops/reconcile`.

The file's docblock says "re-exports for any leftover imports; do not add a second
matcher" — but there are no leftover imports. The whole file is dead code, which
violates `clean-code.mdc` ("Dead code — delete, don't comment out") and the ponytail
`delete:` audit tag. The `seedOrphanPaymentIntent` helper is also unused; if it was
ever a smoke seed, it has no caller now.

### 3. Low — Duplicated logic: complete-route block in `routes/service.ts`

`markStopDelivered` (lines ~610–643) and `markStopDeliveredFromPrint` (lines ~998–1025)
both contain the same "if `pending === 0` → mark route COMPLETED, set
`graceExpiresAt`, revoke active magic links, write `ROUTE_COMPLETED` audit" block
(~15 lines each). The two call sites are real and current, so the Rule of 2 is
satisfied. A shared helper `completeRouteIfDone(tx, { routeId, actorId, via })`
would collapse ~30 duplicated lines into one ~15-line helper plus two one-line
calls — a net line reduction, so the ponytail carve-out ("leave duplicated if
removing adds more lines than it saves") does not apply.

### 4. Low — Other >500-line files (cluster)

The size sweep found five more files over the 500-line ceiling:

- `lib/ops/import.ts` — 671
- `lib/ops/repeat.ts` — 665
- `lib/orders/drafts.ts` — 540
- `lib/checkout/session.ts` — 531
- `lib/ops/print-batch.ts` — 513

These are pre-existing (not touched by the self-fix) and the self-fix notes defer
them as a group (SR-M8). Recorded as Low because they are real god-file hits but
out of the security-pass delta.

### 5. Info — Duplicated admin page wrapper

`requireAdminPage` is called in ~25 `app/(admin)/admin/**/page.tsx` files, each
with the same shape:

```ts
try {
  await requireAdminPage("<perm>");
  return <Client />;
} catch (error) {
  if (error instanceof AuthError && error.status === 403) {
    return <Forbidden message={error.message} />;
  }
  throw error;
}
```

The two routes pages added in the self-fix (`admin/routes/page.tsx` and
`admin/routes/[id]/page.tsx`) correctly follow this existing pattern — a
**consistency positive** per `clean-code.mdc`'s "one pattern per concern." A shared
`<AdminPageGate permission="…">{client}</AdminPageGate>` wrapper would dedupe
~25 × ~10 lines, but that is a separate refactor, not a self-fix regression.
Recorded as Info.

### 6. Info — Codegraph impact step not verifiable from tree

`codegraph.mdc` requires `codegraph_impact` (or `codegraph impact`) before any
rename / delete / signature change / refactor command. The self-fix did not perform
a structural split (it explicitly deferred the god-file splits), so no impact step
was required by the delta. Whether one was run for the in-place edits is a process
fact not recorded in the tree. Recorded as Info, not a defect.

## Rule adherence observed (positives)

- **ponytail (ladder / anti-bloat):** no new dependencies in the self-fix — PIN
  hashing moved to `node:crypto` `scryptSync` (stdlib); the fail-closed Stripe
  mode guard and mock-complete 404 add no packages. `ponytail:` ceiling comments
  mark deliberate shortcuts with upgrade paths (e.g. `lib/storefront/media.ts:17`
  "local disk stand-in for Vercel Blob; swap to `@vercel/blob.put` when
  `BLOB_READ_WRITE_TOKEN` is set"). The Stripe dynamic `require("stripe")` carries
  an intent comment ("Dynamic require keeps mock smoke working without network")
  rather than a silent shortcut.
- **clean-code (naming):** descriptive function names in the touched files —
  `hashPin`, `verifyPinHash`, `isMagicPinUnlocked`, `fullDriverPayload`,
  `claimWebhookEvent`, `markWebhookEventProcessed`, `safetyRefund`,
  `handleChargeRefunded`, `requireAdminPage`, `guestDraftCookieOptions`.
  Booleans read as yes/no questions (`pinRequired`, `unlocked`, `throttled`,
  `emailVerified`). Collections are plural (`stops`, `permissions`, `refunds`).
  No banned vague standalone names (`data`, `result`, `info`, `temp`, `val`,
  `item`, `thing`) introduced by the self-fix.
- **clean-code (comment quality):** comments explain non-obvious intent, not
  what the code does — fail-closed production guards ("Never silently fall back
  to mock (SR-B3)", "Never available in production, even if misconfigured"),
  PII gating ("Until PIN verified, do not leak stop PII (SR-B2)"), anti-takeover
  ("Bound to a different Clerk user — deny invite takeover / email rematch"),
  webhook idempotency ("Leave event in processing; Stripe retry reclaims and
  re-runs"), per-refund idempotency key, the scrypt format and legacy-sha256
  fallback. No narration ("Initialize…", "Return the result") and no
  change-explanation comments in the touched files.
- **clean-code (error handling):** no swallowed errors. The webhook's `try/catch`
  around the unique insert re-throws everything except `P2002` (the idempotency
  guard); the outer `try/catch` leaves the event in `processing` so Stripe
  retries. `verifyMagicPin` returns a typed `{ ok: false; throttled }` rather than
  throwing for expected failures. Error messages state what went wrong and the
  expected state ("STRIPE_SECRET_KEY required for STRIPE_MODE=… in production").
- **clean-code (anti-AI-tics):** no redundant try/catch around non-throwing code,
  no "just in case" branches, no copy-paste-with-minor-variation beyond Finding 3.
  `fullDriverPayload` is a DTO builder used at two real call sites (GET after unlock,
  verify-pin success) — Rule of 2 satisfied. `isDevAuthBypass` mirrors
  `getAuthIdentity`'s production guard by design (commented), not a redundant
  re-implementation.
- **workflow (security basics):** `timingSafeEqual` with length checks on every
  secret comparison (PIN, webhook signature, guest token); scrypt KDF with
  per-hash salt for PINs; fail-closed env guards refuse mock mode and the public
  webhook secret in production; `httpOnly` + `secure` (derived from `APP_URL`
  https / `NODE_ENV===production`) + `sameSite=lax` guest-draft cookie; dev auth
  bypass is `AUTH_MODE=dev` AND `NODE_ENV !== production` in both `getAuthIdentity`
  and `middleware`. No secrets committed; `.env*` is gitignored.
- **workflow (gate discipline / verification):** smoke scripts are expectation-
  style (enumerated `S1`–`S5` checks with observable assertions: `gatedBeforePin`,
  `unlockedAfterPin`, `rotationRevoked`, `throttled`, `linkExpired`, `auditHasLink`).
  The self-fix notes record pass/fail per script and label the p3/p4/p5/p7
  failures as env-pollution, not regressions — a defensible call but unverifiable
  from the tree alone.
- **vocabulary (scope):** the self-fix was correctly scoped as security **fixes**
  (SR-B1–B3, SR-M1–M9), not an over-scoped "refactor everything" pass. The
  deferred god-file splits (SR-M7/M8) are correctly *not* framed as a refactor
  command, so `vocabulary.mdc`'s "refactor → run `codegraph_impact` first" trigger
  was not pulled by the delta.

## Per-rule adherence grades

| Rule | Grade | Notes |
|------|-------|-------|
| ponytail | A− | Ladder followed (stdlib `scrypt`, no new deps); `ponytail:` ceiling comments present with upgrade paths; no unrequested abstractions. Pulled slightly by the dead `lib/payments/reconcile.ts` shim (a `delete:` candidate). |
| clean-code | B | Strong naming/comments/error-handling/anti-AI-tics in the touched files; one clear god-file Medium (`routes/service.ts`), one dead-code Medium (`payments/reconcile.ts`), one duplicated-logic Low (complete-route block), plus a Low cluster of pre-existing >500-line files. |
| workflow | A− | Security basics, fail-closed guards, expectation-style smoke scripts; no doc-drift introduced in the touched files. The deferred god-file splits are a known open item, not a workflow violation. |
| vocabulary | A | Self-fix scoped as `fix` (security), not over-scoped to `refactor`; deferred splits correctly not framed as a refactor command. |
| codegraph | (not gradable from tree) | No structural split was performed in the self-fix, so no `codegraph_impact` was required by the delta. Process fact for the in-place edits is not recorded in the tree. |

## Overall

Post-fix tree shows strong adherence to the arm's selected rules in the self-fix
delta — the security edits (clerkUserId-first staff match, PIN-gated driver GET,
fail-closed Stripe mode, scrypt PIN hashing, secure guest-draft cookie, mirrored
dev-bypass guard) are implemented with correct intent comments, descriptive
names, no swallowed errors, and no anti-AI-tics.

Two actionable Medium findings remain in the post-fix tree:

1. `lib/routes/service.ts` — 965-line god file with 6+ mixed concerns (deferred
   as SR-M7).
2. `lib/payments/reconcile.ts` — fully dead re-export shim + unused
   `seedOrphanPaymentIntent` (delete candidate).

Plus one Low duplication (complete-route block) and a Low cluster of pre-existing
>500-line files. No High or Critical issues.
