# P11 Aggregate Review — arm-04 (blind)

**Phase:** P11 — Email & notification platform
**Inputs:** `P11-security-arm-04.md`, `P11-quality-arm-04.md`, `P11-rules-arm-04.md`, `P11-clean-code-arm-04.md`
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings introduced. Severity mapping: Critical/High → blocker or major; security Medium → major; quality Medium → major; rules Medium → major; Low → minor; Info → minor (lowest priority) or noted.

## Counts after dedupe

| Tier | Count |
|---|---|
| Blockers | 0 |
| Majors | 8 |
| Minors | 14 |
| Info notes (not in fix list) | 7 |

## Dedupe decisions

- **`isUniqueViolation` duplication** — rules M1 (Medium) and clean-code m1 (Minor) name the same call sites (`outbox.ts:163-170`, `campaigns.ts:240-247`, `catalog/admin.ts`). Merged; higher severity wins → **major**.
- **`rejectWith` flash-redirect helper** — clean-code M2 (Major) and rules L1 (Low) name the same four action files and the same `?problem=` / `?error=` drift. Merged → **major**.
- **Error-message truncation helper** — rules L2 (Low) and clean-code m2 (Minor) name `dispatch.ts:218-221` / `job-run.ts:67-71` / `settings/actions.ts:292-294`. Merged → **minor**.
- **SENDING state never displayed** — rules M2 (Medium, "written but never read") and quality F4 (Low, "renders as Draft") name the same write at `campaigns.ts:154` and the same read at `email/page.tsx:123-125` + `campaigns/[campaignId]/page.tsx:63-65`. Merged → **major**.
- **SENDING-stuck recovery** (quality F1) and **SENDING not displayed** (rules M2 / F4) are related but distinct claims — F1 is "no recovery path after a mid-loop throw"; M2/F4 is "the column is invisible to the office." Kept separate.
- **`?problem=` vs `?error=` flash-key drift** (clean-code m5, two components) is adjacent to the `rejectWith` major (E) but lives at different locations (`flash.tsx`, `settings-tabs.tsx` vs the four action files). Kept as a linked minor.

## Prioritized fix list

### Majors (8)

1. **F1 — Campaign marooned in SENDING if the recipient loop throws.** `src/lib/email/campaigns.ts:150-178`. No try/catch around the recipient loop; a transient throw leaves `status = 'SENDING'` forever with no recovery path, no admin reset, and no sweeper re-entry. Idempotency holds per-recipient, but the campaign is stuck. Add a try/catch that flips to a recoverable state (or back to DRAFT) on throw, or a sweeper that re-enters SENDING campaigns.
2. **F2 — Claim expiry shorter than worst-case batch runtime; `recordSent`/`recordFailure` don't guard on status.** `src/lib/notifications/dispatch.ts:45` (`CLAIM_EXPIRY_MS = 10min`) vs `DEFAULT_SWEEP_LIMIT=100` × `REQUEST_TIMEOUT_MS=15s` = 25min. At T=10min a second sweep re-claims and re-sends; `recordSent`/`recordFailure` (lines 178-216) update unconditionally, so the second delivery overwrites `providerReference` and writes a second `NotificationAttempt`. Resend dedupes via `idempotency-key`; capture mode does not — CI/dev smoke can show duplicate delivery. Add `where status = 'QUEUED'` guards on the terminal updates and/or lengthen claim to exceed `limit × timeout`.
3. **E — `rejectWith` duplicated across four P11 action files with two signatures and two flash keys.** `email/actions.ts:102`, `email/lists/actions.ts:80`, `email/templates/actions.ts:77`, `settings/actions.ts:296`. Two shapes (`(path, message)` vs `(message)` with hardcoded module path) and two query keys (`?problem=` vs `?error=`) for the same "action failed" concept. The settings/email page renders two error components because of this. Extract one helper, pick one flash key.
4. **D — `isUniqueViolation` duplicated verbatim across three modules.** `notifications/outbox.ts:163-170`, `email/campaigns.ts:240-247`, `catalog/admin.ts`. Same 6-line `P2002` detector; the arm's own `job-run.ts:8-13` documents this exact drift failure mode. Lift to `lib/core/prisma.ts` (or extend `db-client.ts`).
5. **F — `settings/actions.ts` is a mixed-concern god file and P11 deepened it.** `src/app/(admin)/admin/settings/actions.ts` (313 lines, 7 distinct settings domains). P11 added `saveEmailSettingsAction`, `saveEmailBrandingAction`, `sendTestEmailAction` plus two schemas and two validators. Under the 500-line trigger but trips the mixed-concerns trigger by a wide margin. Move the three email actions next to `src/lib/email/` (mirroring `email/actions.ts`).
6. **G — `CampaignSendSummary` is a redundant alias for `OutboxResult` with a parallel counting system.** `src/lib/email/campaigns.ts:148` declares a type field-for-field identical to `OutboxResult` (`notifications/outbox.ts:34`). `queueOneRecipient` translates `OutboxResult` → string key (line 206-220); `sendCampaign` sums the strings back into a `CampaignSendSummary` (line 165). `outbox.ts:138` already exports `addResults(...)` for this summing. Return `OutboxResult` from `queueOneRecipient` and `addResults` in `sendCampaign`; retire `CampaignSendSummary`.
7. **H — SENDING state written but never displayed; hub renders it as Draft.** `src/lib/email/campaigns.ts:154` (write), `src/app/(admin)/admin/email/page.tsx:123-125` + `campaigns/[campaignId]/page.tsx:63-65` (read). `EmailCampaignStatus` has DRAFT/SENDING/SENT, but both UI screens binary-cast to Draft/Sent. A stuck-SENDING campaign looks editable and unsent, inviting a second press. Either render SENDING (the hub already has `data-status` for smoke use) or stop writing it.
8. **C — Missing `.scratch/PHASE-P11-STATUS.md` and `.scratch/PHASE-P11-SMOKE.md`.** `arms/arm-04/workspace/.scratch/` does not exist. EXPECTED names the evidence path; the smoke script is thorough but no recorded run output or per-phase status file was produced. Blocks the gate per `workflow.mdc` expectation-file discipline. Produce both files from a real smoke run.

