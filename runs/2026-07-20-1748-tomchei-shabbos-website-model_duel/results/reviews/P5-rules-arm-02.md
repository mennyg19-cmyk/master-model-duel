# P5 Rules review — arm-02

Reviewer: Rules specialist (blind to model name).
Scope: P5 build (`arms/arm-02/workspace/`, commit `aa018a5`) against `shared/phases/PHASE-P5-EXPECTED.md`.
Arm rules graded: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`, `grill-protocol`.
Method: read `kit/prompts/reviewer/review-rules.md`; inspected P5 lib/api/components/tests/schema/seed + `.scratch/phase-plan.md`, `.scratch/PHASE-P5-SMOKE.md`, `DECISION-LOG.md`. Findings only — no fixes proposed.

Severity scale: High = rule break with correctness/security impact · Medium = rule break, recoverable or verification gap · Low = style/discipline nit.

---

## High

### H1 — Webhook refund sync listens for non-existent Stripe event types (clean-code Anti-Hallucination; workflow "implement attached plans verbatim")
`app/api/webhooks/stripe/route.ts:65` branches on `event.type === "refund.created" || event.type === "refund.updated"`. Stripe does not emit either event type — the canonical refund event is `charge.refunded`, which is exactly what `.scratch/phase-plan.md` and the plan ref specify ("`charge.refunded` → refund sync (R-168)"). As written, R-168 refund sync never fires under a real Stripe account. The mock gateway only ever emits `checkout.session.completed`, so this path is also unexercised in mock mode — the deviation is invisible to the smoke suite. Hits clean-code § Anti-Hallucination ("Do not invent library APIs… from memory"; "verify it exists in current docs") and workflow § Execution Discipline ("Implement attached plans verbatim — don't edit the plan file or re-create existing todos").

---

## Medium

### M1 — Refund-sync path has no running-app evidence (workflow § Verification; expectation files)
EXPECTED #4 requires "refund sync"; S5 in `PHASE-P5-SMOKE.md` claims it. But the smoke evidence only exercises the *staff-initiated* Stripe refund (`.../refund` → negative POSTED row). The *webhook-driven* refund sync (R-168) is never driven through the running app — no mock event is produced for it, and there is no unit test for `handleRefund`. Workflow § Verification: "never mark done from code alone… every item with evidence from the running app"; the expectation item is checked without evidence for the webhook half.

### M2 — Payment posted and finalize run as separate transactions with no recovery (workflow § Gate discipline / DECISION-LOG)
`handleSessionCompleted` calls `postPayment` (its own `$transaction`) and then `finalizeOrder` (a second `$transaction`) back-to-back. A crash between the two leaves an order DRAFT with a posted payment and no stock reserved. The idempotency ledger then blocks the Stripe retry from recovering, because the event id was already persisted at the top of the handler. No DECISION-P5 entry records this window or a recovery/mitigation plan. Workflow § Execution Discipline requires never silently choosing business logic without logging it, and § Gate discipline treats an unchecked expectation as an incomplete gate.

---

## Low

### L1 — Redundant non-null assertions after a proven early return (clean-code § Anti-AI-Tics / Discipline)
`lib/checkout/create-order.ts:146,149` write `quote.fees!.ok ? quote.fees!.feesCents : 0` and `quote.fees!.ok ? quote.fees!.feeLines : undefined`. Lines 67–73 already return when `!quote.fees || !quote.fees.ok`, so `quote.fees.ok` is guaranteed true here — the `!` assertions and both ternaries are defensive code for a condition that cannot happen. clean-code: "No defensive code for conditions that can't happen" and "No redundant type assertions the compiler already guarantees."

### L2 — `JSON.parse(payload)` unguarded in the webhook (clean-code § Error Handling)
`app/api/webhooks/stripe/route.ts:39` calls `eventSchema.safeParse(JSON.parse(payload))`. The signature is verified first, so risk is low, but a signed non-JSON body makes `JSON.parse` throw → 500 instead of the 400 the route returns for other malformed inputs. Error-handling pattern is inconsistent within the same route.

### L3 — Boolean name `safe` is not a yes/no question (clean-code § Naming)
`app/api/webhooks/stripe/route.ts:95` declares `const safe = …`. clean-code: "Boolean names read as yes/no questions (`isActive`, `hasPermission`)." `safe` doesn't. (The `ok` tag on `FeeResult` is an idiomatic discriminated-union label, not a boolean — not flagged.)

### L4 — `/api/dev/stripe-checkout` has no public guard (workflow § Security Basics)
`app/api/dev/stripe-checkout/route.ts` is a state-changing endpoint (it mints a signed event and drives the real webhook → payment + finalize + stock commit) with neither `guardPublicEndpoint` nor a rate limit. It is gated by `getPaymentGateway().mode !== "mock"` (404 when a real Stripe key is set), so production is safe, but in mock mode any origin can drive an arbitrary `sessionId` to completion. workflow § Security Basics: "Least privilege by default"; the other state-changing public routes (`/api/checkout`, `/api/checkout/quote`) are guarded — this one is the exception with no documented reason.

### L5 — `mock-pay-buttons.tsx` uses raw Tailwind colors outside the token system (clean-code § UI Consistency / Consistency)
`components/checkout/mock-pay-buttons.tsx` uses `bg-indigo-600`, `border-slate-200`, `text-slate-600`, `text-red-600`. The rest of P5 uses the app's design tokens (`bg-surface`, `border-border`, `text-brand`, `text-muted`, `bg-danger/5`). The `/dev/stripe-checkout` page's raw `slate-900` palette is documented as intentional ("Visually distinct from the store on purpose"), but `MockPayButtons` is a shared component with no such justification — violates "One styling approach per project."

### L6 — `line.recipientKey` passed into the checkout form is dead/mismatched data (clean-code § Dead code)
`app/(storefront)/checkout/page.tsx:60-66` maps every `newRecipient` assignment to the literal `"new"`, while `quote.recipients` keys new recipients as `new:<recipient>|<line1>|<zip>` (via `assignmentKey`). The `"new"` value matches no `recipient.key`, and `CheckoutForm` never reads `line.recipientKey` anyway. The field is dead data and a latent footgun if anything later keys off it. clean-code § Anti-AI-Tics: "every line must have a reason" + § Dead code.

---

## Rule adherence summary (not findings)

- **ponytail / dependency ladder:** no Stripe SDK added; gateway is REST-over-`fetch` with a mock fallback, documented as DECISION-P5-1. No god files (largest: `checkout-form.tsx` 337, `create-order.ts` 211, webhook route 198 — all <500). Comments cite rule IDs and explain non-obvious business rules, not narration. Anti-slop tone clean.
- **workflow:** `.scratch/phase-plan.md` written before build with EXPECTED block; `DECISION-P5-1..6` log every silent business-logic choice; `.scratch/PHASE-P5-SMOKE.md` + `PHASE-P5-STATUS.md` present; CI green (41/41 unit + lint + typecheck + migration guard); PowerShell scripts live in `.scratch/*.ps1` (no inline `$`).
- **vocabulary:** no refactor/tidy/rebuild commands in scope; n/a.
- **codegraph:** `.codegraph/` index present in the workspace; no evidence of forbidden grep-for-symbol in the produced artifacts (process not fully auditable post-hoc, but the index the rule requires exists).
- **grill-protocol:** phase-plan shows goal/constraints/approach/validation settled up front; no open product-direction gaps surfaced in P5.

---

## Counts

- **High: 1**
- **Medium: 2**
- **Low: 6**
- **Total: 9**
