# Reviewer specialist — Rules — P11 — arm-06 (blind)

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Tree:** arms/arm-06/workspace/
**Phase:** P11 — Email & notification platform
**Plan ref:** shared/phases/PHASE-P11-EXPECTED.md, shared/MERGED-BUILD-PLAN.md § P11
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph (.cursor/rules/*.mdc)
**Reviewer:** rules specialist, blind to model name
**Scope:** adherence to this arm's selected catalog rules only. Findings only, no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 5 |
| Minor | 8 |
| **Total** | **13** |

Phase coverage against PHASE-P11-EXPECTED.md is complete (all four "must be true" items have code + smoke evidence; S1–S5 reported 42/0). The findings below are rule-adherence defects, not missing features.

---

## Major

### M1. Campaign bulk sends bypass the outbox; the "Send log" claim is false (clean-code § consistency / anti-hallucination: claim vs behavior)
`lib/email/campaigns.ts:117-147` delivers each `EmailCampaignRecipient` inline via `deliverMessage({...})` with a plain object — it never creates an `OutboxMessage` row. Transactional emails (`lib/email/triggered.ts`, `lib/email/order-emails.ts`), campaign test-sends, and the settings test sender all write an `OutboxMessage` first. The hub's "Send log" tab (`components/admin/email/email-tabs.tsx:90-92`) renders `prisma.outboxMessage.findMany` and states "every email/SMS the system sends lands here first and is drained by the outbox sweep cron" — that is false for the one delivery path that moves the most volume (a campaign send to a full list). Campaign deliveries are invisible in the central log; the only per-recipient trail is on `EmailCampaignRecipient` rows in the campaign detail page. Two delivery paths for the same concern (email→provider) with no shared log is the "one pattern per concern" violation, and the UI text is an unverified claim.

### M2. Campaign send has no stale-SENDING recovery; a crash strands recipients forever (clean-code § correctness / workflow § "verify in the running app")
`lib/email/campaigns.ts:110-112` picks candidates with `status: { in: ["PENDING", "FAILED"] }` and the per-row claim (line 120-122) only matches `["PENDING", "FAILED"]`. A recipient left in `SENDING` by a crashed request is never re-claimed — unlike the outbox sweeper (`lib/email/outbox-sweep.ts:31-37`), which recovers stale `SENDING` rows after `STALE_CLAIM_MS`. The final-status check (line 153-155) counts `openWork = PENDING + SENDING`, so a stranded `SENDING` keeps the campaign `FAILED` on every rerun, and reruns never clear it. The "idempotent reruns (no duplicate deliveries)" smoke (S2) only exercises the clean path; the crash-recovery path is untested and broken for campaigns.

### M3. `EmailCampaign.createdById` is a dangling id with no FK relation (clean-code § type/schema drift / data integrity)
`prisma/schema.prisma:1151` declares `createdById String?` on `EmailCampaign` with no `createdBy StaffUser? @relation(...)`. The create route (`app/api/admin/email/campaigns/route.ts:44`) writes `createdById: gate.ctx.staff.id`, but there is no referential integrity and no way to join the campaign to its creator — the column is an orphaned string. Every other audited entity in the codebase uses a real relation or an `AuditLog` row; here the creator id is stored raw with no constraint and no reader. Either drop the column (the `email_campaign_send` audit row already records the actor) or add the relation.

### M4. Triggered-tab UI hides `bodyTemplateOverride`; the per-key body override is unreachable from the hub (clean-code § dead surface / anti-hallucination)
`lib/email/triggered.ts:73` resolves `override?.bodyTemplateOverride ?? override?.template?.bodyText ?? defaults.bodyText`, and the PATCH schema (`app/api/admin/email/triggered/[key]/route.ts:14`) accepts `bodyTemplateOverride`. But `components/admin/email/triggered-tab.tsx:13-20` and the server mapping (`app/(admin)/admin/email/page.tsx:79-89`) never send or render `bodyTemplateOverride` — only `enabled`, `subjectOverride`, and `templateId`. The PHASE-P11-STATUS.md item 1 claims "per-key `EmailTriggeredOverride` rows override subject/body/sender per triggered key"; the body-override half is wired in the backend but unreachable from the UI. A staff member who wants a one-off body for a triggered key must create a reusable `EmailTemplate` and link it — the direct paste path the schema and lib support is dead surface.

### M5. Test-send paths race the outbox sweeper with no claim (clean-code § correctness / idempotency)
`lib/email/campaigns.ts:39-63` (`testSendCampaign`) and `app/api/admin/settings/email-test/route.ts:28-56` create an `OutboxMessage` (default `PENDING`) and then call `deliverMessage(row)` directly without claiming the row first. If the outbox sweep cron fires between the `create` and the inline `update`, the sweeper claims the row (`PENDING → SENDING`) and delivers it, while the inline dispatch also delivers — two provider contacts for one test email, and the inline `update` then clobbers the sweeper's `SENT`/`SENDING` state. The transactional path avoids this by only writing `PENDING` and letting the sweeper be the sole deliverer; the test paths bypass that discipline for a synchronous UI answer. Narrow window, low stakes (a test email), but it is a real double-delivery hole in the "exactly once" law the rest of P11 enforces.

---

## Minor

### m1. `getEmailBranding` throws a raw `Error` while peer config gaps throw `DomainRuleError` (clean-code § one error-handling approach)
`lib/email/render.ts:18` throws `new Error("email.branding is not configured...")`. The sibling guards in `lib/email/outbox-sweep.ts:27`, `lib/email/purge.ts:20`, and `lib/email/campaigns.ts:83` throw `DomainRuleError`, which `mapDomainError` (`lib/http-errors`) maps to a clean response. A raw `Error` escapes the mapper and surfaces as a 500 with a generic message. Same concern, two error shapes.

### m2. `OutboxMessage.kind` and `channel` are free-form strings, not enums (clean-code § magic values / type/schema drift)
`prisma/schema.prisma:1050-1051` stores `kind String` and `channel String`. The vocabularies (`NotificationKind` in `lib/notify/outbox.ts`, `TriggeredKey` in `lib/email/triggered.ts`, `NotificationChannel`) are TS-only; the DB enforces nothing. A typo at write time (e.g. `kind: "order_confirmaiton"`) is silently accepted and invisible until a query filters by the correct key. `OutboxStatus` is an enum; `kind`/`channel` are not, by contrast.

### m3. STATUS doc names a route that does not exist (workflow § expectation files / anti-hallucination)
`PHASE-P11-STATUS.md` item 3 says the payment-link email fires from `POST /api/admin/orders/[orderId]/payment-link-email`. The real route is `app/api/admin/orders/[orderId]/payment-link/route.ts` (no `-email` suffix). The code is correct; the status doc's path is wrong. Same doc also lists `lib/email/campaigns.ts (createCampaign, ...)` — `createCampaign` is not exported (creation is inline in `app/api/admin/email/campaigns/route.ts`).

### m4. `sendCampaign` snapshot loop is N sequential upserts inside one transaction (ponytail § scale / clean-code)
`lib/email/campaigns.ts:93-107` runs `await tx.emailCampaignRecipient.upsert(...)` per member inside `prisma.$transaction`. For a list of thousands this holds the transaction open for N round-trips. The idempotency ledger (unique `[campaignId, subscriberId]`) is the reason for the per-row upsert, but the SKIPPED/PENDING split could be precomputed and written with `createMany(skipDuplicates)` in two batches.

### m5. `deliverMessage` email fallback `subject ?? "(no subject)"` defends a state that cannot happen (clean-code § no defensive code for impossible conditions)
`lib/email/dispatch.ts:35` falls back `message.subject ?? "(no subject)"`. Every EMAIL enqueue path sets `subject` (`triggered.ts:81`, `campaigns.ts:44`, `order-emails.ts`, `settings/email-test/route.ts:33`). The fallback is dead code for the email branch; SMS legitimately has `subject: null`.

### m6. Test-send + settings-test duplicate the create→deliver→update pattern (clean-code § duplicated logic)
`lib/email/campaigns.ts:49-63` and `app/api/admin/settings/email-test/route.ts:43-56` both implement: create outbox row → `deliverMessage` → update `SENT`/`FAILED` with `attempts: 1`. Two real call sites, same shape — a `dispatchOnce(row)` helper in `lib/email/dispatch.ts` would cover both (Rule of 2 satisfied).

### m7. `brandTokens` lets caller tokens shadow `brand`/`footer` (clean-code § latent footgun)
`lib/email/render.ts:27` returns `{ brand: branding.fromName, footer: branding.footerText, ...tokens }`. A caller that passes a `brand` or `footer` token silently overwrites the branding. No current caller does this (tokens are `customerName`, `orderRef`, `amount`, `payUrl`, `manageUrl`), but the spread order makes the branding non-authoritative.

### m8. `sendCampaign` return names `snapshotted` for total membership (clean-code § naming)
`lib/email/campaigns.ts:191` returns `snapshotted: members.length`, which counts all members including unsubscribed (who become `SKIPPED` rows, not snapshotted deliveries). The audit metadata (line 186) records the same. "Snapshotted" implies rows written; the value is the list size. `totalMembers`/`listSize` would be honest.

---

## Rule coverage notes (no finding)

- **codegraph.mdc**: structural lookups in the new `lib/email/*` and `lib/notify/sms.ts` modules were not grepped-for-symbols (reviewer is a subagent without the MCP); findings are based on Read. No codegraph violation is asserted.
- **workflow.mdc § Spec gate / expectation files**: `.scratch/PHASE-P11-STATUS.md` and `PHASE-P11-SMOKE.md` are present and walked item-by-item; expectation-file discipline is satisfied (the path drift in m3 is a content error, not a missing artifact).
- **workflow.mdc § Gate discipline**: lint/typecheck/migration-guard/test:unit/test:domain/build all reported green; smoke S1–S5 42/0 with idempotent rerun.
- **ponytail.mdc § ladder**: Resend and Twilio are hand-rolled on native `fetch` (no `resend`/`twilio` npm dep) — ladder rungs 2–4 honored; comments state the rationale.
- **ponytail.mdc § anti-slop**: comments across the new modules are non-obvious intent (capture-mode honesty, one-claim law, stale-claim recovery, forward-only chain rationale), not narration. No sycophancy or stock vocab in code comments.
- **vocabulary.mdc**: no refactor/tidy/rebuild commands in scope this phase; "add" (new features) followed existing patterns (Card/Button/Input/Select, `apiFetch`, `recordAudit`, `DomainRuleError`, `requireApiPermission`).

## Out of scope

- Reporting, historical migration, scale dress rehearsal (P12).
- Live Resend/Twilio key validation — no keys on this host; fixture double + capture mode is the documented honesty class (same as P5/P8).
