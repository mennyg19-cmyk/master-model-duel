# Residual Clean-code Review — arm-06 (Test 5, blind)

Scope: `arms/arm-06/workspace/` post-fix tree. Findings only — no self-review/self-fix
notes were read. Graded against `arms/arm-06/.cursor/rules/clean-code.mdc`
(duplication, naming, god files, pattern drift, abstraction discipline, comment
quality, error handling, anti-AI-tics, consistency, dependency discipline).

## Summary counts

| Metric | Count |
|---|---|
| Total findings | 7 |
| Medium | 2 |
| Low | 5 |
| High | 0 |
| Duplicated logic | 5 |
| Pattern drift | 1 |
| Magic values | 1 |
| God files (>500 lines / mixed concerns) | 0 |
| Dead code | 0 |
| Naming violations | 0 |
| Comment-quality issues | 0 |
| Error-handling inconsistencies | 0 |
| Anti-AI-tics | 0 |
| Barrel files | 0 |
| Wrapper components <5 JSX lines | 0 |

## Findings

### F1 — Duplicated `normalizedAddressKey` (medium, duplication)

`lib/routes/geo.ts` exports `normalizedAddressKey`; `lib/shipping/labels.ts`
re-declares a **local** `normalizedAddressKey` with an identical body.

```40:51:lib/routes/geo.ts
export function normalizedAddressKey(source: {
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}): string {
  return [source.line1, source.line2 ?? "", source.city, source.region, source.postalCode, source.country]
    .map((part) => part.trim().toLowerCase())
    .join("|");
}
```

The labels.ts copy differs only in the `line2` type annotation (`string | null`
vs `string | null | undefined`) and is otherwise byte-identical. labels.ts
already imports from `lib/routes/geo.ts` elsewhere in the codebase — the local
copy should be dropped in favor of the shared export. Two real call sites, same
function: textbook Rule-of-2 violation.

### F2 — Duplicated auth-session scaffolding (medium, duplication)

`lib/auth.ts` (staff) and `lib/customers/session.ts` (customer) are
near-parallel implementations. Both define, with identical bodies:

- a `*Context` interface
- `get*Session()`
- `get*Context = cache(async () => …)` (same DB-row + expiry + revocation check)
- `require*()` → `redirect(isDevAuthBypass ? "/dev-login" : "/")`
- `requireApi*()` → same `{ ok: true; ctx } | { ok: false; response: 401 }` gate
- `create*LoginSession()` — identical IP (`clientIp`) + userAgent + `expiresAt`
  arithmetic
- `revoke*LoginSession()` — identical `updateMany({ where: { id, revokedAt: null }})`
- `*CookieOptions()` — identical `httpOnly / sameSite lax / path / secure / maxAge`
- `issue*SessionResponse()` — identical cookie-set
- `clear*SessionResponse()` — identical cookie-clear

The signed-JSON codec is already shared (`lib/session-codec.ts`), but the
surrounding cookie/session/require scaffolding is copy-pasted. Two real call
sites today; a parameterized `buildSessionAuth({ cookieName, ttlHours, load })`
helper would collapse ~9 parallel functions into one.

### F3 — "Is provider configured?" checked four different ways (low, pattern drift)

One pattern per concern is violated across the four provider wrappers:

- `lib/notify/sms.ts` exports `isSmsConfigured()`.
- `lib/email/resend.ts` does **not** — callers inline
  `const { apiKey } = getResendConfig(); if (!apiKey)` (`lib/email/dispatch.ts`).
- `lib/payments/stripe.ts` does **not** — callers inline
  `getStripeConfig().secretKey !== null` (`lib/checkout/submit.ts`).
- `lib/shipping/shippo.ts` signals it by returning `null` from
  `getShippoConfig()`.

Pick one (either `is*Configured()` everywhere, or `get*Config(): X | null`
everywhere) and apply it to all four.

### F4 — Provider config-cache memo pattern duplicated 3x (low, duplication)

`lib/payments/stripe.ts`, `lib/email/resend.ts`, and `lib/notify/sms.ts` each
repeat the same `let *ConfigCache = null; function get*Config() { if (!cache) { cache = {…} } return cache }`
shape. `lib/shipping/shippo.ts` intentionally skips the cache (documented: env
already snapshots once) — which makes the inconsistency starker. A tiny
`memoizeConfig(builder)` helper would remove the boilerplate and make the
"why is shippo different" decision an explicit opt-out.

### F5 — `addressDedupeKey` vs `normalizedAddressKey` divergent normalization (low, duplication / drift)

`lib/customers/addresses.ts` `addressDedupeKey` and `lib/routes/geo.ts`
`normalizedAddressKey` share the same "join line1|line2|city|region|postal|country,
lowercase" shape but normalize differently:

- `addressDedupeKey` uses `normalizeWhitespace(part).toLowerCase()` (collapses
  internal runs of whitespace).
- `normalizedAddressKey` uses `part.trim().toLowerCase()` (edge trim only).

A user typing `"123  Main St"` and `"123 Main St"` dedupes in the address book
but produces **different** geocode cache keys (and different route-grouping
keys). The two functions look interchangeable but aren't; the divergence is a
latent correctness seam, not just style.

### F6 — Session TTL magic value duplicated (low, magic values)

`SESSION_TTL_HOURS = 12` in `lib/auth.ts` and
`CUSTOMER_SESSION_TTL_HOURS = 12` in `lib/customers/session.ts`, both
documented as "the same 12h". Two sources of truth for one documented value.
Collapse to a shared constant (related to F2).

### F7 — `claimOrderNumber` / `claimDraftRef` near-identical claim (low, duplication, borderline)

`lib/orders/numbers.ts` defines two atomic UPDATE-→-RETURNING claim helpers
that differ only by the column being incremented/read. Borderline: each is
~8 lines, stable, and column-specific. Per the discipline rule ("if removing
duplication adds more lines than it saves and the code is stable, leave it"),
this is acceptable as-is — noted for completeness, not a required fix.

## Strengths (not counted as findings)

- **No god files.** Largest modules (`lib/print/pdf.ts` 338, `lib/shipping/shippo.ts`
  295, `lib/imports/engine.ts` 230, `lib/checkout/submit.ts` 223) are each
  single-concern.
- **Comment quality is high.** Comments explain *why* — business rules,
  concurrency invariants, security properties — and carry consistent
  traceability refs (R-/G-/UR-/M-/P-). No narrating comments, no dead TODOs.
- **One error-handling approach.** `NotFoundError` / `DomainRuleError` shared;
  domain errors colocated; single `mapDomainError` ladder in `lib/http-errors.ts`.
- **Naming is consistent** (`getX` / `requireX` / `assertX` / `canX` / `isX` /
  `normalizeX` / `claimX` / `reserveX` / `releaseX` / `commitX`), file-per-concern.
- **Dependency discipline is clean** — no `stripe`/`shippo`/`resend`/`twilio`
  npm packages; every provider is native `fetch` behind one module
  (the documented "ponytail ladder"). No barrel files.
- **Centralized primitives** — `lib/dates.ts`, `lib/money.ts`, `lib/text.ts`,
  `lib/hmac.ts`, `lib/client-ip.ts` each own one concern.
