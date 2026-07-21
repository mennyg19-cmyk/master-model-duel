# Residual Rules Review — arm-02 (Test 5, post self-fix)

**Arm:** `arm-02`
**Tree / phase:** `arms/arm-02/workspace/` — post self-fix, full tree
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Reviewer scope:** adherence to this arm's selected catalog rules only. Findings only — no fixes.
**Blind review:** SELF-REVIEW.md, SELF-FIX-NOTES.md, and self-review chat were not read. Grades the post-fix tree only.

## Methodology

Read `kit/prompts/reviewer/review-rules.md` and the five arm rule files in
`arms/arm-02/rules/`. Walked the post-fix tree: read every file touched in the
self-fix (per git status) plus a size sweep of the whole tree for god-file and
duplication signals, and grepped for stale references to the deleted
`lib/legacy-import.ts`.

Files inspected in detail (self-fix delta + close neighbors):

- `lib/auth/registration-token.ts` (new)
- `app/api/account/register/route.ts` (modified)
- `app/api/account/register/complete/route.ts` (new)
- `app/(storefront)/verify-email/page.tsx` (new)
- `components/account/verify-email-form.tsx` (new)
- `components/account/auth-forms.tsx` (modified)
- `lib/legacy-import/plan.ts` (new — split half)
- `lib/legacy-import/commit.ts` (new — split half)
- `app/api/admin/legacy-import/route.ts` (modified)
- `lib/csv.ts`, `lib/env.ts`, `lib/checkout/create-order.ts` (modified)
- `app/api/webhooks/stripe/route.ts` (modified)
- `tests/legacy-plan.test.ts`, `tests/exports-csv.test.ts` (modified)
- `lib/newsletter-token.ts` (read for duplication comparison)
- `DECISION-LOG.md`, `README.md` (read for doc-drift)

## Severity summary

| # | Severity | Rule | Location | Finding |
|---|----------|------|----------|---------|
| 1 | **Medium** | clean-code (duplicated logic) | `lib/auth/registration-token.ts` vs `lib/newsletter-token.ts` | Near-identical signed-token implementation; Rule of 2 met, unification saves lines |
| 2 | **Low** | clean-code (consistency) / workflow (keep current) | `DECISION-LOG.md:92` | Stale path reference to deleted `lib/legacy-import.ts` |
| 3 | **Info** | codegraph | `lib/legacy-import/{plan,commit}.ts` | Structural file-split; pre-split `codegraph_impact` step not verifiable from tree |

No High or Critical findings.

## Findings

### 1. Medium — Duplicated logic: two signed-token implementations

`lib/auth/registration-token.ts` and `lib/newsletter-token.ts` are structurally
the same module. Both:

- `sign(payload)` → `createHmac("sha256", env.SESSION_SECRET).update(...).digest("base64url")`
- `create*Token(email)` → `base64url(email).${expiresMs}.${sign(payload)}`
- `verify*Token(token)` → split into 3 parts, length-check + `timingSafeEqual`, expiry check, `base64url` decode with `try/catch → null`

