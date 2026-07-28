# P2 Clean-Code Review — arm-06 (blind)

**Scope:** new P2 domain/schema/engine code under `arms/arm-06/workspace/` —
`lib/customers/dedupe.ts`, `lib/inventory/reserve.ts`, `lib/orders/{create-draft,numbers,state-machine}.ts`,
`lib/packages/{grouping,stages}.ts`, `lib/payments/post.ts`, `lib/phone.ts`, `lib/seasons.ts`,
`prisma/schema.prisma` (P2 section), `prisma/migrations/20260728164419_domain_core/migration.sql`,
`prisma/seed.ts`, `scripts/test-*.mts`.

**Focus:** duplication, naming, god files, pattern drift. Findings only — no fixes.
**Severity bands:** Blocker / Major / Minor. File paths cited.

---

## Blockers

None. The P2 code is internally coherent, compiles against the schema, and the
concurrency primitives (row-level `FOR UPDATE`, conditional `updateMany` CAS) are
correct.

---

## Major

### M1. Pattern drift: typed action union vs free-string action field
`lib/audit.ts:4-14` defines a typed `AuditAction` union and funnels every
audit write through `recordAudit`, so `AuditLog.action` can only ever hold a
known literal. The new `PackageEvent.action` column is `String` in
`prisma/schema.prisma:384` and is written as a raw `"stage_advance"` literal in
`lib/packages/stages.ts:68` with no corresponding union or helper. Two different
typing disciplines for the same kind of field (event/action discriminator) in
the same codebase — violates "one pattern per concern" (`clean-code.mdc`
Consistency). Either both should be typed unions, or both free strings; the
current split lets `PackageEvent.action` drift untyped as more event kinds land.

### M2. Pattern drift: plain `Error` for domain failures vs custom error classes
The new P2 files declare four custom error classes
(`InsufficientStockError`, `IllegalTransitionError`,
`IllegalStageTransitionError`, `PackageConcurrencyError`) but then throw plain
`new Error("…not found")` for the adjacent "not found" / "wrong state" cases:
`lib/inventory/reserve.ts:18,34`, `lib/orders/create-draft.ts:27,28`,
`lib/orders/state-machine.ts:34,58`, `lib/packages/stages.ts:54`,
`lib/payments/post.ts:48`. Callers can `instanceof`-match the custom errors but
have no way to distinguish a missing-row failure from any other plain `Error`.
One error-handling approach per project — pick either custom classes for all
domain failures or plain errors for all, and apply it everywhere.

### M3. Naming collision: `lib/season.ts` vs `lib/seasons.ts`
Two files differing by a trailing `s` carry unrelated season concerns:
`lib/season.ts` exports `getSeasonYear(date)` (Purim year computation, used by
`app/(storefront)/page.tsx:3`); `lib/seasons.ts` exports `getOpenSeason()`
(DB lookup of the single open season). The singular/plural split does not
signal the concern difference and is easy to import wrong. Consolidate under a
`lib/seasons/` folder (`year.ts`, `queries.ts`) or rename to distinct
intent-revealing names (`lib/season-year.ts`, `lib/open-season.ts`).

### M4. `getOpenSeason` has no call site (Rule of 2)
`lib/seasons.ts:6` `getOpenSeason()` is new P2 code with zero importers
(grep across `workspace/` finds only the definition). `clean-code.mdc`
Abstraction Discipline / Rule of 2 requires 2+ real call sites now, not "might
be useful later." Either wire it into the draft-order path that currently
re-fetches the season (`lib/orders/create-draft.ts:26` takes a `seasonId`
string and re-validates — it could take the open season directly) or drop it
until a real consumer lands.

### M5. Re-fetch + `as` cast pattern repeated three times
`lib/orders/state-machine.ts:50-51`, `lib/packages/stages.ts:74-75`, and
`lib/payments/post.ts:37-39` all do the same shape: `updateMany` (or
`update`) → `findUnique` → `as Entity` to strip the `null`. The `as` is not a
redundant compiler assertion — `findUnique` genuinely returns `T | null`, so
the cast hides a real "row vanished mid-transaction" possibility that should
either be checked or be impossible by construction. Three near-identical
sequences is a Rule-of-2 extraction candidate (e.g. a `reloadOrThrow(tx, id)`
helper), and the unchecked cast is a latent bug.

---

