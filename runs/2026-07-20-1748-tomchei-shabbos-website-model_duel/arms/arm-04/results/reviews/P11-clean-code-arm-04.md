# P11 Clean-Code Review — arm-04 (blind)

Scope: P11 delta in `arms/arm-04/workspace/` — new files under `src/lib/email/` (`provider.ts`, `resend-api.ts`, `branding.ts`, `one-off.ts`, `subscriber-lists.ts`, `transactional.ts`, `templates.ts`, `campaigns.ts`), `src/lib/notifications/` (`outbox.ts`, `dispatch.ts`, `purge.ts`), `src/lib/sms/` (`provider.ts`, `twilio-api.ts`), `src/lib/messaging/` (`provider.ts`, `capture.ts`), `src/app/(admin)/admin/email/**` (`page.tsx`, `email-tabs.tsx`, `audience-fields.tsx`, `lists/{page,actions}.tsx`, `templates/{page,actions}.tsx`, `outbox/page.tsx`, `campaigns/[campaignId]/page.tsx`, `actions.ts`), `src/app/api/cron/{notification-sweep,email-log-purge}/route.ts`, P11 edits to `src/app/(admin)/admin/settings/{email/page,actions}.tsx`, `prisma/schema/{email,notifications}.prisma`, `prisma/migrations/20260727040000_p11_email_notification_platform/migration.sql`, and `scripts/smoke-p11.ts`.
Findings only — no fixes. No model names; arm id only.

## Summary

- Major: 3
- Minor: 9

## Major

### M1 — `settings/actions.ts` is a growing mixed-concern god file, and P11 made it worse
`src/app/(admin)/admin/settings/actions.ts` is 313 lines owning seven distinct settings domains: store-open (`setStoreOpenAction` + `storeOpenSchema`), order settings (`saveOrderSettingsAction` + `orderSettingsSchema` + `FOLLOW_UP_MESSAGE`), package types (`savePackageTypeAction` + `packageTypeSchema` + `BOX_MESSAGE` + `boxDimension`), pickup locations (`savePickupLocationAction` + `pickupLocationSchema`), shipping (`saveShippingSettingsAction` + `shippingSchema` + `parseDeliveryDays`), email sender (`saveEmailSettingsAction` + `emailSenderSchema` + `senderAddress`), email branding (`saveEmailBrandingAction` + `emailBrandingSchema` + `RETENTION_MESSAGE`), and the email test sender (`sendTestEmailAction`). P11 contributed three of those seven concerns (`saveEmailSettingsAction`, `saveEmailBrandingAction`, `sendTestEmailAction`) plus two schemas and two named validators (`senderAddress`, `RETENTION_MESSAGE`) to an already-mixed file. `clean-code.mdc` splits "when >500 lines **or mixed concerns**"; this file is under the line trigger but trips the mixed-concerns trigger by a wide margin, and every new settings domain added without a split deepens the drift. The email actions in particular have a natural home next to `src/lib/email/` (the way `email/actions.ts` already houses campaign actions) and would shed ~80 lines from this file.

### M2 — `rejectWith` flash-redirect helper duplicated in four P11 action files with two signatures and two flash keys
P11 introduces a `rejectWith` helper in every new action file, with two incompatible shapes and two different query-string keys for the same concept:

- `src/app/(admin)/admin/email/actions.ts:102` — `rejectWith(path: string, message: string): never` → `${path}?problem=${...}`
- `src/app/(admin)/admin/email/lists/actions.ts:80` — `rejectWith(message: string): never` → `${LISTS_PATH}?problem=${...}`
- `src/app/(admin)/admin/email/templates/actions.ts:77` — `rejectWith(message: string): never` → `${TEMPLATES_PATH}?problem=${...}`
- `src/app/(admin)/admin/settings/actions.ts:296` — `rejectWith(path: string, message: string): never` → `${path}?error=${...}`

