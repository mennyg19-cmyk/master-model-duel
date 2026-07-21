# P11 Rules Review — arm-03

**Phase:** P11 — Email & notification platform
**Arm:** arm-03
**Rules graded:** ponytail, clean-code, workflow, vocabulary, codegraph
**Scope:** Findings only. No fixes.
**Diff reviewed (P11 changes):** `.env.example`, `package.json`, `vercel.json`, `src/app/api/admin/email/route.ts`, `src/app/api/cron/{payment-reminder,pickup-expiry,season-auto-flip,outbox-sweep,purge-email-log}/route.ts`, `src/app/(admin)/admin/email/page.tsx`, `src/app/(storefront)/newsletter/preferences/page.tsx`, `src/components/admin/{shell,settings-hub,email-hub}.tsx`, `src/lib/{checkout/session,payments/webhook,email/purge,resend/client}.ts`, `scripts/smoke-p11.mjs` — plus the supporting P11 libs touched by the diff (`src/lib/email/{order-emails,campaigns,templates}.ts`, `src/lib/notify/{outbox,sms}.ts`, `src/lib/cron/{auth,runs}.ts`, `src/lib/storefront/newsletter.ts`).
**Smoke:** `arms/arm-03/results/PHASE-P11-SMOKE.md` — 5/5 PASS. Findings are rule-adherence, not functional defects (smoke is green).

## Summary

| Severity | Count |
|---|---|
| Major | 4 |
| Minor | 7 |
| Advisory | 3 |
| **Total** | **14** |

## Findings

### Major

#### M1 — Cron overlap protection is test-only, not real in production
**Rule:** clean-code (anti-hallucination / verify-before-claim), workflow (security basics / least privilege)
**Location:** `src/lib/cron/runs.ts:7-23`, all five `src/app/api/cron/*/route.ts`
`CronJobRun.claimedToken` is `@unique`, and `beginCronRun` auto-generates `${jobKey}:${randomBytes(12).hex}` when the caller passes no `?token=`. Vercel Cron invokes these routes with no query param, so every real cron run gets a fresh random token that will never collide on the unique index. Two overlapping Vercel Cron invocations both insert successfully and both execute — the overlap guard is absent in production. The S4 "overlap" check passes only because the smoke explicitly reuses `overlapToken` twice (`scripts/smoke-p11.mjs:324-326`). The comment "overlapping calls with same token collide on unique" describes the test, not the deployed behavior. Either add `@@unique([jobKey])` with a sentinel/active-row scheme, or document that overlap is delegated to Vercel Cron's own dedupe.

#### M2 — Cron runs never finalized on failure
**Rule:** clean-code (error handling — no swallowed errors; error messages say what went wrong), workflow (gate discipline / observability)
**Location:** `src/app/api/cron/{outbox-sweep,purge-email-log,pickup-expiry,payment-reminder,season-auto-flip}/route.ts`
Every cron route calls `finishCronRun(claim.run.id, …)` only on the success path between `beginCronRun` and the return. If the inner work throws, the `catch (error) { return apiErrorResponse(error); }` branch returns without finalizing the `CronJobRun` row, leaving `finishedAt=null, ok=null` and writing no failure audit. Over time failures accumulate dangling rows with no record of why. Finalize in a `finally` (with `ok:false` + error meta) or add an explicit `finishCronRun(..., { ok:false, meta:{error} })` in each catch.

#### M3 — Dead code: `writeCronAudit` (0 call sites)
**Rule:** ponytail (YAGNI / deletion over addition), clean-code (Rule of 2, dead code)
**Location:** `src/lib/cron/runs.ts:39-49`
`writeCronAudit` is exported but never imported anywhere in `src/` or `scripts/`. Cron routes and `finishCronRun` call `writeAudit` directly. Unused abstraction shipped "for later." Delete it.

