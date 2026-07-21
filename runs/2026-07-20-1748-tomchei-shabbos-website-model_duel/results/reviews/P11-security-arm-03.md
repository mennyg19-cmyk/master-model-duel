# P11 Security Review — arm-03

**Reviewer:** external (security)
**Scope:** arm-03 P11 email / notification changes vs `shared/phases/PHASE-P11-EXPECTED.md`
**Files reviewed:**
- `src/app/api/admin/email/route.ts`
- `src/app/api/cron/outbox-sweep/route.ts`
- `src/app/api/cron/purge-email-log/route.ts`
- `src/app/api/newsletter/{subscribe,unsubscribe,preferences}/route.ts`
- `src/lib/cron/{auth,runs}.ts`
- `src/lib/notify/{outbox,sms}.ts`
- `src/lib/email/{campaigns,order-emails,purge,templates}.ts`
- `src/lib/resend/client.ts`
- `src/lib/storefront/newsletter.ts`
- `src/middleware.ts`, `.env.example`, `.gitignore`

**Method:** static read of P11 changes against the phase EXPECTED checklist (S1–S5) and trust-boundary review. No runtime re-run.

## Findings

| ID | Severity | Location | Claim | Evidence |
|---|---|---|---|---|
| P11-S-01 | Medium | `src/lib/email/templates.ts:39-44` `renderTemplate` | Transactional / campaign email bodies are rendered with raw `{{var}}` substitution and no HTML escaping, so customer-controlled values (`customerName`, `paymentUrl`, `refundAmount`) are injected into HTML email bodies — stored HTML injection in outbound email. | `return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");` — no escaping. `customerName` flows from `order.customer?.displayName` (`order-emails.ts:166-172`) straight into `htmlBody`. Violates S3 "auditable failure trail" integrity and the trust-boundary rule that untrusted input crossing into HTML must be escaped. |
| P11-S-02 | Medium | `src/lib/notify/outbox.ts:306-378` `processClaimedMessage` | Re-fetch after claim checks `status === CLAIMED` but not `claimedBy === workerId`, so under the 2-minute stale-claim window (`CLAIM_STALE_MS`) a second worker can re-claim the same row and both workers deliver — duplicate delivery, contradicting S2/S3 "no duplicate deliveries on retry" and "single delivery + auditable failure trail". | `const row = await db.notificationOutbox.findUnique({ where: { id: rowId } }); if (!row || row.status !== NotifyStatus.CLAIMED) { return { processed: false }; }` — no `claimedBy` check. `claimOutboxMessage` (lines 244-269) re-claims stale rows after 2 min, so the original worker's `processClaimedMessage` still proceeds on a row now owned by another worker. |
| P11-S-03 | Medium | `src/lib/email/purge.ts:16-53` `purgeEmailLogs` | `deleteMany` and the `EMAIL_LOG_PURGED` audit write are not in a transaction; a crash between them deletes logs with no audit trail, and the in-memory `activeIds` set is computed outside the delete so a newly-enqueued active outbox row could race the filter. | `await db.emailLog.deleteMany({ where: { id: { in: ids } } });` then `await writeAudit({ action: AuditAction.EMAIL_LOG_PURGED, ... })` — two separate awaits, no `db.$transaction`. `activeOutbox` is fetched at line 18 and `deleteMany` runs at line 36 with no re-check. Violates S5 "Purge eligible logs without deleting active outbox/audit" (audit side). |
| P11-S-04 | Low | `src/app/api/newsletter/unsubscribe/route.ts:15-24` | The unsubscribe endpoint echoes `reason: result.error` (`malformed` / `expired` / `tampered` / `stale`) back to the caller, leaking token-validation state to an attacker probing signed links. | `return NextResponse.json({ error: pre.publicMessage, reason: pre.error }, { status: 400 });` — `reason` is the internal `Result.error` discriminator. S1 only requires "reject tampered/expired"; the discriminator is not needed for the subscriber. |
| P11-S-05 | Low | `src/app/api/newsletter/preferences/route.ts:31-34` | Preferences updates are audited as `NEWSLETTER_SUBSCRIBED`, mislabeling the event and degrading audit trail accuracy for who changed preferences vs who subscribed. | `await writeAudit({ action: "NEWSLETTER_SUBSCRIBED", meta: { email: result.value.email, id: result.value.id, prefsUpdated: true } });` — no `NEWSLETTER_PREFERENCES_UPDATED` action; the `prefsUpdated: true` flag is the only distinguisher. |
| P11-S-06 | Low | `src/lib/cron/runs.ts:7-13` `beginCronRun` | The overlap-prevention `claimedToken` is read from the URL query string (`?token=...`) and stored in the DB; query strings are logged in reverse-proxy / Vercel access logs, so the overlap token can leak into logs and be replayed to suppress a cron sweep. | `outbox-sweep/route.ts:12` `const claimedToken = url.searchParams.get("token") \|\| undefined;` then `beginCronRun("outbox-sweep", claimedToken)` stores it as `claimedToken` on `CronJobRun`. Replay lets an attacker with log access force `claimed: false` on the next sweep. Bearer auth gates the call, but the token still should not travel in the query string. |
| P11-S-07 | Low | `src/lib/notify/outbox.ts:61-72`, `175-178` | On idempotency-key collision (`P2002`), the existing row is fetched with `findUnique` and asserted non-null (`existing!`); if the row was deleted between the insert attempt and the lookup, the throw surfaces as a 500 with a masked but unhelpful message, and the caller cannot recover the idempotency result. | `const existing = await client.notificationOutbox.findUnique({ where: { idempotencyKey: input.idempotencyKey } }); return { created: false as const, row: existing! };` — no null guard. Same pattern in `captureNotification` (line 66-69). |
| P11-S-08 | Low | `src/app/api/admin/email/route.ts:194-213` `trigger_transactional` | Admin can trigger a transactional email to an arbitrary `recipientEmail` with an attacker-chosen `vars.paymentUrl` that is rendered unescaped into the email body (see P11-S-01), enabling a compromised admin account to phish customers with a Tomchei-branded payment-link email pointing at an external URL. | `recipientEmail: z.string().email()` and `vars: z.record(z.string()).optional()` are accepted without domain scoping; `paymentUrl` defaults to `http://127.0.0.1:3103/checkout` but is overridable to any string. Admin-only, but combined with P11-S-01 the link is also rendered raw. |
| P11-S-09 | Info | `src/app/api/cron/{outbox-sweep,purge-email-log}/route.ts` | Both new cron routes export only `POST`; Vercel Cron invokes `GET`, so on Vercel these jobs would 405 and never run unless invoked manually. Not a security bypass (405 is safe), but a deployment-correctness gap that would leave the outbox sweeper and purge cron inert in production. | `outbox-sweep/route.ts` and `purge-email-log/route.ts` define `export async function POST(request: Request)` only; compare `season-auto-flip/route.ts:32-46` which exports both `GET` and `POST` for the same reason. |
| P11-S-10 | Info | `src/middleware.ts:5-29` | `/api/cron(.*)` is on the public middleware matcher, so cron routes bypass Clerk entirely and rely solely on `requireCronBearer`. This is the documented design (R-182) and `requireCronBearer` is fail-closed when `CRON_SECRET` is unset, but the surface is correct only as long as every cron route calls `requireCronBearer` first — there is no shared enforcement; a future cron route that forgets the call would be public. | `const isPublic = createRouteMatcher([ ..., "/api/cron(.*)", ... ]);` plus `requireCronBearer(request)` is called manually at the top of each route handler, not in a shared wrapper. |
| P11-S-11 | Info | `src/lib/resend/client.ts:50-64`, `src/lib/notify/sms.ts:30-42` | `mock` mode returns `captured: true` indistinguishable from `capture` mode in the result shape, so a misconfigured `EMAIL_MODE=mock` in production would silently swallow sends as "captured" with no provider delivery and no alarm. | `resendSend` mock branch: `return { ok: true, captured: true, providerId: \`mock_${...}\` };` — the `mock_` prefix in `providerId` is the only signal. Same for `smsSend` mock returning `providerId: \`sms_mock_${...}\``. |
| P11-S-12 | Info | `src/app/api/admin/email/route.ts:28-57` GET | The subscribers tab returns up to 200 raw subscriber emails (`db.newsletterSubscriber.findMany`) with no pagination and no field masking; an admin session can bulk-harvest PII. Acceptable for admin scope but worth noting for audit/least-privilege review. | `const subscribers = await db.newsletterSubscriber.findMany({ orderBy: { createdAt: "desc" }, take: 200 });` then `NextResponse.json({ ok: true, subscribers })` — full rows including `email`, `emailNorm`, `preferences`, `tokenVersion`. |

## Counts

- **Total findings:** 12
- **Medium:** 3 (P11-S-01, P11-S-02, P11-S-03)
- **Low:** 5 (P11-S-04, P11-S-05, P11-S-06, P11-S-07, P11-S-08)
- **Info:** 4 (P11-S-09, P11-S-10, P11-S-11, P11-S-12)
- **High / Critical:** 0

## Path

`runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/results/reviews/P11-security-arm-03.md`
