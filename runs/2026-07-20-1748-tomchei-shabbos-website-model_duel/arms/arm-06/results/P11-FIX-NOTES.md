# P11 Fix Pass — arm-06

**Date:** 2026-07-29 · **Source of truth:** `results/AGGREGATE-REVIEW-P11.md` (0B / 13M / 25m)
**Result:** 13/13 majors fixed, 23/25 minors fixed, 2 minors deferred (justified below). All gates green; smoke S1–S5 re-run 50/50.

## Majors — all 13 fixed

| # | Fix |
|---|---|
| M1 | New dedicated permission `email.manage` (manager-tier, not in STAFF defaults) gates every hub surface: all `app/api/admin/email/**` routes, both hub pages (`requirePermission`), and the sidebar nav item. The settings test sender was additionally re-gated from a broken `@/lib/rbac` import to the real `requireApiPermission` ApiGate pattern (it was effectively unguarded). Smoke pins: STAFF-tier login 403'd on the campaign API and on test-send (with m2). |
| M2 | `EmailCampaignRecipient` gains `lastAttemptAt` (migration below); campaign sends now run each recipient through the shared `claimOutboxRow` on its outbox row, whose stale branch reclaims `SENDING` rows older than `STALE_CLAIM_MS` — a crashed send no longer strands recipients or parks the campaign `FAILED` with eternal open work. Domain pin: stale-SENDING recipient reclaimed and delivered without a burned retry. |
| M3 | The claim's fresh branch re-checks `attempts: { lt: maxAttempts }` inside the same atomic `updateMany` as the status flip — overlapping reruns cannot push a row past the retry cap or produce one extra provider call. |
| M4 | `claimOutboxRow` splits fresh vs stale: fresh claims increment `attempts` (a real provider contact follows); stale-SENDING recovery only refreshes `lastAttemptAt`. A crashed sweeper no longer burns retry budget. Smoke pin: stale recovery delivers once with `attempts` unchanged at 1. |
| M5 | Campaign sends are outbox-backed: each recipient is delivered through one `OutboxMessage` row (`kind: "campaign"`) carrying `campaignRecipientId` (FK, `SetNull`), and `mirrorRecipientFromOutboxRow` reflects status/attempts/providerId/sentAt back onto the recipient ledger. The Send log tab's "every email lands here first" claim is now true. Smoke pin: exactly one outbox row per send, linked to its recipient. |
| M6 | The claim-and-deliver pattern is extracted once into `lib/email/claim-deliver.ts` (`claimOutboxRow`, `deliverClaimedRow`, `mirrorRecipientFromOutboxRow`, `STALE_CLAIM_MS`); both `sweepOutbox` and `sendCampaign` are thin loops over it. The verbatim-duplicated catch blocks are gone. |
| M7 | Both test-send paths go through `dispatchOnce(rowId)` — claim first, then deliver. If the sweeper owns the row, the test-send reports that honestly instead of double-delivering; if the test-send owns it, the sweeper skips it. The race window is closed on both sides. |
| M8 | `EmailCampaign.createdById` is now a real relation (`createdBy StaffUser? @relation(..., onDelete: SetNull)`), matching every other audited entity. |
| M9 | The triggered tab renders and saves `bodyTemplateOverride` per key (row type, edits state, textarea); the hub page's server mapping includes it. The backend's body-override resolution is reachable from the UI. |
| M10 | New `lib/cron-route.ts` `cronRoute(handler)` wrapper owns the bearer gate + `{ ok: true, ...result }` + `mapDomainError` contract; all seven cron routes (`outbox-sweep`, `email-log-purge`, `nightly-print`, `payment-reminders`, `pickup-expiry`, `season-flip`, `shipping-maintenance`) are one-liners over it. No routes were added or removed; methods unchanged. |
| M11 | `DispatchOnceResult` is `{ outboxId, delivered, providerId, error }` — one contract for campaign test-send and the settings test sender, matching what both clients read. The settings route always answers 200 with this shape (no more 502 split). Smoke + domain pins assert provider id on success and the provider message in `error` on failure. |
| M12 | `lib/notify/outbox.ts` now centralizes the kind vocabulary: `CAMPAIGN_OUTBOX_KIND`, `TEST_OUTBOX_KINDS`, and `OutboxKind = NotificationKind \| TriggeredKey \| CampaignOutboxKind`; producers reference the constants (a typo is a compile error). Channel values stay `NotificationChannel`; schema strings documented as constrained-by-vocabulary. |
| M13 | `deliverMessage` accepts an optional pre-fetched `branding`; `sendCampaign`, the sweeper (one fetch per sweep), and both test sends fetch once and thread it through. A 1000-recipient blast costs 1 branding read, not ~1001. |

## Minors — 23 fixed

