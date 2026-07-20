# Phase EXPECTED — P11

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P11 — Email & notification platform.

## Must be true when phase is done

1. [ ] Resend integration isolated in SDK module; email hub (campaigns, subscribers, lists, templates + branding, triggered keys)
2. [ ] Campaign builder + send with idempotent reruns (no duplicate deliveries on retry)
3. [ ] Transactional order emails — confirmation, payment link, refund — with per-key overrides, test capture, outbox + retry sweeper cron
4. [ ] Email-log purge cron; email test sender in settings; SMS dispatch module wired for P9 notification channel reuse (G-021)

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Preferences + tokens | Subscribe; change all three preference states via signed token; reject tampered/expired; unsubscribe |
| S2 | Campaign flow | Draft, preview, test-send, send, list; rerun send — no duplicates |
| S3 | Transactional + failure | Trigger each template from domain event; force provider failure → retry → single delivery + auditable failure trail |
| S4 | Cron auth + overlap | Every cron endpoint: missing/wrong/correct secret; overlapping sweeps — one claim per message/job |
| S5 | Purge + test mode | Purge eligible logs without deleting active outbox/audit; test mode captures instead of contacting providers |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P11-SMOKE.md`

## Out of scope this phase

- Reporting, migration import, scale dress rehearsal (P12)
- New delivery/route features (P9 complete)