### Minors (14)

9. **SEC-1 — `logoUrl` accepts `javascript:` / `data:` scheme; rendered into email letterhead `<img src>`.** `src/lib/env-spec.ts` (validation), `src/lib/email/branding.ts:95-96`, `settings/actions.ts:107-114`. `z.url()` accepts any URL the `URL` constructor accepts. `escapeHtml` prevents attribute breakout, but the scheme is unconstrained. Constrain to `http`/`https` the way `linkify` already does for body links.
10. **SEC-2 — Failed notification logs retain full message bodies indefinitely; purge only deletes SENT rows.** `src/lib/notifications/purge.ts:38-44`. `FAILED`/`QUEUED` rows keep `NotificationLog.body` (customer name, order total, payment URL) forever. Either age FAILED rows out on their own clock or clear `body` once a row is terminal.
11. **F5 — Settings test-sender page text contradicts the implementation.** `src/app/(admin)/admin/settings/email/page.tsx:135` says the test is "written to the outbox"; `settings/actions.ts:251-281` → `one-off.ts:sendOneOffEmail` bypasses the outbox and writes straight to `CapturedMessage`. The flash message and outbox screen are correct; the card description is wrong.
12. **F6 — Campaign recipients loaded unbounded.** `src/lib/email/campaigns.ts:156-159`. `findMany` with no `take`; the docblock references "four thousand people." Correctness holds via per-recipient idempotency, but a large list holds N rows in memory and does N sequential round-trips in one synchronous call. Add pagination or a cursor for large lists.
13. **rules L2 / cc m2 — `describe` / `safeMessage` / `firstMessage` are three copies of "first line of an error, truncated."** `dispatch.ts:218-221`, `job-run.ts:67-71`, `settings/actions.ts:292-294`. Three sites, two names, two truncation policies (200 vs none). Extract `firstErrorMessage(error, maxLength)` to `lib/core/`.
14. **rules L3 — Campaign test send filed under `source: 'settings-test'`, collapsing two distinct callers.** `campaigns.ts:144`, `messaging/capture.ts:17`, `one-off.ts:36-39`. `CapturedMessage.source` has only `outbox` / `settingsTest`; a campaign test is not a settings test. Add `campaignTest` or update the comment.
15. **rules L4 — `sweepNotificationOutbox` reads branding once; a mid-sweep branding change ships the old letterhead for the rest of the run.** `src/lib/notifications/dispatch.ts:66-67`. `branding.ts:11-12` promises "read at send time"; the code only delivers that for the first claimed message. Re-read per message (cheap, six cached settings) or narrow the comment.
16. **cc m3 — `absoluteUrl` helper local to one file while the pattern is inlined in five places.** `transactional.ts:149-151` (helper) + `campaigns.ts:234`, `payments/local-gateway.ts:40`, `checkout/checkout-service.ts:162`, `payments/local-hosted.ts:95` (inline). Lift to `lib/core/url.ts` (with a `URL`-returning sibling for the two sites that need the object).
17. **cc m4 — `EmailTabs` and `SettingsTabs` are near-identical components.** `email/email-tabs.tsx:13-36` and `settings/settings-tabs.tsx:12-35`. Same structure, same `aria-current` pattern, same active/inactive class strings, same wrapper. The `EmailTabs` header says "Same shape as the settings tabs." Extract `<TabNav items active ariaLabel testId />` to `components/ui/`.
18. **cc m5 — Two error-flash components and two flash keys for the same concept.** `components/ui/flash.tsx:10` `FlashMessages` (`problem`, boxed) and `settings/settings-tabs.tsx:37` `SettingsError` (`error`, plain). Both `role="alert"`. The settings/email page renders both. Fold `SettingsError` into `FlashMessages` (accept `error` as alias) or switch settings actions to `?problem=`. Linked to major E.
19. **cc m6 — `REQUEST_TIMEOUT_MS = 15_000` duplicated across the two provider adapters.** `email/resend-api.ts:27`, `sms/twilio-api.ts:21`. Same value, name, purpose. Lift to `lib/messaging/provider.ts` as `PROVIDER_REQUEST_TIMEOUT_MS`.
20. **cc m7 — `acceptedId` (Resend) and `acceptedSid` (Twilio) are the same function with the field name swapped.** `email/resend-api.ts:68-75`, `sms/twilio-api.ts:54-61`. Extract `extractProviderReference(payload, field, provider)` to `lib/messaging/provider.ts`.
21. **cc m8 — `getEmailProvider` and `getSmsProvider` are the same singleton with the env flag and factory swapped.** `email/provider.ts:15-18`, `sms/provider.ts:18-21`. Same 4-line cache-and-select body. Extract `createChannelProvider({ envFlag, realFactory, channel })`. Borderline under "if removing duplication adds more lines than it saves," but the pattern is now locked at two sites.
22. **cc m9 — `deliver` repeats `message.channel === 'EMAIL'` three times.** `dispatch.ts:156-161`. Extract `emailEnvelope(message, branding, sender)` / `smsEnvelope(message)` (or a single `envelopeFor(channel, …)`).

