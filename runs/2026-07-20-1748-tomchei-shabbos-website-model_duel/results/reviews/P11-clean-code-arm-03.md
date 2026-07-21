# P11 Clean-Code Review — arm-03 (external)

Reviewer: external clean-code specialist
Phase: P11 — Email & notification platform
Tree: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-03/workspace`
Scope: P11 delta (new + modified files) against `clean-code.mdc` / `vocabulary.mdc` / `ponytail.mdc`
Mode: findings only — NO fixes

## Summary counts

| Category | Findings |
|---|---|
| Duplicated logic | 2 |
| Inconsistent pattern | 2 |
| Type/schema drift | 1 |
| Dead code | 1 |
| Over-verbose code | 1 |
| Logic (effectiveness) | 1 |
| **Total** | **8** |

All paths relative to the workspace tree root. Only P11-touched files reviewed; pre-existing issues in untouched files are noted as adjacent only where P11 directly depends on them.

## 1. Duplicated logic

### D-01 Cron-route claim/overlap boilerplate repeated 5×
P11 added `src/app/api/cron/outbox-sweep/route.ts` and `src/app/api/cron/purge-email-log/route.ts`, and modified `payment-reminder`, `pickup-expiry`, and `season-auto-flip` routes to share the identical 10-line skeleton:

```8:21:src/app/api/cron/outbox-sweep/route.ts
    requireCronBearer(request);
    const url = new URL(request.url);
    const claimedToken = url.searchParams.get("token") || undefined;
    const claim = await beginCronRun("outbox-sweep", claimedToken);
    if (!claim.claimed) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "overlap",
        token: claim.token,
      });
    }
