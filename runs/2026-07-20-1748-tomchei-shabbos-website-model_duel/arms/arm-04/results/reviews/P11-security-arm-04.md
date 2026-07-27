# P11 Security Review — arm-04 (blind)

**Phase:** P11 — Email & notification platform (Resend/Twilio providers, email hub, campaigns, transactional outbox, preference tokens, purge cron, test capture)
**Scope:** `arms/arm-04/workspace/` — P11 surface only (no P12 reporting/migration reviewed)
**Reviewer:** Security specialist, blind to model identity
**Reference:** `shared/phases/PHASE-P11-EXPECTED.md`, `kit/prompts/reviewer/review-security.md`
**Method:** Static read of routes, server actions, services, providers, env spec, scratch smoke/STATUS. Findings only — no fixes proposed.

## Surface examined

- Cron auth + run logging: `src/lib/cron/authorize.ts`, `src/lib/cron/job-run.ts`, `src/app/api/cron/notification-sweep/route.ts`, `src/app/api/cron/email-log-purge/route.ts`
- Outbox + dispatch: `src/lib/notifications/outbox.ts`, `src/lib/notifications/dispatch.ts`, `src/lib/notifications/purge.ts`
- Email providers: `src/lib/email/provider.ts`, `src/lib/email/resend-api.ts`, `src/lib/email/one-off.ts`, `src/lib/email/branding.ts`, `src/lib/email/templates.ts`, `src/lib/email/transactional.ts`, `src/lib/email/campaigns.ts`, `src/lib/email/subscriber-lists.ts`
- SMS providers: `src/lib/sms/provider.ts`, `src/lib/sms/twilio-api.ts`, `src/lib/messaging/provider.ts`, `src/lib/messaging/capture.ts`
- Newsletter tokens + subscriptions: `src/lib/newsletter/tokens.ts`, `src/lib/newsletter/subscriptions.ts`, `src/lib/newsletter/preferences.ts`
- Storefront newsletter: `src/app/(storefront)/newsletter/page.tsx`, `src/app/(storefront)/newsletter/manage/page.tsx`, `src/app/(storefront)/newsletter/unsubscribe/page.tsx`, `src/app/(storefront)/newsletter/preferences-form.tsx`, `src/app/(storefront)/newsletter-actions.ts`
- Admin email hub: `src/app/(admin)/admin/email/page.tsx`, `actions.ts`, `audience-fields.tsx`, `email-tabs.tsx`, `outbox/page.tsx`, `lists/page.tsx`, `lists/actions.ts`, `templates/page.tsx`, `templates/actions.ts`, `campaigns/[campaignId]/page.tsx`
- Settings email: `src/app/(admin)/admin/settings/email/page.tsx`, `src/app/(admin)/admin/settings/actions.ts`
- Env spec + auth: `src/lib/env-spec.ts`, `src/lib/env.ts`, `src/lib/auth/staff.ts`
- Smoke: `scripts/smoke-p11.ts`

## Findings

### SEC-1 — `logoUrl` accepts `javascript:` scheme; rendered into email letterhead `<img src>`
**Severity:** Low
**File:** `src/lib/env-spec.ts` (validation), `src/lib/email/branding.ts:95–96` (rendering), `src/app/(admin)/admin/settings/actions.ts:107–114` (`emailBrandingSchema`)

`emailBrandingSchema.logoUrl` validates with `value === '' || z.url().safeParse(value).success`. Zod's `z.url()` accepts any URL the `URL` constructor accepts, including `javascript:alert(1)`, `data:text/html,...`, and `vbscript:...`. The saved value is then written verbatim into the HTML letterhead at `branding.ts:96`:

```95:96:src/lib/email/branding.ts
function logoOrName(branding: EmailBranding): string {
  if (branding.logoUrl.trim() !== '') {
    return `<img src="${escapeHtml(branding.logoUrl.trim())}" alt="${escapeHtml(branding.fromName)}" style="max-height:48px;margin-bottom:20px" />`;
```

`escapeHtml` escapes `&`, `<`, `>`, `"` so the attribute cannot be broken out — no XSS via attribute injection. But the URL scheme is unconstrained, so a `javascript:` or `data:` URL is emitted into every outgoing email's `<img src>`. Modern mail clients do not execute script from `<img src>`, but `data:` URLs in `<img>` are a known tracking-pixel and content-injection vector, and a `javascript:` value is a latent XSS if any client ever renders it. The gate is `settings.manage` (staff only), so this is self-injection rather than external, but the schema should constrain the scheme to `http`/`https` (or at least reject `javascript:`/`data:`) the way `linkify` already restricts linkification to `https?://`.

### SEC-2 — Failed notification logs retain full message bodies indefinitely; purge only deletes SENT rows
**Severity:** Low
**File:** `src/lib/notifications/purge.ts:38–44`

```38:44:src/lib/notifications/purge.ts
    const messages = await db.notificationLog.deleteMany({
      where: { status: 'SENT', sentAt: { lt: cutoff } },
    });

    // Test-mode captures are copies of the same text with no delivery to
    // prove, so they go on the same clock.
    const captures = await db.capturedMessage.deleteMany({ where: { capturedAt: { lt: cutoff } } });
```

The retention cron deletes only `status: 'SENT'` rows. `FAILED` rows — and `QUEUED` rows — are kept forever, and `NotificationLog.body` holds the full plain-text email (customer name, order total, payment URL, refund reason, etc.). The module docstring defends keeping FAILED rows as "the working outbox … a failure nobody ever answers", but a message given up on after five tries is no longer working outbox; it is a permanent PII store with no retention bound. A donor's name and order details in a five-times-failed confirmation sit in the database until someone deletes the row by hand. The outbox page renders `lastError` and `attempts` but not `body`, so the body is DB-only — but DB-only is still a retention exposure. Either FAILED rows should age out on their own clock (e.g. a longer window than SENT) or the body column should be cleared once a row is terminal.