`clean-code.mdc` names "duplicated logic — pull into `lib/` helpers" and "inconsistent patterns — pick one, apply everywhere." The P9 review (M4) flagged this exact shape for `routes/pickup/drive` actions; P11 reintroduces the same drift in three new files plus a settings file, and adds a second flash key (`?error=` vs `?problem=`) for the same "action failed" concept. The settings/email page reads both: `<SettingsError message={flash.error} />` at line 44 and `<FlashMessages notice={flash.notice} />` at line 45 — one page rendering two error components because the two action files it calls disagree on the flash key.

### M3 — `CampaignSendSummary` is a redundant alias for `OutboxResult` with a parallel counting system
`src/lib/email/campaigns.ts:148` declares `CampaignSendSummary = { queued: number; alreadySent: number; skipped: number }` — field-for-field identical to `OutboxResult` at `src/lib/notifications/outbox.ts:34`. `sendCampaign` (line 150) builds a `CampaignSendSummary` by counting per-recipient outcomes returned from `queueOneRecipient` (line 189 returns `keyof CampaignSendSummary`), which itself translates an `OutboxResult` from `queueMessage` into one of three strings at lines 206-220:

```ts
if (queued.queued === 0) return queued.alreadySent > 0 ? 'alreadySent' : 'skipped';
// …
return 'queued';
```

`sendCampaign` then sums those strings back into a `CampaignSendSummary` at line 165 (`summary[outcome] += 1`). The outbox module already exports `addResults(...results: OutboxResult[])` (line 138) for exactly this summing. So the per-recipient branch + string-keyed counter + `CampaignSendSummary` type is a parallel counting system that duplicates `OutboxResult` + `addResults`. `clean-code.mdc` names "type/schema drift — centralize types, single source of truth" and "duplicated logic — pull into `lib/` helpers." Returning `OutboxResult` from `queueOneRecipient` and `addResults`-ing in `sendCampaign` would retire `CampaignSendSummary` and the string-keyed counter, and the smoke test (`S2d` reads `sentAudit.detail.queued`) would read the same field off the same type the rest of the outbox uses.

## Minor

### m1 — `isUniqueViolation` duplicated three times
`src/lib/notifications/outbox.ts:163-170`, `src/lib/email/campaigns.ts:240-247`, and (pre-P11) `src/lib/catalog/admin.ts` all define the same 7-line `isUniqueViolation(error: unknown): boolean` checking `error.code === 'P2002'`. Rule of 2 is met three times over. A single `isUniqueViolation` in `src/lib/core/prisma.ts` (or extending the existing `db-client.ts`) would give the Prisma error contract one home.

### m2 — Error-message truncation duplicated between `dispatch.ts` and `job-run.ts`
`src/lib/notifications/dispatch.ts:218-221` `describe(error)` and `src/lib/cron/job-run.ts:67-71` `safeMessage(error)` are the same three-line function: `error.message.split('\n')[0].slice(0, N)`, both with `N = 200` (`MAX_ERROR_LENGTH` / `MAX_DETAIL_MESSAGE_LENGTH`). Two sites, two names, two constants, identical body. Extract to `src/lib/core/error-message.ts` and both call sites collapse.

### m3 — `absoluteUrl` helper local to one file while the pattern is used inline in five places
`src/lib/email/transactional.ts:149-151` defines `absoluteUrl(path) { return new URL(path, env.APP_URL).toString(); }` — a one-line helper used once in the same file (line 46). Meanwhile the same `new URL(path, env.APP_URL)[.toString()]` pattern is inlined at `src/lib/email/campaigns.ts:234`, `src/lib/payments/local-gateway.ts:40`, `src/lib/checkout/checkout-service.ts:162`, and `src/lib/payments/local-hosted.ts:95`. `clean-code.mdc`: "One data-fetching pattern per project" and "duplicated logic — pull into `lib/` helpers." The helper exists but is not shared; three of the five sites would use a shared `absoluteUrl(path): string` directly, and the two that need a `URL` object would use a sibling `absoluteUrlObject(path): URL`.

