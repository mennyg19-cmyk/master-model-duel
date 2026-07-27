# Test 6 — seeded-bug detection (arm-04)

Tree: `workspace/` (clone of the winning build + seeded bugs). Nothing was fixed; no ledger was read.

Detection stack, in the order it paid off:

1. `npx prisma generate` + `npm run typecheck` → one genuine type error that exposed a dead security branch.
2. `npm test` (78 unit tests, after standing up a clean database) → 6 failures tracing to 2 bugs.
3. `npm run lint` → clean, no findings.
4. Targeted read of the security- and money-critical modules (auth, permissions, cron, Stripe webhook,
   refunds, inventory, rate limit, same-origin guard, checkout totals).
5. Forensics on the tree itself: 6 files carry a write timestamp of `13:54–13:58` today while every other
   source file is dated `07-21`, and exactly those files are also byte-damaged (UTF-8 BOM added and/or
   em dashes double-encoded to `â€"`). That gave a short, high-confidence list of files to read closely.

## Bugs found

| Bug ID | Location | What's wrong | How you found it |
|---|---|---|---|
| B-01 | `lib/routes/driver-access.ts:26` | Driver PIN gate is dead code: `if (!pinCookieValid(access.link.id, value) && false)`. The `&& false` makes the condition unreachable, so `pin_required` is never returned. Anyone holding a forwarded/leaked magic-link URL skips the PIN entirely — `app/d/[token]/page.tsx` renders the route (recipient names, addresses, phones) and `app/api/d/[token]/start` + `.../stops/[stopId]/delivered` accept writes. The PIN lockout in `lib/routes/links.ts` still works but is never invoked from the page flow. | `npm run typecheck` failed with `TS2339: Property 'link' does not exist on type 'LinkAccess'` at line 27 — TypeScript narrowing the unreachable branch. Reading the line showed the `&& false`. |
| B-02 | `lib/checkout/fees.ts:84` | Per-package delivery zip check is inverted: `if (config.deliveryZips.includes(recipient.address.zip))` rejects **in-zone** recipients and silently accepts **out-of-zone** ones. The comment two lines above ("Hard zip block (G-014): out-of-zone cannot select this method at all") states the opposite. Consequences: local customers cannot buy Purim-day delivery, out-of-area addresses are accepted and billed, and because the error short-circuits before `requiresDeliveryDay = true`, the mandatory delivery-day validation is skipped too. | Unit tests 11/12/13 in `tests/checkout-fees.test.ts` failed, one with `'…ZIP 08701 is outside the delivery area'` for a ZIP that is in `deliveryZips`. Missing `!` confirmed by reading. |
| B-03 | `lib/shipping/margin.ts:30` | Margin engine charges the wrong rate: `chargeCents = perCarrierBest[0].amountCents` takes the **cheapest** per-carrier best from the ascending-sorted list instead of the most expensive (`perCarrierBest[perCarrierBest.length - 1]`). Since `buy` is also `perCarrierBest[0]`, `marginCents` is always 0 — the documented pricing rule ("charge the customer the HIGHEST carrier's best price, buy on the cheaper carrier and keep the spread for the tzedakah") is destroyed, so every shipping order loses its margin and the P12 shipping-margin reconciliation report is always zero. | `tests/shipping-margin.test.ts` failures: charge `900` instead of `1200`, `1100` instead of `1900`, and `marginCents > 0` false for the mock ZIP-parity fixtures. |
| B-04 | `lib/public-guard.ts:22` | Same-origin guard fails open: `isSameOrigin()` returns `true` when a request carries neither `Origin` nor `Referer`, while its own docstring says "Requests with neither header are refused." Every public state-changing route that relies on `guardPublicEndpoint` (checkout start, checkout quote, cart/draft mutations, account registration, newsletter, address book) therefore accepts header-less cross-site or scripted requests — the R-122 CSRF control is bypassable by simply omitting the header. | Code read of the security modules; the docstring contradicts the return value. Cross-checked against the build's own P5 smoke evidence, which recorded `POST /api/checkout/quote` without `Origin` → **403** — the current code returns 200. |
| B-05 | `components/checkout/checkout-form.tsx:87-95` (with `21-28`) | The checkout page throws away the server's fresh cart warnings. `QuoteResponse` declares `issues: string[]` and `/api/checkout/quote` returns them (`flattenQuoteIssues`), but the refresh effect only does `setQuote(fresh)` — nothing ever reads `quote.issues`. Blocking problems that appear while the customer sits on the page (price change, stock shortfall, dead product/option) are silently dropped: the Items subtotal and Total quietly change with no explanation, the per-line amounts still show stale SSR prices, and the Pay button stays enabled (`disabled` only covers `isSubmitting`, `feeErrors`, and empty guest fields). The customer only learns anything when `POST /api/checkout` answers 409. The declared-but-unused field plus the still-wired `initialIssues` prop show the surfacing path was removed. | Line-by-line read of the file after the timestamp/encoding forensics flagged it; confirmed the field is unused anywhere in the tree and compared against the sibling `components/admin/pos-checkout.tsx`, which does render `quote.issues` and gates its submit button on the full set of conditions. |

## Secondary observations (same file as B-05, lower confidence)

- `components/checkout/checkout-form.tsx:49-52` pre-selects a method for every recipient
  (`methods.find(kind === "PICKUP")?.id ?? methods[0]?.id`). A customer who never touches the picker
  silently orders **free pickup** for all recipients, and the fee engine's "Choose a delivery method for X"
  validation becomes unreachable from the storefront. The POS panel deliberately does the opposite
  (empty select + "Choose delivery…" + `allChosen` gate), so this may be part of B-05's mutation rather
  than intended behavior.

## Not bugs — environment/clone artifacts (recorded, not fixed)

These blocked the test run and are worth flagging to the orchestrator, but they look like clone/re-port
side effects rather than seeded product defects:

- `package.json` was rewritten with a **UTF-8 BOM**, which makes every Prisma CLI command die with
  `Unexpected token '\ufeff', "\ufeff{ "name"... is not valid JSON`. I stripped it only long enough to run
  `prisma generate`/`migrate deploy` and then **restored the original bytes** (`.scratch/package.json.orig`).
  Whoever fixes bugs next will hit this first.
- `package.json` `migration:guard` still points its shadow database at port **4102**, while this arm runs on
  **4104** (`.env`, `scripts/db-start.ts`). `README.md` also still documents 3102/4102.
- The bundled `node_modules/@prisma/client` was generated from a different schema (1258 type errors until
  regenerated), and the bundled `.pgdata` belongs to a **different application** — its superuser is
  `postgres/postgres`, not `duel`, and its `_prisma_migrations` table lists 15 migrations that do not exist
  in `prisma/migrations`. I left it alone and ran the suite against a fresh `detect` database on the same
  cluster (`.scratch/pg-mkdb.ts`, `.scratch/pg-setup.ts` created the `duel` role); after `migrate deploy` +
  `db:seed` all 22 database-backed tests pass, which is what isolated the 6 real failures.

## Verification state

- `npm run lint` — pass.
- `npm run typecheck` — 1 error, and it is B-01.
- `npm test` — 72/78 pass; the 6 failures are B-02 (3) and B-03 (3).
- Nothing in `workspace/` was fixed. Writes were limited to `workspace/.scratch/` helpers, the regenerated
  Prisma client in `node_modules`, and the new `detect` database.
