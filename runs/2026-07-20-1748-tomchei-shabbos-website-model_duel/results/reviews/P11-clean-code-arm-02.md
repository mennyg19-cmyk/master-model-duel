# Reviewer specialist — Clean-code

**Arm:** arm-02
**Tree / phase:** P11 — Email & notification platform
**Scope:** `arms/arm-02/workspace/` — `lib/email/*`, `app/api/admin/email/*`, `app/api/cron/*`, `components/admin/email*`, `app/(admin)/admin/email/page.tsx`
**Mode:** Findings only, no fixes. Blind to model name.

Focus: duplication, naming, god files, pattern drift. `clean-code` is in arm rules — review applies.

## Findings by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| Major | 2 |
| Minor | 3 |
| Nit | 2 |
| **Total** | **7** |

## Major

### M1 — Dead `email/types.ts` + duplicated, drifted `EmailHubData`
`components/admin/email/types.ts` exports `EmailHubData`, `CampaignRow`, `SubscriberRow`, `TemplateRow`, `OutboxCounts`, `ActFn` — none are imported anywhere (grep finds only the file itself). Meanwhile `components/admin/email-hub.tsx` declares its own inline `EmailHubData` and `ActFn` (lines 15–39, 84), and `app/(admin)/admin/email/page.tsx` imports the inline one from `email-hub.tsx` (line 4).

Two sources of truth, and they have already drifted:
- `types.ts`: `subscriberCounts: { subscribed; unsubscribed }`, `outboxCounts: OutboxCounts` (typed per-status fields), `subscribers: SubscriberRow[]`.
- `email-hub.tsx`: `subscribedCount` / `unsubscribedCount` (flat numbers), `outbox: Record<string, number>`, no `subscribers` array.

The settings hub does this right — `components/admin/settings/types.ts` is the single source and is actually consumed by `settings-hub.tsx` and the tab components. The email hub should follow the same pattern; instead it forks the shape and leaves the colocated `types.ts` to rot. Either delete `email/types.ts` or (better) make `email-hub.tsx` consume it and reconcile the shapes.

### M2 — `act()` / `ActFn` duplicated across hubs
The `act` helper and its `ActFn` type are defined twice, byte-for-byte identical in shape:
- `components/admin/email-hub.tsx` lines 49–54 (and `ActFn` at line 84)
- `components/admin/settings-hub.tsx` line 25 (with `ActFn` exported from `settings/types.ts` line 48)

Two real call sites today — exactly the rule-of-2 threshold for hoisting. `ActFn` is already shared from `settings/types.ts`; the email hub ignores it and redefines the type inline. The `act()` implementation (setMessage → run → set message → router.refresh on ok) is identical and belongs in a shared admin helper (e.g. `components/admin/use-hub-act.ts` or a `lib/admin-hub` helper).

## Minor

### m1 — `email-hub.tsx` is a god file with mixed concerns
`components/admin/email-hub.tsx` is 392 lines hosting four distinct tab components (`CampaignsTab`, `ListsTab`, `SubscribersTab`, `TemplatesTab`) plus the shell. Each tab has its own state, its own apiFetch calls, and its own data shape. The settings hub splits its tabs into `components/admin/settings/*-tab.tsx` — the email hub should follow the same split. Under the 500-line line count but clearly mixed-concern (the rule flags "mixed concerns" independently of size).

### m2 — Immediate-dispatch pattern duplicated
Two routes build a notification row with `status: "sending"`, `claimedAt: new Date()`, a `Date.now()`-salted `dedupeKey`, then call `dispatchOne(row)` for instant feedback:
- `app/api/admin/email/test/route.ts` lines 22–34
- `app/api/admin/email/campaigns/[id]/test-send/route.ts` lines 27–39

Same shape, same rationale ("enqueue under a unique key, never deduped against the real send, dispatch immediately"). Two call sites — a `dispatchImmediateNotification(...)` helper in `lib/email/dispatch.ts` (next to `dispatchOne`) would remove the duplication and keep the dedupeKey-salt convention in one place.

### m3 — `formatCents` lives in the template registry
`lib/email/templates.ts` line 72 exports `formatCents(cents)` — a money formatter with nothing to do with templates. It is consumed by `lib/email/transactional.ts`. The template module is about the triggered-email registry and `{{token}}` rendering; a currency helper is a different concern and should live with other money helpers (or at least in `lib/email/transactional.ts` if it is the only consumer).

## Nit

### n1 — `campaignValues` computed twice
`lib/email/campaigns.ts` `renderCampaignBody` (lines 23–27) calls `campaignValues(subscriber, token)` for the render, then calls it again in the fallback branch just to recover `preferencesUrl`. Compute once, reuse the `preferencesUrl` field.

### n2 — Magic `500` error slice
`lib/email/dispatch.ts` line 80 slices the error message to `500` chars inline. The `lastError` column length is a schema constraint — name it as a constant next to `MAX_ATTEMPTS` / `BATCH_SIZE` so the bound is traceable to the column width.

## Notes (not findings)

- Provider/dispatch/cron layering is clean: Resend stays behind `lib/email/provider.ts` (R-171 honored), outbox state machine is single-path, cron routes share `requireCronAuth` + `runCronJob` consistently.
- Idempotency story is solid throughout (`dedupeKey` on campaign send, order lifecycle, refund; conditional claim in `sweepNotificationOutbox`).
- `BACKOFF_MINUTES`, `STALE_CLAIM_MS`, `BATCH_SIZE`, `MAX_ATTEMPTS` are all named — good.