### m4 — `EmailTabs` and `SettingsTabs` are near-identical components
`src/app/(admin)/admin/email/email-tabs.tsx:13-36` `EmailTabs` and `src/app/(admin)/admin/settings/settings-tabs.tsx:12-35` `SettingsTabs` have the same structure, the same `aria-current={tab.href === active ? 'page' : undefined}` pattern, the same active/inactive class strings (`'border-b-2 border-[var(--color-brand)] px-3 py-2 text-sm font-medium text-[var(--color-brand)]'` vs `'px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'`), and the same `<nav aria-label="… sections" className="flex gap-1 overflow-x-auto border-b border-[var(--color-line)]" data-testid="…-tabs">` wrapper. The `EmailTabs` header comment even says "Same shape as the settings tabs, because it is the same kind of hub." `clean-code.mdc` names "duplicated UI — extract shared components." A shared `<TabNav items={…} active={…} ariaLabel={…} testId={…} />` in `components/ui/` would retire both.

### m5 — Two error-flash components and two flash keys for the same concept
`src/components/ui/flash.tsx:10` `FlashMessages` renders `problem` (boxed, `bg-[var(--color-danger-soft)]`), and `src/app/(admin)/admin/settings/settings-tabs.tsx:37` `SettingsError` renders `error` (plain, `text-[var(--color-danger)]`). Both use `role="alert"`. The settings/email page (`src/app/(admin)/admin/settings/email/page.tsx:44-45`) renders both components — `SettingsError` for `?error=` and `FlashMessages` for `?notice=` (with `problem` deliberately omitted). Two error-display components, two query-string keys (`?problem=` vs `?error=`), two visual treatments for "the action failed." `clean-code.mdc`: "one styling approach per project" and "one error-handling approach per project." Either `SettingsError` folds into `FlashMessages` (accepting `error` as an alias for `problem`) or the settings actions switch to `?problem=`.

### m6 — `REQUEST_TIMEOUT_MS = 15_000` duplicated across the two provider adapters
`src/lib/email/resend-api.ts:27` and `src/lib/sms/twilio-api.ts:21` both declare `const REQUEST_TIMEOUT_MS = 15_000` with the same value, the same name, and the same purpose (a send that never answers must not hold a sweep open). `clean-code.mdc` names "magic values — named constants / enums" and "duplicated logic." A shared `PROVIDER_REQUEST_TIMEOUT_MS` in `src/lib/messaging/provider.ts` (which already owns the `MessageProvider` contract both adapters implement) would give the timeout one home and one value if the two channels ever need to diverge.

### m7 — `acceptedId` (Resend) and `acceptedSid` (Twilio) are the same function with the field name swapped
`src/lib/email/resend-api.ts:68-75` `acceptedId` and `src/lib/sms/twilio-api.ts:54-61` `acceptedSid` are structurally identical: read a field off the JSON payload, throw an Error naming the provider if it is not a non-empty string. The only variation is the field name (`id` vs `sid`) and the provider name in the message. Rule of 2 is met. A shared `extractProviderReference(payload, field, provider)` in `src/lib/messaging/provider.ts` would collapse both, the way `MessageProviderError` already collapses the refusal path.

### m8 — `getEmailProvider` and `getSmsProvider` are the same singleton with the env flag and factory swapped
`src/lib/email/provider.ts:15-18` and `src/lib/sms/provider.ts:18-21` are the same 4-line shape: `let provider: MessageProvider | null = null; … provider ??= env.X === 'Y' ? createY() : createCaptureProvider('CHANNEL'); return provider;` with the same module-level `let provider` cache. The two files exist for good reasons (separate `server-only` boundaries, separate env flags), but the selection-and-cache body is duplicated verbatim. A `createChannelProvider({ envFlag, realFactory, channel })` helper in `src/lib/messaging/provider.ts` would let each `provider.ts` be its env check + one call, removing the cache duplication. Borderline under "if removing duplication adds more lines than it saves" — the duplication is ~4 lines per file — but the pattern is now locked in at two sites, which is exactly the rule-of-2 trigger.

