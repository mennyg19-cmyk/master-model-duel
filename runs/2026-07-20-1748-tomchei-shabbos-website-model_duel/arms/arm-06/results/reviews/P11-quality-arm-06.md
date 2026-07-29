# P11 Quality Review — arm-06 (blind)

**Phase:** P11 — Email & notification platform
**Scope:** Resend/Twilio isolation, campaign idempotency, transactional triggers, outbox retry/failure trail, purge safety, SMS G-021 wiring, EXPECTED S1–S5.
**Mode:** Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 8 |
| **Total** | **11** |

The domain test (`scripts/test-p11-domain.mts`) exercises the outbox lifecycle, retry-to-exhaustion, SMS capture, triggered overrides, campaign snapshot/send/rerun idempotency, order hooks, and the retention purge. The findings below are correctness/robustness gaps the smoke does not cover.

---

## Major

### M1 — Campaign claim omits the `attempts < maxAttempts` guard, so overlapping reruns can exceed the retry cap and deliver one extra email
- **Location:** `lib/email/campaigns.ts` `sendCampaign` per-recipient claim (lines 120–123)
- **Claim:** The candidate `pending` query (line 111) filters `attempts: { lt: policy.maxAttempts }`, so exhausted `FAILED` rows are excluded from the candidate set. But the atomic claim `updateMany` (lines 120–123) only re-checks `status: { in: ["PENDING", "FAILED"] }` — it does NOT re-check `attempts`. Two concurrent reruns that both fetch the same retryable `FAILED` row can race: rerun B claims it, delivers, fails, and flips it back to `FAILED` with `attempts = maxAttempts`; rerun A's claim then succeeds (status is `FAILED`) and increments `attempts` past the cap, performing one real provider call beyond `maxAttempts`. This violates the retry cap and the "no duplicates on retry" intent (S2/S3).
- **Evidence:** Compare the outbox sweeper's claim in `lib/email/outbox-sweep.ts` (lines 50–60), which DOES guard each branch with `attempts: { lt: policy.maxAttempts }` for `FAILED` rows. The campaign claim has no such guard. The race window is the gap between the `findMany` (line 110) and the `updateMany` (line 120).

### M2 — Campaign send has no stale-claim recovery; a crashed `sendCampaign` strands recipients in `SENDING` forever
- **Location:** `lib/email/campaigns.ts` `sendCampaign` (lines 117–148, 153–162)
- **Claim:** The per-recipient loop claims a row by flipping `status` to `SENDING` (line 122), then calls `deliverMessage` and updates to `SENT`/`FAILED`. If the process dies between the claim and the outcome (OOM, SIGKILL, deploy mid-loop), the recipient row stays `SENDING`. The next rerun's `pending` query (line 111) filters `status: { in: ["PENDING", "FAILED"] }` — `SENDING` is excluded — so the stranded row is never re-claimed or retried. The status law (lines 153–162) sets the campaign to `FAILED` while `SENDING` rows exist (`openWork > 0`), but the `lastError` says "rerun to retry," and the rerun cannot retry them. The campaign is stuck `FAILED` with unrecoverable `SENDING` recipients. The outbox sweeper has stale-claim recovery (`SENDING` with `lastAttemptAt < staleBefore` becomes re-claimable); the campaign path has none.
- **Evidence:** `outbox-sweep.ts` lines 32–43 include `{ status: "SENDING", lastAttemptAt: { lt: staleBefore } }` in both the candidate and claim queries. `campaigns.ts` has no `lastAttemptAt` on `EmailCampaignRecipient` and no equivalent stale-claim path. `EmailCampaignRecipient` schema (lines 1172–1189) has no `lastAttemptAt` column at all.