```

…followed by `await <job>()`, `finishCronRun(claim.run.id, { ok: true, meta: result })`, and the same `{ ok: true, skipped: false, ...result, runId: claim.run.id }` response. Five routes, one shape. Rule of 2 says extract — a `withCronRun(jobKey, handler)` wrapper in `src/lib/cron/runs.ts` would collapse all five to a one-line handler each and remove the drift risk of one route forgetting the overlap check. `purge-email-log/route.ts:7-24` and `outbox-sweep/route.ts:8-26` are byte-for-byte identical except `jobKey` and the job call.

### D-02 `money()` reinvents existing `formatCents`
`src/lib/email/order-emails.ts:117-119` defines a private `money(cents)` = `` `$${(cents / 100).toFixed(2)}` ``. The workspace already has `formatCents(cents)` in `src/lib/storefront/catalog-shared.ts:32` using `Intl.NumberFormat` (proper currency formatting) and re-exports it via `src/lib/storefront/catalog.ts:11`. `money()` is called 3× in this file (confirmation, payment_link, refund) — meets Rule of 2 for the helper, but the helper itself duplicates an existing one with weaker formatting (no locale, string concat). Reuse `formatCents`. (Filed under P11 because `order-emails.ts` is the transactional surface P11 wires up via `enqueueOrderEmail` from `checkout/session.ts` and `payments/webhook.ts`.)

## 2. Inconsistent pattern

### I-01 Dynamic `await import()` where static import suffices
`src/lib/checkout/session.ts:551` and `src/lib/payments/webhook.ts:274` both do `const { enqueuePaymentLinkEmail } = await import("@/lib/email/order-emails")` / `const { enqueueOrderConfirmation } = await import("@/lib/email/order-emails")`. Neither file has a circular-dependency reason to import dynamically — `order-emails.ts` imports `db`, `notify/outbox`, `email/templates`, `result`; none point back at `checkout/session` or `payments/webhook`. Static imports at the top of both files would remove the runtime indirection and make the dependency visible in the import block. Two call sites, same ad-hoc pattern.

### I-02 Mock mode handled in two places
`src/lib/email/purge.ts:72` was changed in P11 to short-circuit `mock` into the capture branch:
```70:73:src/lib/email/purge.ts
  const mode = getEmailMode();
  // capture + mock both avoid live providers (R-090 / S5).
  if (mode === "capture" || mode === "mock") {
```
Meanwhile `src/lib/resend/client.ts:58-64` also handles `mock` (P11 added `captured: true` to the mock return at line 59). So `mock` mode is now owned by both `sendTestEmail` (early return) and `resendSend` (mock branch). The early return in `purge.ts` is redundant — the `live` branch already calls `resendSend`, which returns `captured: true` for mock and writes the log with `status: result.captured ? "captured" : "sent"`. Two code paths own the same mode; the comment frames it as intentional but it duplicates the mock decision.

## 3. Type/schema drift

### T-01 `email-hub.tsx` uses `unknown[]` state with render-time casts
`src/components/admin/email-hub.tsx:11-15` declares all five list states as `unknown[]`:
```11:15:src/components/admin/email-hub.tsx
  const [campaigns, setCampaigns] = useState<unknown[]>([]);
  const [subscribers, setSubscribers] = useState<unknown[]>([]);
  const [lists, setLists] = useState<unknown[]>([]);
  const [templates, setTemplates] = useState<unknown[]>([]);
  const [triggered, setTriggered] = useState<unknown[]>([]);
```
Then casts inline at every render site (lines 189, 211, 243, 256, 272), e.g. `(campaigns as { id: string; name: string; status: string; subject: string }[])`. The `post` helper (line 49) returns `json` from `res.json()` untyped, and callers read `result.json.campaign?.id` with no schema. The admin `/api/admin/email` GET response is shaped in `src/app/api/admin/email/route.ts:28-56` — define one response type per tab and use it on both sides. As-is, the API and UI can drift silently.

## 4. Dead code

### A-01 `writeCronAudit` exported, never called
`src/lib/cron/runs.ts:39-49` exports `writeCronAudit(action, meta)`:
```39:49:src/lib/cron/runs.ts
export async function writeCronAudit(
  action:
    | "NOTIFICATION_SENT"
    | "NOTIFICATION_FAILED"
    | "EMAIL_LOG_PURGED"
    | "EMAIL_CAMPAIGN_SENT"
    | "EMAIL_TEST_SENT",
  meta: Prisma.InputJsonValue,
) {
  await writeAudit({ action, meta });
}
```
No call site anywhere in `src/`. All P11 cron routes and email libs call `writeAudit` directly with `AuditAction.X` enum values. `writeCronAudit` is dead and also uses string literals instead of the `AuditAction` enum (type drift vs. the rest of the codebase). Adjacent to P11 — `runs.ts` is the cron surface P11 routes depend on, but the file itself was not modified this phase.

## 5. Over-verbose code

### O-01 Webhook re-fetches order after the transaction
`src/lib/payments/webhook.ts:265-276` adds a second `db.order.findUnique` (with `include: { customer }`) immediately after the `$transaction` that already fetched `fresh` (line 204) and called `recalcOrderPaymentStatus` (line 245, which returns the new `paymentStatus`). The re-fetch exists only to read `paymentStatusCached` and `customer`:
```265:276:src/lib/payments/webhook.ts
  const paidOrder = await db.order.findUnique({
    where: { id: orderId },
    include: { customer: { select: { email: true, displayName: true } } },
  });
  if (
    paidOrder &&
    (paidOrder.paymentStatusCached === CachedPaymentStatus.PAID ||
      paidOrder.paymentStatusCached === CachedPaymentStatus.OVERPAID)
  ) {
    const { enqueueOrderConfirmation } = await import("@/lib/email/order-emails");
    await enqueueOrderConfirmation(paidOrder);
  }
```
Include `customer` on `fresh` (line 204) and branch on the `paymentStatus` already returned by `recalcOrderPaymentStatus` (line 245) instead of re-querying. Saves one DB roundtrip per paid checkout.

## 6. Logic (effectiveness)

### L-01 Cron overlap guard does not fire for real Vercel Cron
`beginCronRun` in `src/lib/cron/runs.ts:7-23` collides on a unique `claimedToken` (schema: `CronJobRun_claimedToken_key` unique on `claimedToken`, confirmed in `prisma/migrations/20260722050000_p11_email/migration.sql:148`). All five P11 cron routes read the token from `url.searchParams.get("token")` and pass `claimedToken ?? undefined` to `beginCronRun`, which then falls back to `${jobKey}:${randomBytes(12)}`. Vercel Cron invokes the path with no query string, so `claimedToken` is always `undefined` → a fresh random token → always unique → always claims. The overlap guard only triggers when a caller (smoke test, manual) explicitly passes `?token=`. The S4 smoke passes because it supplies `overlapToken` explicitly; real scheduled invocations never collide. If the intent is "one active run per job," the unique should be on `(jobKey, active-window)` or a partial index on unfinished runs — not on a caller-supplied token that real callers don't supply.

## 7. Naming (minor)

### N-01 `cookieHeader` returns a headers object, not a cookie header
`scripts/smoke-p11.mjs:23-25`:
```23:25:scripts/smoke-p11.mjs
function cookieHeader(userId = "dev_manager_1") {
  return { cookie: `dev_user_id=${userId}` };
}
```
The name reads as "give me a Cookie header string"; it returns `{ cookie: ... }` meant to be spread into `fetch` `headers`. Callers do `headers: { ...cookieHeader(), "content-type": ... }`. `devAuthHeaders` or `devCookie` would match the return shape. (Pre-existing pattern across all `smoke-pN.mjs` scripts — P11 continues it.)

---

## Notes

- `src/app/(admin)/admin/email/page.tsx`, `src/app/(storefront)/newsletter/preferences/page.tsx`, and `src/app/(storefront)/newsletter/unsubscribe/page.tsx` are clean — thin server/client wrappers, correct Suspense boundary around `useSearchParams`, no findings.
- `src/components/admin/shell.tsx` nav addition (one line) is consistent with the existing `NAV` array — no finding.
- `vercel.json` cron schedules are staggered (no same-minute collisions across jobs) — no finding.
- `src/lib/resend/client.ts:59` adding `captured: true` to the mock return is a correct fix (callers checking `result.captured` now work in mock mode); the inconsistency it creates with `sendTestEmail`'s early-return is captured in I-02, not here.