### m9 — `deliver` repeats the `message.channel === 'EMAIL'` condition three times
`src/lib/notifications/dispatch.ts:156-161` builds the provider envelope with three ternaries over the same test:

```ts
html:        message.channel === 'EMAIL' ? renderBrandedHtml(branding, { subject: message.subject ?? '', body: message.body }) : null,
sender:      message.channel === 'EMAIL' ? sender : null,
replyTo:     message.channel === 'EMAIL' ? branding.replyToAddress || null : null,
```

`clean-code.mdc`: "No copy-paste patterns with minor variations — extract the pattern." An `emailEnvelope(message, branding, sender)` / `smsEnvelope(message)` pair (or a single `envelopeFor(channel, message, branding, sender)`) would name the two shapes and drop the repeated condition; the `html` branch is the only one with real logic, the other two are field selection.

## Notes (not findings)

- The P9 review (M2) flagged duplicated cron job-body logging and a double-catch between the body and the `runCronJob` wrapper. P11 fixes both: `src/lib/cron/job-run.ts:33-65` `runCronJobBody` now owns the `CronRunLog` row + terminal status, and both P11 job bodies (`dispatch.ts:64`, `purge.ts:34`) go through it. The wrapper (`authorize.ts:45-57`) only does auth + HTTP. Exactly the shape P9 asked for.
- The P9 review (m3) flagged raw `<select>` elements while `<Input>`/`<Label>` were componentized. P11 ships a `Select` from `@/components/ui/field` and uses it in `audience-fields.tsx:20` and `:32`. Both P11 audience selects go through the shared component. The pattern is now consistent on the email hub.
- `src/app/(admin)/admin/email/audience-fields.tsx` is the right application of the rule of 2: extracted because the new-draft form (`email/page.tsx:74`) and the edit form (`campaigns/[campaignId]/page.tsx:96`) need the same two selects with the same options, and the comment at line 6-8 names the constraint that drove the extraction ("a draft cannot be created with an audience it can never be edited to").
- `src/lib/email/resend-api.ts:11-19` and `src/lib/sms/twilio-api.ts:11-18` header comments are exactly the non-obvious-constraint kind `clean-code.mdc` asks for: they explain why the integration is a `fetch` rather than an SDK (one POST, no dependency to audit), and why the carrier's vocabulary stops in one file (swap is one new file + one line in `provider.ts`). The `R-171` / `G-021` tags tie the comments to the plan.
- `src/lib/notifications/dispatch.ts:129-141` `wallClockUtc` is the right kind of one-off helper: it exists to fix a real, non-obvious bug (Prisma `DateTime` is `timestamp`, a bound `Date` arrives as `timestamptz`, and the comparison goes through the session timezone), and the comment says so. Single call site, but the alternative is a SQL fragment repeated three times in the `UPDATE` with no explanation.
- `src/lib/email/campaigns.ts:186-226` `queueOneRecipient` ordering the `emailCampaignSend.create` second inside the transaction — so its unique pair rolls the outbox row back on collision — is the correct idempotency layering for the purge case the comment at lines 208-211 names. The `isUniqueViolation` catch at line 223 is the right fallback, not the primary mechanism.
- `src/lib/email/templates.ts:91-93` `fillPlaceholders` leaving an unknown placeholder standing (and `unknownPlaceholders` at line 96 catching it before save) is the right pair: the editor sees `{{ordreLabel}}` in the preview rather than a silent hole, and the save is refused with a named field. Matches the `clean-code.mdc` error-message rule ("what went wrong AND what the expected state was") at `templates/actions.ts:38-40`.
