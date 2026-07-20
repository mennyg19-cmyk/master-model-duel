# P3 Quality review — arm-01

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Arm: `arm-01`
Phase: P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media
Reference: `shared/phases/PHASE-P3-EXPECTED.md`
Reviewer focus: correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.

## Summary

The P3 storefront, archive, newsletter, admin catalog, media library, and
settings hub are all present and the smoke doc reports S1–S5 passing. The
findings below are quality gaps: a broken optimistic-concurrency path on
archive, PATCH validation holes that can blank required fields, an
`unsubscribedAt` reset bug in the preferences API, missing quick-view
close/escape/focus-trap behavior, an EXPECTED "user menu" that was not
delivered, and smoke hygiene that mutates shared season/seed state without
restoring it.

Findings: **9**

## Findings

### F1 — Archive (DELETE) bypasses the optimistic-version guard used by PATCH
**Severity: medium · Type: broken flow / correctness**

`src/app/api/admin/catalog/route.ts:134` (DELETE) hard-codes
`db.product.update({ where: { id }, data: { isActive: false, version: { increment: 1 } } })`
with no `version` predicate. PATCH (line 97) correctly uses
`updateMany({ where: { id, version } })` and returns 409 on mismatch, but
archive never reads or checks `version`. Two staff archiving the same row
concurrently both succeed, and the client `CatalogManager.archiveProduct`
(`src/components/catalog-manager.tsx:78`) locally guesses
`version: candidate.version + 1` from a response that only contains
`{ archived: true }` — so the next edit on that row will send a stale
version and hit a spurious 409. The version invariant EXPECTED item 6
implies ("optimistic updates, audit entries") is only half-implemented.

### F2 — DELETE on unknown product id throws 500 instead of 404
**Severity: low · Type: broken flow**

`src/app/api/admin/catalog/route.ts:140` calls `db.product.update` with an
unchecked `id` from the query string. If the id does not exist (or is
malformed), Prisma throws `P2025` (record not found), which is not an
`AccessDeniedError`, so `handleCatalogError` re-throws and Next.js returns
a 500. A missing/unknown product should return 404. The same pattern
exists for the `replacementProductId` target on PATCH — no existence or
same-kind validation is performed server-side; the client filter in
`catalog-manager.tsx:225` is the only enforcement and is trivially bypassed.

### F3 — Catalog PATCH allows blanking required `name` and `priceCents`
**Severity: medium · Type: validation gap**

`src/app/api/admin/catalog/route.ts:100` writes
`data: { name: body.name?.trim(), ... priceCents: body.priceCents }`
directly from the body. POST (line 27) rejects missing/blank name and
non-integer/negative price, but PATCH only validates price when it is
defined and never validates `name`. `CatalogManager.updateProduct`
(`catalog-manager.tsx:199` and `:210`) fires PATCH on every `onBlur`,
including an empty name field or a non-numeric price box — the server
will persist `name: ""` and `priceCents: NaN` (Prisma will reject NaN,
but `""` name succeeds). A staff member clearing the display-name input
and tabbing away silently renames the product to an empty string.

### F4 — Newsletter preferences PATCH resets `unsubscribedAt` when `isSubscribed` is omitted
**Severity: medium · Type: correctness bug**

`src/app/api/newsletter/preferences/route.ts:42` writes
`unsubscribedAt: body.isSubscribed === false ? new Date() : null`
unconditionally. Any PATCH that does not include `isSubscribed` (e.g. a
future caller updating only `productUpdates`) sets `unsubscribedAt` to
`null` even though the subscriber may have legitimately unsubscribed
earlier — silently re-subscribing them. The current UI always sends
`isSubscribed`, so the bug is latent rather than user-visible today, but
the API contract is wrong and EXPECTED item 5 (HMAC unsubscribe) depends
on `unsubscribedAt` being preserved.

### F5 — Quick-view modal has no escape, backdrop-close, or focus trap
**Severity: medium · Type: missing UX / a11y**

`src/components/catalog-explorer.tsx:134` renders a `role="dialog"`
`aria-modal="true"` overlay whose only close path is the `×` button
(line 142). There is no `Escape` key handler, no click-on-backdrop
handler (the outer `div` has no `onClick`), no focus move into the
dialog on open, no focus trap, and no scroll lock on `<body>`. EXPECTED
item 3 lists "quick view" as a delivered feature and S1 smoke only
asserts the trigger string renders; the close/keyboard behavior is
untested and broken. A keyboard or screen-reader user cannot dismiss
the dialog without tabbing to the close button.

### F6 — EXPECTED "user menu" in the storefront shell is missing
**Severity: low · Type: regression vs EXPECTED**

`shared/phases/PHASE-P3-EXPECTED.md` item 2 requires the storefront shell
to include "sticky header, desktop nav, mobile menu, **user menu**,
footer signup, storewide closed banner". `src/components/storefront-header.tsx`
delivers sticky header, desktop nav, mobile menu, footer signup (via
layout's `NewsletterForm`), and the closed banner — but there is no
user/account menu; only a "Staff" link to `/admin`. Customer account is
P4, so a full account menu is out of scope, but the EXPECTED line
explicitly lists a user menu for P3 and it is absent. Either the EXPECTED
should have been amended or a placeholder user entry point should exist.

### F7 — Smoke mutates the current-season status and does not restore it
**Severity: medium · Type: smoke hygiene / false confidence**

`.scratch/p3-smoke.ts:25` force-sets the current season to `OPEN` at
start, toggles it `CLOSED`/`OPEN` through S2, and leaves it `OPEN` at
the end (line 57). The original season status is never captured or
restored, unlike S5 which snapshots `originalZipSetting` (line 139).
If the seed or a prior test left the season `CLOSED`, this smoke run
silently flips it to `OPEN` for any subsequent test or reviewer step.
S2's "closed season hides checkout" assertion is therefore exercised
against a season the smoke itself opened, and the post-smoke state
differs from the pre-smoke state — a real regression risk for later
phases that read store status.

### F8 — Smoke leaves orphan rows (product, media asset, newsletter subscriber) in the DB
**Severity: low · Type: smoke hygiene**

`p3-smoke.ts` creates a newsletter subscriber (line 63), a media asset
(line 102), and a catalog product (line 121) and never deletes them.
Only `delivery-zips` is restored (line 157). The created product is
active, kind `PACKAGE`, in the current season, so it permanently
appears in the storefront grid and the admin catalog list for every
later run/review. EXPECTED item 6/3 assume a clean seeded catalog; the
smoke pollutes it with a `Smoke Gift <timestamp>` row and a `smoke/`
media asset, which can skew later aggregate reviews and P4+ catalog
behavior.

### F9 — `getArchivedSeasons` excludes non-CLOSED seasons, so a currently-OPEN past year is invisible in the archive
**Severity: low · Type: correctness / edge case**

`src/lib/storefront.ts:26` filters `where: { status: "CLOSED" }`. The
P3 EXPECTED item 4 says "Past-collections archive (all years, browse
only)". If a prior season is left in `OPEN` (which is exactly what
F7's smoke does, and is a legitimate state during a transition), it
will not appear in `/collections` at all — the archive is "CLOSED
seasons only", not "all past years". Combined with F7, the smoke's
own side effect can hide a real past season from the archive after
the run. Either the archive should key off `year < currentYear` rather
than `status`, or the EXPECTED wording ("all years") should be
reconciled with the implementation.