#### M4 — Dead code: `mintUnsubscribeToken` (0 internal call sites)
**Rule:** ponytail (YAGNI / Rule of 2), clean-code (dead code)
**Location:** `src/lib/storefront/newsletter.ts:98-100`
`mintUnsubscribeToken` is exported but has no caller in `src/` or `scripts/`. No send path (`email/campaigns.ts`, `email/order-emails.ts`) mints unsubscribe tokens, so the function is unwired. The EXPECTED S1 unsubscribe flow needs a token source, but the smoke mints tokens itself (`smoke-p11.mjs:27-31`) using the lower-level `signUnsubscribeToken` directly. Either wire `mintUnsubscribeToken` into the real send paths (so real emails carry unsubscribe links) or drop it. Per Rule of 2 it has no real call site right now.

### Minor

#### m1 — Banned standalone name `result` (recurring)
**Rule:** clean-code (naming — `result` is on the banned list)
**Locations:**
- `src/lib/notify/outbox.ts:292, 302, 312` — `const result = await resendSend(...)` / `smsSend(...)` / `deliverClaimed(...)`
- `src/lib/email/order-emails.ts:134` — `const result = await enqueueNotification(...)`
- `src/lib/email/campaigns.ts:80` — `const result = await resendSend(...)`
- `src/lib/email/purge.ts:91` — `const result = await resendSend(...)`
- `src/components/admin/email-hub.tsx` — `const result = await post(...)` (4 occurrences)
- `src/app/api/newsletter/preferences/route.ts:21` — `let result;`

Rename to what the value represents: `sendResult`, `enqueueResult`, `postResult`, etc.

#### m2 — Magic string `"CAPTURED"` instead of `NotifyStatus.CAPTURED`
**Rule:** clean-code (one pattern per concern / magic values)
**Location:** `src/lib/email/campaigns.ts:165` — `status: outbox.row.status === "CAPTURED" ? "captured" : "queued"`
The rest of the outbox layer compares against the `NotifyStatus.CAPTURED` enum (e.g. `outbox.ts:314, 321, 396`). This one site string-compares the enum value to a literal. Use `NotifyStatus.CAPTURED` for parity.

#### m3 — Inconsistent error handling in newsletter preferences route
**Rule:** clean-code (one error-handling approach per project), workflow (consistency)
**Location:** `src/app/api/newsletter/preferences/route.ts:24-27`
The catch hand-rolls `NextResponse.json({ error: message }, { status: 503 })`. Every other P11 route (`api/admin/email`, `api/cron/outbox-sweep`, `api/cron/purge-email-log`, the newsletter siblings) uses `apiErrorResponse(error)`. This route is the outlier. Use the shared helper.

#### m4 — Unsafe type escape hatch `as never`
**Rule:** clean-code (anti-AI-tics: redundant/unsafe type assertions)
**Location:** `src/app/api/admin/email/route.ts:183` — `branding: body.branding as never`
`as never` casts `unknown` to `never` to satisfy `Prisma.InputJsonValue`, defeating the type check rather than narrowing. Shape `branding` in the zod schema (e.g. `z.record(z.unknown())`) and drop the `as never`.

#### m5 — Duplicate import from the same module
**Rule:** clean-code (inconsistent patterns)
**Location:** `src/lib/email/purge.ts:1` and `src/lib/email/purge.ts:10`
Line 1 imports `{ AuditAction, NotifyStatus }` from `@prisma/client`; line 10 imports `{ NotifyChannel }` from the same module. Merge into one statement.

#### m6 — `unknown[]` state + repeated inline casts in EmailHub
**Rule:** clean-code (type/schema drift, copy-paste with minor variations)
**Location:** `src/components/admin/email-hub.tsx:11-15` (state), and inline casts at `:189, :211, :243, :256, :272`
Five lists are held as `unknown[]` and re-cast to ad-hoc shapes at every render site (`(campaigns as { id: string; name: string; status: string; subject: string }[])`, etc.). Define one type per list (or derive from the API response) and use it in both `useState` and JSX. Repeated casts are a copy-paste smell and lose type safety between fetch and render.

