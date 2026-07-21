# Reviewer specialist — Rules

**Arm:** arm-02
**Tree / phase:** P11 — Email & notification platform
**Arm rules list:** ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
**Output:** `results/reviews/P11-rules-arm-02.md`

Findings only, no fixes. Blind to model name. Grades adherence to this arm's selected catalog rules only.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 5 |
| Low | 5 |
| **Total** | **11** |

## High

### H1 — `EmailHubData` type drift (clean-code: type/schema drift)
The same type name is defined twice with **different shapes**:
- `components/admin/email/types.ts:39-46` — `EmailHubData` with `subscribers: SubscriberRow[]`, `subscriberCounts: { subscribed; unsubscribed }`, `outboxCounts: OutboxCounts`.
- `components/admin/email-hub.tsx:15-39` — `EmailHubData` with `subscribedCount: number`, `unsubscribedCount: number`, `outbox: Record<string, number>`.

`app/(admin)/admin/email/page.tsx:20-44` builds the `email-hub.tsx` shape, so the `types.ts` version is stale/wrong. Two sources of truth for one concept; a downstream tab component importing from `types.ts` would silently get the wrong fields. Single source of truth violated.

## Medium

### M1 — Dead file: `components/admin/email/types.ts` (clean-code: dead code; ponytail: deletion over addition)
Zero imports of `admin/email/types` anywhere in the workspace. Every export (`CampaignRow`, `EmailListRow`, `SubscriberRow`, `TemplateRow`, `OutboxCounts`, `EmailHubData`, `ActFn`) is unused. Either wire it in (make it the single source for H1) or delete it.

### M2 — Duplicated `formatCents` (clean-code: duplicated logic; workflow: reuse existing helpers)
`lib/email/templates.ts:72-74` re-implements `lib/catalog.ts:52-54` byte-for-byte (`$${(cents / 100).toFixed(2)}`). `lib/email/transactional.ts:6` imports the duplicate from `templates` instead of the canonical helper in `catalog`. An existing helper was forked rather than reused.

### M3 — Duplicated `act` / `ActFn` across hubs (clean-code: duplicated logic; Rule of 2)
- `act` body is identical in `components/admin/email-hub.tsx:49-54` and `components/admin/settings-hub.tsx:25-30`.
- `ActFn` is declared three times: `email-hub.tsx:84`, `components/admin/settings/types.ts:48`, `components/admin/email/types.ts:49`.

Three real call sites now — past the Rule of 2 threshold. Extract a shared hub-mutation helper + type.

### M4 — SMS capture gated on `EMAIL_TEST_MODE` (clean-code: naming; consistency)
`lib/sms/provider.ts:59` reads `env.EMAIL_TEST_MODE` to decide SMS capture mode. An email-named flag silently governing SMS delivery is misleading — a reader expects `EMAIL_TEST_MODE` to affect email only. Coupling two channels through one flag also means you cannot capture email while sending SMS (or vice versa). A shared `NOTIFICATION_TEST_MODE` (or a dedicated `SMS_TEST_MODE`) would not mislead.

### M5 — Inconsistent P2002 detection pattern (clean-code: one error-handling approach per project)
- `lib/notifications.ts:32` — `(error as { code?: string }).code === "P2002"` (structural cast).
- `app/api/admin/email/lists/route.ts:32` — `error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"` (instanceof).

Both handle the same Prisma unique-constraint case in the same phase; pick one and apply it everywhere.

## Low

### L1 — Repeated `<textarea>` class string (clean-code: repeated class strings)
`block w-full max-w-2xl rounded-md border border-border bg-background px-3 py-2` appears at `components/admin/email-hub.tsx:123` and again at `:342`. Tokenize or componentize.

### L2 — `act` is a vague name (clean-code: naming)
`act` doesn't describe what it does (run a mutation, surface its outcome, refresh on success). `runMutation` / `mutateAndReport` reads clearer. Borderline; flagged for consistency with the naming rule.

### L3 — Magic page-size constant (clean-code: magic values)
`app/api/admin/email/subscribers/route.ts:13` — `take: 200` with no named constant. A `SUBSCRIBER_PAGE_SIZE` (or a real pagination cursor, since 200 is a silent cap) would make the limit visible.

### L4 — `renderCampaignBody` calls `campaignValues` twice on the fallback path (ponytail: minimum code)
`lib/email/campaigns.ts:23` already calls `campaignValues(subscriber, token)` to render. Line 27 calls it again to read `preferencesUrl`. The token is deterministic so there is no correctness bug, but the second call is redundant work and obscures that only `preferencesUrl` is needed.

### L5 — Subscriber search lowercases query but not column (clean-code: consistency; correctness-adjacent)
`app/api/admin/email/subscribers/route.ts:9-11` lowercases `q` then runs `email: { contains: query }`. On case-sensitive Postgres, `contains` does not fold case, so uppercase-stored emails are unreachable from a lowercase search. Either use `mode: "insensitive"` or store emails lowercased on capture. Not a direct rules-category hit, but worth noting.

## Rules not flagged (intentional)

- **codegraph / grill-protocol / vocabulary**: process rules; nothing in the static output proves a violation, and the phase had an EXPECTED file (spec gate satisfied). No finding.
- **God files**: largest new file (`email-hub.tsx`) is 392 lines — under the 500 / mixed-concerns threshold.
- **Comments**: comments across `lib/email/*` and the cron routes explain non-obvious constraints (idempotency keys, claim semantics, WIN1252 safety, fail-once hooks) — within the comment-quality rule.
- **Cron auth**: both cron routes use `requireCronAuth` + `runCronJob` consistently (S4 supported).
- **G-021 SMS wiring**: `lib/sms/provider.ts` + `notifyCustomer` in `lib/notifications.ts` reuse the P9 outbox for SMS — matches P11 §4.