### M3 — Outbox stale-claim recovery counts a crash as a provider failure, exhausting retries without a real attempt
- **Location:** `lib/email/outbox-sweep.ts` `sweepOutbox` claim (lines 50–60)
- **Claim:** When a stale `SENDING` row is recovered, the claim `updateMany` does `attempts: { increment: 1 }` BEFORE `deliverMessage` runs. A sweeper that crashed before contacting the provider has already burned one attempt. A few such crashes — none of which actually hit Resend/Twilio — push `attempts` to `maxAttempts`, after which the next real attempt is refused (the `FAILED` branch's `attempts: { lt: policy.maxAttempts }` guard fails) and the row is permanently `FAILED`. EXPECTED S3 wants "force provider failure → retry → single delivery + auditable failure trail"; a crash is not a provider failure, but it consumes the same retry budget.
- **Evidence:** Claim at line 59: `data: { status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: new Date() }` runs unconditionally for every claimed row, including stale-claim recoveries. There is no path that re-claims a stale `SENDING` row without incrementing `attempts`.

---

## Minor

### m1 — A resubscribed member never receives a campaign they were previously `SKIPPED` from
- **Location:** `lib/email/campaigns.ts` snapshot upsert (lines 95–104)
- **Claim:** The snapshot upsert sets `status: member.subscriber.unsubscribedAt ? "SKIPPED" : "PENDING"` only on the `create` path; the `update: {}` path is a no-op. If a member was unsubscribed at run 1 (row created `SKIPPED`) and later resubscribes (`unsubscribedAt` cleared), run 2's upsert hits the existing row and does nothing — the row stays `SKIPPED`. The `pending` query (line 111) excludes `SKIPPED`, so the resubscribed member is silently dropped from every rerun of that campaign. This is inconsistent with the late-joiner behavior the domain test asserts (sub4 gets sent on rerun): new members are reached, resubscribed members are not.
- **Evidence:** Lines 95–104: `update: {}` with no status flip. The domain test (lines 219–224) only covers a freshly added subscriber, not a resubscribed one.

### m2 — No `PHASE-P11-SMOKE.md` evidence file at the EXPECTED path
- **Location:** `arms/arm-06/workspace/.scratch/PHASE-P11-SMOKE.md` (missing)
- **Claim:** EXPECTED P11 §Smoke requires "Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P11-SMOKE.md`." No such file exists for arm-06. The domain test covers S2–S5 and G-021 programmatically, and S1's token logic is unit-tested in `test-p3.mts`, but the per-arm smoke evidence artifact the EXPECTED asks for is absent. Smoke gap vs EXPECTED.
- **Evidence:** Glob for `arms/arm-06/**/*SMOKE*` returns only `scripts/concurrency-smoke.mjs` (a P7 artifact). No `.scratch/` directory exists.

### m3 — Overlapping-sweep one-claim law is not tested (S4)
- **Location:** `scripts/test-p11-domain.mts` (lines 115–127)
- **Claim:** S4 requires "overlapping sweeps — one claim per message/job." The domain test runs `sweep1` then `sweep2` sequentially and asserts `sweep2.claimed === 0` because the row is already `SENT`. This proves a SENT row is not re-claimed, but it does NOT prove two concurrent sweeps claim distinct rows. The atomic `updateMany` makes the guarantee, but no test exercises it.
- **Evidence:** No `Promise.all([sweepOutbox(), sweepOutbox()])` or equivalent in `test-p11-domain.mts`. The one-claim law is structural, not tested.

### m4 — `snapshotted`, `alreadySent`, and `skipped` return fields are cumulative/current counts, not per-run deltas
- **Location:** `lib/email/campaigns.ts` `sendCampaign` return (lines 177–197)
- **Claim:** `snapshotted` is `members.length` (every current list member, including already-snapshotted and `SKIPPED` ones), not the number newly snapshotted this run. `alreadySent` is `count(status: "SENT")` after the loop, so it includes this run's sends — the name implies "previously sent." `skipped` is recomputed from current membership, not from the snapshot rows. An operator reading the rerun report sees `snapshotted: 4, alreadySent: 3, skipped: 1` and cannot tell how many were newly sent vs. already sent.
- **Evidence:** Line 177: `const skipped = members.filter((member) => member.subscriber.unsubscribedAt).length;` — recomputed from `members`, not from recipient rows. Line 178–180: `alreadySent` counts all `SENT` rows. Line 191: `snapshotted: members.length`. The domain test only asserts `send1.skipped === 1` and `send2.alreadySent === 2`, not the per-run delta semantics.

### m5 — Campaign personalization is limited to the recipient's email address; the subscriber `name` is dropped
- **Location:** `lib/email/campaigns.ts` per-recipient send (lines 126–127); `EmailCampaignRecipient` schema (lines 1172–1189)
- **Claim:** The campaign snapshot stores only `email` on the recipient row (line 101). The send loop fetches `pending` recipients without the subscriber relation (line 110), so `brandTokens` is called with `customerName: recipient.email` (line 126). A campaign template using `{{customerName}}` renders the raw email address in the greeting — "Hello p11-s1-...@example.org" instead of the subscriber's name. `NewsletterSubscriber.name` exists but is never carried into the campaign send path.
- **Evidence:** Line 101: `email: member.subscriber.email` — no `name` field on `EmailCampaignRecipient`. Line 110: `findMany` with no `include: { subscriber }`. Line 126: `customerName: recipient.email`.

### m6 — No index on `OutboxMessage.lastAttemptAt`; stale-claim scan relies on the status index then filters in-memory
- **Location:** `prisma/schema.prisma` `OutboxMessage` (lines 1066–1067); `lib/email/outbox-sweep.ts` candidate query (lines 32–43)
- **Claim:** The stale-claim branch `{ status: "SENDING", lastAttemptAt: { lt: staleBefore } }` uses the `@@index([status, createdAt])` to find `SENDING` rows, then filters `lastAttemptAt` in-memory. At scale with many concurrent sweeps, the `SENDING` partition can grow, and the unindexed `lastAttemptAt` filter becomes a scan. The batch cap (100) limits the damage, but the candidate query may read more `SENDING` rows than it claims.
- **Evidence:** Schema indexes on `OutboxMessage`: `@@index([kind, channel, createdAt])` and `@@index([status, createdAt])`. No `lastAttemptAt` index. The candidate `take: SWEEP_BATCH` (100) bounds the result, but the underlying scan before the `take` still evaluates the `lastAttemptAt` predicate.

### m7 — A failed test-send is silently retried by the sweeper, surprising the operator with a delayed test email
- **Location:** `lib/email/campaigns.ts` `testSendCampaign` (lines 49–63); `app/api/admin/settings/email-test/route.ts` (lines 41–56)
- **Claim:** Both test-send paths create an `outboxMessage` row with `status: PENDING` (default), attempt one inline dispatch, and on failure mark the row `FAILED` with `attempts: 1`. Because `attempts < maxAttempts`, the sweeper cron later re-claims the `FAILED` row and retries it. An operator who saw "Test email failed" in the UI can receive the test email minutes later when the sweeper succeeds — with no UI signal tying the delayed delivery back to the test action. The inline dispatch and the sweeper share the same outbox, which is the intended honesty, but the retry side effect is not surfaced.
- **Evidence:** `testSendCampaign` catch block (lines 58–61) sets `status: "FAILED", attempts: 1` and returns. The sweeper's candidate query (`outbox-sweep.ts` line 36) includes `{ status: "FAILED", attempts: { lt: policy.maxAttempts } }`, so the row is eligible for retry.

### m8 — `FAILED` outbox rows are never purged; the failure trail grows unbounded at scale
- **Location:** `lib/email/purge.ts` `purgeEmailLog` (lines 25–30)
- **Claim:** The purge deletes only `SENT` outbox rows past `retentionDays`. `FAILED` rows are intentionally preserved as the "auditable failure trail" (comment lines 6–10), satisfying EXPECTED S5's "without deleting active outbox records or audit evidence." But there is no retention cap on `FAILED` rows — they survive forever. At 5k-package scale with retries, a chronic provider issue accumulates `FAILED` rows without bound. EXPECTED S3 wants an "auditable failure trail," not an eternal one; a separate longer-but-finite retention for `FAILED` would bound growth while preserving the trail.
- **Evidence:** Line 25–27: `deleteMany({ where: { status: "SENT", createdAt: { lt: cutoff } } })` — `SENT` only. No `FAILED` cleanup. The `CronRun` message records the purge counts (line 32), but the `FAILED` population is never addressed.