#### m7 — `mock` mode reports `captured: true`
**Rule:** clean-code (anti-AI-tics — every line must have a reason; consistency)
**Location:** `src/lib/resend/client.ts:58-64`
The `mock` branch returns `captured: true` with a `mock_` provider id. `capture` means "stored locally instead of sent"; `mock` means "fake-sent without storing". Conflating them makes audit metadata (`meta.captured`) lie about what happened. The S5 smoke asserts `testSendResult.value.captured === true` in mock mode, so this is load-bearing for the test — but the semantics are wrong. Either drop `captured` from the mock branch (and adjust S5 to accept `providerId` starting with `mock_`), or rename the field to reflect "did not hit a live provider."

### Advisory

#### a1 — Dead default parameter in `load`
**Rule:** clean-code (dead code)
**Location:** `src/components/admin/email-hub.tsx:24` — `useCallback(async (nextTab: Tab = tab) => …, [tab])`
Every caller passes `nextTab` explicitly (`load(tab)` in the effect, `load("campaigns")`, `load("lists")`, etc.), so the `= tab` default is dead. Remove the default or remove the explicit args.

#### a2 — `dangerouslySetInnerHTML` on admin campaign preview
**Rule:** workflow (security basics)
**Location:** `src/components/admin/email-hub.tsx:185` — `<div dangerouslySetInnerHTML={{ __html: preview.htmlBody }} />`
Admin-only and `settings.write`-gated, so low risk, but a `settings.write` user can inject script into their own admin session. Consider sanitizing or rendering the preview in a sandboxed iframe.

#### a3 — Magic default test recipient hardcoded twice
**Rule:** clean-code (magic values)
**Location:** `src/components/admin/settings-hub.tsx:19`, `src/components/admin/email-hub.tsx:19` — `useState("manager@tomchei.local")`
The same default test recipient is hardcoded in two components. Pull to a shared constant or a `EMAIL_TEST_TO` env var with `.env.example` placeholder.

## Not findings (verified clean)

- **Ponytail ladder:** Resend client is fetch-based, no SDK package added (`src/lib/resend/client.ts:43` comment + impl). SMS uses native fetch to Twilio, no Twilio SDK. `node:crypto` for tokens/ids. Correct ladder discipline — no new packages in `package.json` for P11 (only a `smoke:p11` script entry).
- **God files:** Largest P11 lib is `notify/outbox.ts` at 401 lines, cohesive (outbox lifecycle only). Under the 500-line / mixed-concerns threshold. `email-hub.tsx` is 288 lines, single concern.
- **Comment quality:** Comments cite rule IDs (R-088, R-171, R-090, R-172, R-087, R-083, R-181, R-182, R-163, R-178, G-021, H3, S5) and state non-obvious intent (e.g. `// capture + mock both avoid live providers (R-090 / S5).`). No narration or change-explanation comments.
- **Security basics:** `CRON_SECRET` and `NEWSLETTER_HMAC_SECRET` are fail-closed (throw if missing). `timingSafeEqual` used for both bearer and HMAC comparison. `.env*` is gitignored (`.gitignore:34`), `.env.example` tracked with placeholders for every new P11 secret (`EMAIL_MODE`, `EMAIL_FROM`, `RESEND_API_KEY`, `SMS_MODE`, `TWILIO_*`). Subscribe never returns the unsubscribe token to the HTTP caller (H3).
- **Idempotency:** Outbox + campaign deliveries enforce unique `idempotencyKey` with P2002 handling. Smoke S2 confirms rerun produces 0 duplicates; S3 confirms transactional rerun is a no-op.
- **Dynamic import pattern:** `await import("@/lib/email/order-emails")` in `webhook.ts`, `checkout/session.ts`, `payments/offline.ts`, `ops/refunds.ts` is an established codebase-wide pattern (4 call sites), not a P11-introduced inconsistency — presumed cycle-break. Not a finding.
- **Codegraph:** Index healthy (`arms/arm-03/workspace/.codegraph/codegraph.db` exists). Contestant-side tool usage is not assertable from output; the index exists and is current.

## Out of scope

Functional/UX review, plan adherence, and smoke re-runs are separate review tracks. This pass grades catalog-rule adherence only.