### Info notes (not in fix list, no action expected)

- **SEC-3** — `runCronJobBody` persists first 200 chars of `error.message` into `CronRunLog.detail`. DB-only, not rendered on the developer settings page. Residual; same pattern flagged P9/P10. A sanitiser would be more defensible than a length cap.
- **SEC-4** — `/newsletter/unsubscribe?state=error&reason=…` reflects an arbitrary query param into the page. React escapes; no XSS. Low-grade phishing/UI-confusion primitive. Allowlist of the four fixed `UNSUBSCRIBE_TOKEN_MESSAGES` strings costs nothing.
- **SEC-5** — `sendCampaign` does not check `status === 'DRAFT'` before flipping to SENDING. Idempotency holds; the gap is two concurrent presses both walking the full list. A status guard or "already sent to this subscriber" short-circuit would avoid the redundant scan.
- **F7** — Redundant `findUnique` pre-check in `queueMessage`. `outbox.ts:51-56`. The unique constraint + `P2002` catch already make the write idempotent; the pre-check adds a round-trip and a TOCTOU window the catch already closes.
- **rules I1** — `codegraph` adherence unverifiable from artifacts (no `.codegraph/`); fallback applied correctly. No structural evidence of grep-for-symbol violation.
- **rules I2** — `vocabulary`, UI Consistency, God files, Dependency Discipline, Anti-Hallucination, Error Handling, Security Basics, Shell execution, Tone/Anti-slop — all reviewed, no findings.
- **rules I3** — `MAX_DELIVERY_ATTEMPTS` / `RETRY_DELAYS_MS` / `CLAIM_EXPIRY_MS` are business rules with clear comments but no DECISION-LOG entry. Unverifiable from artifacts; comments carry the reasoning.

## Notes on what is solid (preserved across specialists)

- Signed preference tokens (HMAC-SHA256, purpose-tagged, `timingSafeEqual`, 30-day TTL, no existence oracle).
- Cron bearer auth (hashed-then-`timingSafeEqual`, empty secret refuses all, POST-only, 401 leaks no job detail).
- Capture mode off-loopback refuse (loud boot refusal, not silent).
- Provider secret handling (env-only, never logged, never in URLs; `env-spec` rejects empty secrets).
- No IDOR on email hub / unsubscribe (authority from signed token, not row id; `loadByToken` returns same failure for bad signature and unknown id).
- HTML escaping in letterhead; `linkify` restricts to `https?://` (SEC-1 is the one place the scheme allowlist is missing).
- Sweep claim SQL uses Prisma tagged-template `$queryRaw` (parameterized); `wallClockUtc` cast through `Prisma.sql`. No injection.
- Idempotency design (dedupe key + `EmailCampaignSend` unique pair + transactional rollback) covers double-press and post-purge rerun.
- `FOR UPDATE SKIP LOCKED` with `wallClockUtc` is the correct Postgres pattern; the timezone note is real.
- Purge is conservative (SENT only; `QUEUED`/`FAILED` survive; `AuditEvent`/`CronRunLog` untouched; `EmailCampaignSend.messageId` is `SetNull`).
- Test capture via `bounce-` prefix exercises the retry ladder without a network.
- Unit tests in `tests/email.test.ts` cover wording, override, disable, placeholder validation, branding escape/linkify, sender gate, single delivery, backoff trail, give-up, not-due skip, email-holds-while-SMS-goes, purge safety, campaign-once.
- P11 fixes both P9 review items: `runCronJobBody` now owns the `CronRunLog` row + terminal status; both P11 job bodies go through it. `Select` from `@/components/ui/field` is now used consistently on the email hub.
