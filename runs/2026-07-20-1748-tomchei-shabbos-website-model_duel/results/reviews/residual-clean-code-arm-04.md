# Residual Review — Clean-code (arm-04, Test 5)

**Arm:** arm-04 (blind)
**Tree graded:** `arms/arm-04/workspace/` (post self-fix, full tree)
**Scope:** duplication, naming, god files, pattern drift
**Rule source:** `arms/arm-04/.cursor/rules/clean-code.mdc` (present, `alwaysApply: true`)
**Method:** blind review of the post-fix tree only. Self-review/fix notes were not read.

## Severity summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 3 |

No blockers. No god files >500 lines (largest: `src/lib/env-spec.ts` at 445 lines, `src/lib/orders/order-service.ts` at 407). No dead code, no TODO/FIXME residue, no narration/change-explanation comments. Comment quality across the tree is high — comments explain *why* (constraints, trade-offs, audit rationale) rather than *what*.

## Major findings

### M-1. `isUniqueViolation` helper exists but is bypassed in 4 modules — pattern drift

`src/lib/core/prisma.ts:12` defines `isUniqueViolation(error)` (and `isMissingRecord(error)`), with a comment that explicitly states it was introduced because "three modules had grown their own copy of the P2002 detector and they had already started to drift." The helper is used in `catalog/admin.ts`, `notifications/outbox.ts`, and `email/campaigns.ts`. The inline detector is still in use in:

- `src/lib/customers.ts:36-37`, `:258-259`, `:348-349` (three sites in one file)
- `src/lib/payments/webhook-service.ts:103`
- `src/lib/bootstrap.ts:78`
- `src/lib/seasons/wizard.ts:118`

Each inlines `error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'`. The helper was created to eliminate exactly this drift, and the drift it was meant to prevent is still present. This is the clean-code "one pattern per concern" rule (error-handling approach) violated in the same module that documents the rule.

### M-2. `env-spec.ts` superRefine: 7 near-identical loopback-check blocks + 6 secret-required blocks

`src/lib/env-spec.ts:288-458` repeats two shapes many times with minor message variation:

**Loopback checks** (lines 305-316, 328-336, 348-356, 361-369, 395-405, 422-430, 437-448): each emits an issue of the form `${key}=value is only allowed when APP_URL is a loopback address, but APP_URL is ${env.APP_URL}. <consequence>`. Seven blocks, ~70 lines, all share the same shape: `if (env.X === 'local'/'capture' && !isLoopbackUrl(env.APP_URL)) ctx.addIssue({ path: ['X'], message: ... })`.

**Secret-required-when-provider checks** (lines 297-303, 318-324, 338-344, 371-377, plus the looped 379-389 and 450-457): six blocks of `if (env.PROVIDER === 'X' && !env.SECRET) ctx.addIssue({ path: ['SECRET'], message: 'SECRET is required when PROVIDER=X, but it was empty' })`.

Two helpers — e.g. `requireLoopback(ctx, key, env, consequence)` and `requireSecretWhen(ctx, key, secret, providerKey, providerValue)` — would collapse roughly 130 lines of near-duplicate `addIssue` boilerplate into ~30. The `checkSecretStrength` helper in the same file already proves the pattern. As written, adding a new provider means copy-pasting a 10-line block and editing the message string, which is exactly the "copy-paste patterns with minor variations — extract the pattern" anti-tic in the arm's own `clean-code.mdc`.

## Minor findings

### m-1. Duplicated phone-field schema in `customers.ts`

`src/lib/customers.ts:199-209` (`counterCustomerSchema.phone`) and `:302-311` (`profileSchema.phone`) define the same field verbatim:

```ts
phone: z.string().trim()
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || normalizePhone(value) !== null, {
    message: 'Enter a 10-digit US phone number, or leave it blank.',
  })
```

A single `const phoneField = z.string()...` constant in this module would deduplicate ~10 lines at 2 sites. The `fullName` field (`z.string().trim().min(1, ...).max(120)`) is also repeated across `localSignInSchema`, `counterCustomerSchema`, and `profileSchema` with only the min-length message differing.

### m-2. `result` used as a standalone variable name

`src/app/(storefront)/newsletter-actions.ts:22, :45, :59` declares `const result = await subscribe(...)` / `updatePreferencesByToken(...)` / `unsubscribeByToken(...)`. The arm's `clean-code.mdc` bans `result` as a standalone name (it appears in the banned list alongside `data`, `info`, `temp`, `val`, `item`, `thing`). The type happens to be `Result<T>`, which makes the name read as `result.ok` / `result.value` — but the rule is explicit and the file is the only `actions.ts` in the tree that uses this name; sibling action files use semantic names (`posted`, `voided`, `refunded`, `moved`, `bought`, etc.). Rename to `subscription` / `preferenceSave` / `unsub` to match the rest of the tree.

### m-3. Per-screen `done`/`back` + `X_FILTERS` redirect scaffolding duplicated across admin actions

`src/app/(admin)/admin/orders/actions.ts:214-249` and `src/app/(admin)/admin/fulfillment/actions.ts:274-311` each define their own `X_FILTERS` const, an `xFilters(returnTo)` parser, and `doneAtX`/`backToX` wrappers around `redirectWithFlash`. The shapes are identical; only the path and filter names differ. A small helper like `keepFiltersFrom(returnTo, names)` (and a `flashBack(basePath, filters, message)` pair) would cover both. Only 2 call sites today, so this is at the Rule-of-2 threshold and is borderline — flagged as minor because the duplication is stable and extracting it saves only a few lines, which the discipline rules say to leave alone. Worth revisiting if a third admin screen grows the same shape.

## What was checked and clean

- God files: none >500 lines; the two largest (`env-spec.ts`, `order-service.ts`) are cohesive — one is a single Zod schema + generator, the other is the finalize/transition state machine.
- Dead code / TODO / FIXME: none found in `src/`.
- Narration / change-explanation comments: none found. Comments across `audit.ts`, `order-service.ts`, `address-cleanup.ts`, `import-service.ts`, `flash-redirect.ts`, and `prisma.ts` consistently explain intent and constraints.
- Error handling: one `Result<T>` pattern used consistently; no swallowed catches; `abort()` inside transactions is uniform.
- UI consistency: not in scope for this reviewer (clean-code focus), and no obvious drift observed in passing.
- Dependency discipline: `package.json` not audited for unused/competing deps (out of clean-code scope); no competing internal patterns for HTTP/date/money/state observed — `core/money`, `core/dates`, `core/phone`, `core/normalize`, `core/result`, `transaction` are each the single source for their concern.

## Verdict

The post-fix tree is largely clean: no god files, no dead code, strong comment discipline, and a consistent `Result`-based error approach. The two majors are both forms of pattern drift the arm's own rule file names explicitly — the inline P2002 detector that `isUniqueViolation` was created to replace, and the repeated `addIssue` boilerplate in `env-spec.ts` that the file's own `checkSecretStrength` helper shows how to factor. Neither blocks the gate; both are worth fixing before Test 6.