### SEC-3 — `runCronJobBody` persists first 200 chars of `error.message` into `CronRunLog.detail`
**Severity:** Informational
**File:** `src/lib/cron/job-run.ts:53–70`

```53:70:src/lib/cron/job-run.ts
  } catch (error) {
    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        detail: { message: safeMessage(error) },
      },
    });
```

`safeMessage` keeps the first line of `error.message` up to 200 chars. Database/driver errors can carry connection-string fragments or bound parameter values in their message text. `CronRunLog.detail` is reachable only with DB access (the developer settings page renders `jobName`/`status`/`itemsProcessed`, not `detail`), so this is residual rather than a live leak. Same pattern P9 SEC-4 and P10 SEC-3 flagged for `pickup-service` / `payment-reminder` / `season-flip`; the P11 sweep and purge paths inherit it. A sanitiser that strips known secret patterns would be more defensible than a length cap.

### SEC-4 — `/newsletter/unsubscribe?state=error&reason=…` reflects an arbitrary query parameter into the page
**Severity:** Informational
**File:** `src/app/(storefront)/newsletter/unsubscribe/page.tsx:31–39`

```31:39:src/app/(storefront)/newsletter/unsubscribe/page.tsx
  if (state === 'error') {
    return (
      <Outcome title="That link did not work">
        <p role="alert" className="text-[var(--color-danger)]" data-testid="token-error">
          {reason ?? 'Use the link from a recent email.'}
        </p>
```

The `reason` query param is rendered into the page with no server-side allowlist. React escapes the text, so there is no XSS. But an attacker can craft a URL like `/newsletter/unsubscribe?state=error&reason=Your+account+is+locked,+click+here…` and the page will display it under the site's own heading and styling — a low-grade phishing/UI-confusion primitive. The legitimate `reason` only ever comes from `UNSUBSCRIBE_TOKEN_MESSAGES` (four fixed strings), so an allowlist costs nothing.

### SEC-5 — `sendCampaign` does not check `status === 'DRAFT'` before flipping to SENDING
**Severity:** Informational
**File:** `src/lib/email/campaigns.ts:150–178`

```150:178:src/lib/email/campaigns.ts
export async function sendCampaign(campaignId: string): Promise<Result<CampaignSendSummary>> {
  const campaign = await db.emailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return failure(CAMPAIGN_NOT_FOUND, 'That campaign no longer exists.');

  await db.emailCampaign.update({ where: { id: campaign.id }, data: { status: 'SENDING' } });
```

`sendCampaign` flips the row to `SENDING` and iterates recipients regardless of current status. The dedupe key + `EmailCampaignSend` unique constraint prevent duplicate deliveries, so a re-send of an already-SENT campaign is a no-op for mail — but it still walks every subscriber, recounts `recipientCount`, and rewrites `sentAt`/`status` (preserving `sentAt` via `?? new Date()`). The campaign page's Send button is shown for SENT campaigns as "Send to anyone new", so this is by design for late joiners; the gap is that nothing prevents two concurrent presses from both walking the full list. Not a security issue — the idempotency holds — but a status guard (`status === 'DRAFT'` for the full send, or a cheaper "already sent to this subscriber" short-circuit) would avoid the redundant scan.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 (SEC-1, SEC-2) |
| Informational | 3 (SEC-3, SEC-4, SEC-5) |
| **Total** | **5** |

## Notes on what is solid

- **Signed preference tokens** (`src/lib/newsletter/tokens.ts`): HMAC-SHA256 over a purpose-tagged body, `timingSafeEqual` on the signature, 30-day TTL, body parsed only after signature holds, unknown subscriber id returns the same `bad_signature` message as a bad signature (no existence oracle). The purpose string prevents a session cookie being pasted in as an unsubscribe token and vice versa. Solid.
- **Cron bearer auth** (`src/lib/cron/authorize.ts`): empty secret refuses all requests; comparison is hashed-then-`timingSafeEqual` so length mismatch does not leak; 401 returns a plain "Unauthorized" with no job detail; both new endpoints are POST-only and route through `runCronJob`. Solid.
- **Capture mode off-loopback refuse** (`src/lib/env-spec.ts:364–374`): `EMAIL_PROVIDER=capture` and `SMS_PROVIDER=capture` are both rejected unless `APP_URL` is loopback, with the same rule applied to the other stand-ins. The failure mode is loud (boot refusal), not silent. Solid.
- **Provider secret handling**: Resend key and Twilio token live only in env, are read at call time, never logged, never put in URLs (Resend uses `Authorization: Bearer`, Twilio uses Basic auth over the account path). `env-spec` rejects `resend`/`twilio` modes with empty secrets. Solid.
- **IDOR on email hub / unsubscribe**: admin pages all gate on `email.manage` and load all rows (intended for a small org); the unsubscribe/manage pages derive their authority entirely from the signed token, not from any row id in the URL, so there is no id-based IDOR. `loadByToken` returns the same failure for a bad signature and an unknown id. Solid.
- **HTML escaping in letterhead** (`branding.ts`): every donor-controlled or staff-controlled value reaches the markup through `escapeHtml`; `linkify` restricts linkification to `https?://` so `javascript:` URLs in a body are not turned into clickable links. (SEC-1 is the one place this scheme allowlist is missing — at the logo, not the body.)
- **Sweep claim SQL** (`dispatch.ts:113–127`): uses Prisma's tagged-template `$queryRaw` with `${...}` interpolation, which parameterizes — no string concatenation into the SQL. `wallClockUtc` casts through `Prisma.sql`. No injection.