## Minor

### m1. Duplicated line-total expression
`lib/orders/create-draft.ts:32-34` (order `totalCents` reduce) and
`lib/orders/create-draft.ts:53` (per-line `lineTotalCents`) both compute
`line.qty * (line.unitPriceCents + (line.optionPriceDeltaCents ?? 0))`. Two
call sites now — extract `lineTotalCents(line)`.

### m2. Magic string `"pickup"` as a grouping-key sentinel
`lib/packages/grouping.ts:16` uses `input.recipientAddressId ?? "pickup"` as
the address component of the grouping key. A bare literal collides with any
future `addressId` that happens to equal `"pickup"` and is ungrepable. Named
constant (e.g. `PICKUP_ADDRESS_SENTINEL`).

### m3. Magic prefixes `"MM-"` and `"D-"` in number formatters
`lib/orders/numbers.ts:9,13` hardcode the wire-format and draft-ref prefixes.
These are domain constants (referenced by tests at
`scripts/test-order-numbers.mts:35,46`) and would be safer as named exports
alongside the formatters.

### m4. Duplicate import lines from `@prisma/client`
`lib/payments/post.ts:1-2` has two separate `import … from "@prisma/client"`
lines. Merge into one.

### m5. `seed.ts` mixes upsert and count-then-create idempotency
`prisma/seed.ts:14-125` uses `upsert` for every catalog row, but then
`prisma/seed.ts:133-145` (address) and `prisma/seed.ts:148-165` (order) switch
to `count === 0` → `create`. The count-then-create pattern is TOCTOU-prone and
inconsistent with the file's own upsert discipline. Address can upsert on
`[customerId, label]`; the order case is harder (no natural unique key for a
draft) but deserves a comment explaining why it diverges.

### m6. Nested ternary chain for payment-status classification
`lib/payments/post.ts:54-55` classifies `UNPAID | PARTIAL | PAID | OVERPAID`
via a three-deep nested ternary. Borderline against the "more than 3 levels of
nesting" anti-AI-tic and harder to read than a small helper
(`classifyPaymentStatus(paidCents, totalCents)`), which would also be the
natural place for the equality/epsilon policy once real money rounding lands.

### m7. Unvalidated `Json` → `PackageStage[]` cast
`lib/packages/stages.ts:56` casts `pkg.fulfillmentMethod.stages as
PackageStage[]` straight from a `Json` column. If a method row ever holds
garbage or an unknown stage name, `canAdvanceStage` silently returns `false`
and the package appears stuck with no diagnostic. A runtime validate-or-throw
on read would make the data-driven design safe against bad seed/migration
data.

### m8. Duplicate `qty must be positive` guard
`lib/inventory/reserve.ts:14,30` both open with `if (qty <= 0) throw new
Error("qty must be positive")`. Two call sites — a `assertPositiveQty(qty)`
helper would dedupe, and the error would then be a named class consistent with
M2.

### m9. `dedupe.ts` comment promises concurrency safety the phone arm lacks
`lib/customers/dedupe.ts:6-8` claims the engine is safe under concurrency
because "the unique email index backs the email arm." That covers the email
arm. The phone arm matches on `normalizedPhone`, which is only an *index*
(`prisma/schema.prisma:129` `@@index`, not `@unique`) — two concurrent signups
sharing only a phone number can both pass `findFirst` and both `create`. Either
the comment should narrow its claim to email, or `normalizedPhone` should be
`@unique` if phone dedupe is meant to be race-safe.

### m10. `normalizePhone` empty-string return silently re-normalized
`lib/phone.ts:5` returns `""` for an all-non-digit input, and
`lib/customers/dedupe.ts:29` does `normalizedPhone: normalizedPhone || null`
to coerce that empty string back to `null`. The double normalization is
correct but obscure — `normalizePhone` returning `null` (or throwing on
empty) would remove the `|| null` follow-up at the call site.

---

## Summary

| Band   | Count |
|--------|-------|
| Blocker | 0     |
| Major   | 5     |
| Minor   | 10    |

The strongest theme is **pattern drift** (M1, M2, M5): the new P2 files
introduce conventions (free-string action, plain `Error` for not-found,
re-fetch-and-cast) that conflict with conventions already established in
`lib/audit.ts` and with each other. Locking those three down before P3 will
keep the domain layer coherent as it grows.