The only real divergences are (a) TTL — 24h hardcoded vs 90d default param, and
(b) the registration signer prefixes `register.` onto the payload for
purpose-scoping (so a token from one flow can't replay in the other); the
newsletter signer has no prefix.

This is the clean-code "duplicated logic — pull into `lib/` helpers" category.
The Rule of 2 is satisfied right now: two real call sites (newsletter
preferences/unsubscribe, and the new register-confirmation flow). A shared
`lib/signed-token.ts` exposing `createSignedToken(email, { purpose, ttlMs })`
and `verifySignedToken(token, purpose)` would collapse ~40 duplicated lines into
one parameterized implementation, with `purpose` carrying the `register.` vs
bare-payload distinction. The ponytail carve-out ("leave it duplicated if
removing duplication adds more lines than it saves") does not apply —
unification is a net line reduction.

The duplication is stable and the security posture of both is correct, so this
is Medium, not High.

### 2. Low — Documentation drift: stale path in DECISION-LOG

`DECISION-LOG.md` line 92 (DECISION-P12-7) reads:

> `STATE_NAMES` in `lib/legacy-import.ts` maps only the nine spelled-out state names…

`lib/legacy-import.ts` was deleted in the self-fix and split into
`lib/legacy-import/plan.ts` (where `STATE_NAMES` now lives) and
`lib/legacy-import/commit.ts`. A tree-wide search confirms line 92 is the only
remaining reference to the old filename — every code importer and the test
were updated to the new paths, so this is a single stale doc reference, not a
broken build.

Violates clean-code "consistency / single source of truth" and workflow's "keep
README [and decision log] current." Low severity — a reader chasing
`STATE_NAMES` from the decision log lands on a 404 path.

### 3. Info — Codegraph impact step not verifiable from tree

The codegraph rule requires `codegraph_impact` (or `codegraph impact`) before a
rename / delete / signature change / refactor command. The self-fix performed
exactly such a refactor: deleted `lib/legacy-import.ts` and split it into two
concern-scoped files (`plan.ts` pure planner, `commit.ts` staged writer).

Whether the impact step was run is a process fact not recorded in the tree, so
it cannot be graded from the post-fix state alone. What is observable: the
split is clean — `app/api/admin/legacy-import/route.ts`, `lib/legacy-import/commit.ts`,
and `tests/legacy-plan.test.ts` all import from the new paths; no dangling
reference to the old `lib/legacy-import` module survives (the one
`lib/legacy-import.ts` hit, DECISION-LOG:92, is documentation, not an import).
Recorded as Info, not a defect.

## Rule adherence observed (positives)

- **ponytail (ladder / anti-bloat):** no new dependencies added — the
  registration token uses `node:crypto` (stdlib) and the existing `env`/zod
  surface; the legacy-import split added no packages. `ponytail:` ceiling
  comments mark deliberate shortcuts with an upgrade path
  (`STATE_NAMES` nine-entry ceiling → "swap in a full USPS state-name table or
  a geocoder"; `mapMethodCode` unknown-keyword → review-flag, not silent
  coerce). Matches the rule's "name ceiling + upgrade path" requirement.
- **clean-code (god files):** the legacy-import split was by concern (pure
  plan vs. staged atomic commit), not by line count, and each half lands at
  ≤316 lines — well under the 500-line god-file threshold. A size sweep of
  the whole tree found no source file over 500 lines (only generated
  `.next/types/validator.ts` and gitignored `.scratch/*-smoke.ts` exceed it).
- **clean-code (naming):** descriptive function names
  (`createRegistrationToken`, `verifyRegistrationToken`,
  `emailDedupeBucket`, `planLegacyImport`, `commitLegacyImport`,
  `legacyFileHash`); booleans read as yes/no questions (`numberRepaired`,
  `chargeAlreadyRecorded`, `isRetry`); collections are plural (`records`,
  `customers`, `addresses`, `orders`). No banned vague standalone names
  (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) in the touched
  files.
- **clean-code (comment quality):** comments explain non-obvious intent —
  anti-enumeration posture, account-takeover prevention (SR-01: a
  passwordless row created by staff/guest checkout must prove email control
  before a password attaches), webhook retry-safety / idempotency, fail-closed
  env guards, the 15-minute dedupe bucket. No narration ("Initialize…",
  "Return the result") and no change-explanation comments.
- **clean-code (error handling):** no swallowed errors. The webhook's
  `try/catch` around the unique insert re-throws everything except `P2002`
  (the idempotency guard) — correct, not a swallowed error. Error messages
  state what went wrong and the expected state (e.g. "This confirmation link
  is invalid or has expired — register again to get a fresh one").
- **clean-code (anti-AI-tics):** no redundant try/catch around non-throwing
  code, no "just in case" branches, no copy-paste-with-minor-variation beyond
  Finding 1. `emailDedupeBucket` is a one-liner used at two real call sites
  (Rule of 2 satisfied).
- **workflow (security basics):** signed tokens with `timingSafeEqual` +
  length check; rate-limiting on both register endpoints (separate buckets:
  `register:` and `register-complete:`); `AUTH_MODE` guard on both; env
  fail-closed guards refuse the public `SESSION_SECRET` defaults and the dev
  webhook secret in real mode. No secrets committed; `.env*` is gitignored.
- **vocabulary (scope):** the self-fix was correctly scoped as a concern
  split (plan/commit) and a security feature (registration verification), not
  an over-scoped "refactor everything" pass. The split matches vocabulary's
  definition of splitting by concern.

## Per-rule adherence grades

| Rule | Grade | Notes |
|------|-------|-------|
| ponytail | A | Ladder followed (stdlib, no new deps); `ponytail:` ceiling comments present with upgrade paths; no unrequested abstractions |
| clean-code | B+ | Strong naming/comments/error-handling/god-file discipline; one Medium duplicated-logic finding (signed tokens) |
| workflow | A− | Security basics, fail-closed guards, expectation-style tests; one Low doc-drift in DECISION-LOG |
| vocabulary | A | Split scoped by concern, not over- or under-scoped |
| codegraph | (not gradable from tree) | Impact step for the file split is a process fact; the resulting split is clean with no broken imports |

## Overall

Post-fix tree shows strong adherence to the arm's selected rules. Two
actionable findings — one Medium duplication (signed-token helper pair) and one
Low documentation drift (DECISION-LOG path) — and no High or Critical issues.
The self-fix's structural split is clean and the security additions (SR-01
registration verification, webhook idempotency, fail-closed env guards) are
implemented with correct intent comments and no anti-AI-tics.
