# P11 Fix Notes — arm-03

**Phase:** P11 — Email & notification platform  
**Scope:** Single fix pass from `AGGREGATE-REVIEW-P11.md` (A-01..A-13 + M-01, M-02, M-03, M-09, M-13)  
**Ports:** web 3103 / db 4102 (embedded)  
**Smoke:** `npm run smoke:p11` → **5/5 PASS** (S1–S5)  
**CI:** `npm run ci` → **PASS** (lint, typecheck, migration:guard, 78 tests)

## Fixed IDs

| ID | Change |
|---|---|
| **A-01** | Removed `RESEND_API_KEY=mock` from `.env`; key left unset for mock/capture |
| **A-02** | Wired `EMAIL_MODE` / `SMS_MODE` / `EMAIL_FROM` in `lib/env.ts` + providers; `EMAIL_TEST_MODE=true` remains the single capture override for both channels; documented in README / `.env.example` |
| **A-03** | Added `scripts/smoke-p11.ts` + `npm run smoke:p11`; regenerated `PHASE-P11-SMOKE.json/.md` from real script output including SMS capture |
| **A-04** | Post-provider success finalizes with best-effort terminal write on txn failure; reclaim path skips re-send when a sent/captured attempt already exists |
| **A-05** | Test kinds (`test_email`, `campaign_test`) fail terminal (no retry) and are excluded from the production sweeper |
| **A-06** | Email settings loader resets `cached = null` on rejection |
| **A-07** | Preferences PATCH catches only Prisma `P2025`; other errors rethrow |
| **A-08** | Unsubscribe POST same — unknown address still idempotent `ok`; DB errors no longer swallow to false success |
| **A-09** | `notifyCustomer` takes optional `smsBody`; callers pass short SMS text; fallback truncates first email line to 160 chars |
| **A-10** | Campaign preview uses `campaignAudienceCount` (`count`) instead of `findMany().length` |
| **A-11** | Shared `lib/email/notification-lifecycle.ts` const map for status/outcome/test kinds |
| **A-12** | `email.from_address` / `email.reply_to` validated with `z.string().email()` |
| **A-13** | `sendCampaign` batches via `createMany({ skipDuplicates })` inside a transaction with SENT / `queuedCount` update |
| **M-01** | `runCronJob` oldest-running claim; concurrent same `jobName` returns `{ skipped: true, reason: "overlap" }` |
| **M-02** | Retention min 7 days in settings schema + purge clamp |
| **M-03** | Test-send routes catch `P2002` (unique dedupe) → 409 instead of 500 |
| **M-09** | Template PATCH rejects empty-string subject/body; `resolveTemplate` treats blank overrides as missing |
| **M-13** | S4 smoke loop includes `stripe-reconciliation` cron |

## Smoke result

```
passed: 5
failed: 0
S1 Preferences + tokens — PASS
S2 Campaign flow + idempotent rerun — PASS
S3 Transactional + failure trail — PASS
S4 Cron auth + overlap — PASS (o2 skipped overlap; raceClaimed=1)
S5 Purge + test mode + SMS — PASS (smsCaptured=true)
```

## Not in this pass

Remaining aggregate minors (M-04..M-08, M-10..M-12, M-14..M-36) left unless promoted.