- **m2** closed with M1: campaign test-send now sits behind manager-tier `email.manage`; smoke proves a STAFF-tier test-send attempt is 403'd and the fixture records zero sends to the exfil address.
- **m3** `safeEqual` hashes both sides (SHA-256) and compares with `crypto.timingSafeEqual` — the fixed-length standard pattern from `cron-auth.ts`, no length oracle.
- **m5** the snapshot pass re-syncs stale statuses: a member who resubscribed after being SKIPPED flips back to PENDING and is mailed on the next run (domain pin); conversely a member who unsubscribed after the snapshot flips to SKIPPED before mailing (domain pin).
- **m6** `workspace/.scratch/PHASE-P11-SMOKE.md` exists and is refreshed with this pass's transcript (50 checks).
- **m7** domain test runs `Promise.all([sweepOutbox(), sweepOutbox()])` over a batch of pending rows: every row claimed exactly once across both sweeps, zero double claims.
- **m8** `sendCampaign` returns honest per-run fields: `totalMembers` (list size), `newRecipients` (rows created this run), `skipped`, `sent`, `failed`, `alreadySent`, terminal `status` — no more cumulative counts dressed as deltas; domain assertions updated.
- **m9** the snapshot carries the subscriber's name; `brandTokens` gets `customerName` from the subscriber record, so `{{customerName}}` renders "Bob" instead of the email address (domain pin).
- **m10** `@@index([status, lastAttemptAt])` on `OutboxMessage` backs the stale-claim scan (migration below).
- **m11** the sweeper's FAILED-retry branch excludes `CAMPAIGN_OUTBOX_KIND` and `TEST_OUTBOX_KINDS` (`NO_SWEEP_RETRY_KINDS`): a failed test send is answered to the operator inline and never ghost-retried minutes later; campaign reruns stay operator-controlled. Domain pin.
- **m12** `purgeEmailLog` also deletes FAILED outbox rows older than `FAILED_TRAIL_RETENTION_DAYS` (365) and reports `purgedFailed`; the audit trail is long but bounded. Domain pin (ancient purged, recent survive) + smoke pin (`purgedFailed: 0` for the fresh failure).
- **m13** `getEmailBranding` throws `DomainRuleError` like its peer config guards — one error shape, mapped cleanly.
- **m14** STATUS doc corrected: real route path `payment-link` and no phantom `createCampaign` export (verified absent).
- **m15** the snapshot is `createMany({ skipDuplicates: true })` batches inside the transaction — no N sequential upserts holding the tx open.
- **m16** the email branch of `deliverMessage` refuses a null subject with `DomainRuleError` (checked before the capture short-circuit); the `?? "(no subject)"` dead fallback is gone.
- **m17** `dispatchOnce` in `claim-deliver.ts` is the single create→claim→deliver→mirror path both test sends use.
- **m18** `brandTokens` spreads caller tokens first, then the authoritative `brand`/`footer` — caller tokens can no longer shadow branding; unit pin asserts the new contract.
- **m19** one `STATUS_TONES` record in the new `components/admin/email/hub-display.ts`, used by campaigns tab, campaign editor (both badge sites), and the outbox log — inline ternary chains deleted.
- **m20** one `ERROR_PREVIEW_CHARS` constant for `lastError` truncation in both table cells (full text still rides `title`).
- **m21** triggered PATCH reduced to `update: parsed.data` / `create: { key, ...parsed.data }` — no banned `data` name, no four verbose conditional spreads (Prisma ignores `undefined`).
- **m22** campaign detail GET + PATCH both use `getCampaignOrThrow`; the non-DRAFT guard stays local to PATCH.
- **m23** new `getEmailListOrThrow` in `lib/email/lists.ts` collapses the three `findUnique` + 404 sites (campaigns create, campaign PATCH, list members) into one consistent `NotFoundError`.
- **m24** `RECENT_OUTBOX_LIMIT` in `hub-display.ts` is shared by the page query and the Send-log prose.
- **m25** subscribers-tab pref toggle is a computed-key spread — one line instead of three ternaries.

## Deferred — 2 minors

- **m1 (30-day reusable manage token):** the reuse is deliberate product surface — the manage form's own Resubscribe button depends on the same token staying valid; shortening TTL or single-use tokens is a UX/product decision for the newsletter flow, not a defect repair to make silently in a fix pass.
- **m4 (subscribe rate limit on spoofable XFF):** the code already documents it as a speed bump, and the review itself routes this to the P12 launch-readiness abuse review — a trusted-proxy/IP model is infrastructure scope, not a code fix.

## Migration

`prisma/migrations/20260729190000_p11_fix_pass/` — `EmailCampaignRecipient.lastAttemptAt`; `OutboxMessage.campaignRecipientId` (+ unique FK to recipient, `onDelete: SetNull`) and `@@index([status, lastAttemptAt])`; `EmailCampaign.createdBy` relation to `StaffUser` (`onDelete: SetNull`). SQL generated via `prisma migrate diff` (non-interactive host), applied with `migrate deploy`; `migration-guard` reports 20 migrations, DB in sync, no drift.

## Test + smoke pins added

- `test-p11-domain.mts`: M5 (campaign sends land in the outbox, one row per recipient, linked + mirrored), M2 (stale-SENDING campaign recipient reclaimed, no burned retry), M4 (stale outbox recovery keeps attempts), m5 (resubscribed member mailed / post-snapshot unsubscribe skipped), m7 (overlapping sweeps one-claim), m9 (subscriber name renders), M11 (contract fields on success + failure), m11 (sweeper never retries a failed test send), m12 (bounded failure-trail purge). The m11 assertion is scoped to the test row itself so leftover rows from prior runs in the shared dev DB can't false-fail it.
- `test-p11.mts`: brandTokens authoritative-branding contract pin (m18).
- Smoke `.scratch/smoke-p11.ps1` 42 → **50 checks**: S2 test-send contract (M11), STAFF-tier campaign API 403 (M1), STAFF-tier test-send exfil refused with zero fixture sends (m2), campaign send = one outbox row linked to its recipient (M5), S4 stale recovery never burned an attempt (M4), S5 recent failure trail survives the bounded purge (m12). `smoke-db.mts outbox-state` now returns `campaignRecipientId`.

## Gates + smoke (all green, 2026-07-29)

`lint` ✓ · `typecheck` ✓ · `migration-guard` (20 migrations, DB in sync, no drift) ✓ · `test:unit` 12/12 ✓ · `test:domain` (12 suites incl. test-p11-domain) ✓ · `build` ✓ · smoke S1–S5 **50 PASS / 0 FAIL** against the production build on 3106 (transcript in `.scratch/PHASE-P11-SMOKE.md`).
