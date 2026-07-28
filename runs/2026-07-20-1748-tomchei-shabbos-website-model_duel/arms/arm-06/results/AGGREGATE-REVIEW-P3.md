# P3 Aggregate Review — arm-06 (blind)

**Phase:** Test 4 P3 — storefront, catalog, archive, newsletter, admin catalog & media, settings
**Sources (specialist reviews, blind):** `results/reviews/P3-{security,quality,rules,clean-code}-arm-06.md`
**Method:** Union + dedupe by location+claim. No new findings. Security blockers always survive. Smoke-evidence blocker kept as filed.

## Counts summary

| Band | Security | Quality | Rules | Clean-code | Raw | Deduped |
|---|---|---|---|---|---|---|
| Blocker | 0 | 1 | 0 | 0 | 1 | 1 |
| Major | 4 | 3 | 0 | 1 | 8 | 8 |
| Minor | 6 | 8 | 5 | 5 | 24 | 21 |
| **Total** | **10** | **12** | **5** | **7** | **34** | **30** |

Dedup merges (3):
- Rules M-1 (duplicated SVG glyph, filed Minor) absorbed into Clean-code M1 (same underlying duplication, filed Major) — promoted to Major, tagged `[clean-code, rules]`.
- Rules M-4 + Clean-code m4 (vague `item` in `components/admin/sidebar.tsx:17`) — merged, tagged `[rules, clean-code]`.
- Rules M-2 (vague `result` param) + Clean-code m1 (vague `note` function name) at `settings-tabs.tsx:64` — merged into one naming finding, tagged `[rules, clean-code]`.

Note on B1: Quality reports zero smoke evidence; Rules reports smoke files present and passing. Per aggregation rules, the Quality blocker is kept as filed. The contradiction is flagged for the orchestrator; no finding invented or dropped.

---

## Blockers

### B1. No P3 smoke evidence; phase gate cannot close — `[quality]`
`shared/phases/PHASE-P3-EXPECTED.md` requires `arms/arm-06/workspace/.scratch/PHASE-P3-SMOKE.md` with S1–S5 evidence. Quality review found no `.scratch/` directory, no transcript, no screenshot/curl log; only `scripts/test-p3.mts` helper unit tests (not running-app smoke). Per `workflow.mdc` gate discipline, unchecked smoke rows block the gate. (Rules review asserts the smoke files exist with 23+19 checks exiting 0 — unresolved contradiction; kept as filed per aggregation rule.)

---

## Majors

### M1. Newsletter subscribe returns the HMAC unsubscribe token to any caller — `[security]`
`app/api/subscribe/route.ts` — unauthenticated `POST /api/subscribe` returns `{ managePath: "/unsubscribe?token=<HMAC>" }` for any posted email; `upsertSubscriber` reactivates existing subscribers so the token is minted for already-subscribed addresses too. `POST /api/unsubscribe` only checks the token, no mailbox-ownership proof. Chain: `POST /api/subscribe {email: victim}` → read `managePath` → `POST /api/unsubscribe {token, unsubscribeAll: true}`. Unauthenticated route hands out a bearer credential for an arbitrary victim identity.

### M2. Staff role change has no actor-vs-target rank check — `[security]`
`app/api/admin/staff/[id]/route.ts` PATCH — only guard on `role` is `canTargetStaff` (self-block); no `ROLE_RANK` check like `canImpersonate` enforces. A `staff.manage` holder (default MANAGER, grantable to STAFF via override) can demote any MANAGER (privilege DoS) and promote a co-conspirator STAFF to MANAGER who then elevates the original actor. Inconsistent with the impersonation path's rank enforcement.

### M3. Permission overrides have no self-target block — `[security]`
`app/api/admin/staff/[id]/route.ts` PATCH — `canTargetStaff` applied only to `role` changes; `overrides` array written for any target id including the actor's own. A STAFF who holds `staff.manage` (via granted override) can PATCH their own account and grant themselves `catalog.manage`, `settings.manage`, `staff.impersonate`, `audit.view` — full privilege escalation within the permission system.

### M4. Staff create + revoke have no rank check — `[security]`
`app/api/admin/staff/route.ts` POST and `app/api/admin/staff/[id]/revoke/route.ts` — a `staff.manage` holder can create a new MANAGER account (then confirm its invite to log in as MANAGER) and revoke any MANAGER (server-side session revocation = immediate lockout). Combined with M2/M3, a single misgranted `staff.manage` override is a full takeover path.

### M5. Product create deadlocks on any name that slug-collides with a past-season product — `[quality]`
`app/api/admin/products/route.ts:41-48` derives `slug = slugify(name)` and rejects duplicates with 409; `Product.slug` is globally `@unique` (`schema.prisma:198`). `product-form.tsx` has no slug input, so auto-slug is the only path. A manager creating "Classic Mishloach Manos" in season 2027 hits `slugify → "classic-mishloach-manos"` → 409 with no UI field to set `classic-mishloach-manos-2027`. The POST route already accepts an optional `slug` (`lib/catalog/product-input.ts:10`); the form just doesn't surface it.

### M6. Add-on restriction options differ between create and edit — `[quality]`
`app/(admin)/admin/products/new/page.tsx:17` filters `addOn.findMany({ where: { active: true } })`; `app/(admin)/admin/products/[id]/page.tsx:38` fetches `addOn.findMany({ orderBy: { name: "asc" } })` (no `active` filter). A manager can create with active add-ons only, then on edit attach an inactive add-on to the restriction list. Inconsistent trust-boundary: create and edit apply different rules to the same relation.

### M7. Options-only PATCH silently ignores add-on restrictions; scalar PATCH with omitted `addOnIds` wipes them — `[quality]`
`app/api/admin/products/[id]/route.ts:54-97` — options branch (no `name`) leaves `addOnIds = null`, preserving restrictions (correct for options manager). Scalar branch sets `addOnIds = full.data.addOnIds ?? []` (line 90): any scalar PATCH omitting `addOnIds` silently deletes all product-add-on links. `productInputSchema` makes `addOnIds` optional; UI is safe today (always sends checkboxes), footgun is latent for any other caller.

### M8. Duplicated product image + fallback glyph across storefront pages — `[clean-code, rules]`
The "render first media URL, else package-glyph SVG" block is copy-pasted in three storefront render sites (`packages-grid.tsx:98-110` + standalone `PackageGlyph` at `:228-236`; `past-collections/page.tsx:44-55` inline; `packages/[slug]/page.tsx:58-69` inline), with the same `M12 3l9 5-9 5-9-5 9-5z` SVG path and the same `eslint-disable-next-line @next/next/no-img-element` comment repeated across all three (plus two admin sites). `PackageGlyph` exists but is not exported/reused. Rule-of-2 extraction (3+ call sites): a shared `ProductImage` component would collapse all five sites. Violates `clean-code.mdc` "duplicated UI — extract shared components." (Absorbs Rules M-1, same duplication.)

---

## Minors

### m1. `POST /api/subscribe` has no rate limiting — `[security]`
Uncapped, unauthenticated upsert path; spam/abuse vector; amplifies M1.

### m2. `POST /api/delivery-check` unauthenticated; enumerates delivery-ZIP allowlist — `[security]`
Returns `{ deliverable: bool }` for any 5-digit ZIP; checkout page only publishes the count. Silent bulk brute-force of all 100k ZIPs reconstructs the allowlist.

### m3. Media upload trusts client-declared content-type/extension; no magic-byte sniff — `[security]`
`lib/media/validation.ts` `validateUpload` checks `file.type` (client-set) against allowlist and matches filename extension. A polyglot/misnamed file is accepted and stored under image content-type. Defense-in-depth gap.

### m4. `DEV_AUTH_BYPASS=true` has no runtime production guard — `[security]`
`app/api/dev-auth/route.ts` — when flag is true, any caller can POST any active `staffUserId` and receive a signed session; `/dev-login` lists all active staff ids. `lib/env-spec.ts` defaults to `"false"` and `.env.example` warns, but no `NODE_ENV === "production"` hard-fail. Flag leak = complete auth bypass.

### m5. Role demotion does not clear existing permission overrides — `[security]`
`app/api/admin/staff/[id]/route.ts` — when `role` changes, overrides only rewritten if `parsed.data.overrides` supplied. A demoted MANAGER with `GRANT` overrides (`staff.manage`, `staff.impersonate`) retains them after demotion to STAFF/DRIVER.

### m6. Middleware redirects unauthenticated `/admin` to `/dev-login` which 404s when `DEV_AUTH_BYPASS=false` — `[security]`
`middleware.ts` always redirects to `/dev-login`; `app/dev-login/page.tsx` calls `notFound()` when flag is false. Broken trust-boundary redirect target — unauthenticated admin request lands on 404.

### m7. Homepage impact bar counts are global, not season-scoped; README claims "packages this season" — `[quality]`
`app/(storefront)/page.tsx:46-50` runs unfiltered `prisma.package.count()`, `prisma.order.count({ where: { status: "FINALIZED" } })`, `prisma.customer.count()`. README line 27 claims "packages this season." Labels in code are cumulative; README's "this season" claim is not what the code computes.

### m8. `SettingsTabs.addRate` uses `Math.round(feeDollars * 100)` instead of `dollarsToCents` — `[quality]`
`settings-tabs.tsx:94` does `Math.round(feeDollars * 100)`; `lib/money.ts:9` `dollarsToCents` rejects fractional cents. Settings schema only requires `feeCents: z.number().int().nonnegative()`, so `$1.005` silently rounds to `$1.00`. Only money path that bypasses the clean-cents guarantee.

### m9. `MediaManager` uses raw `fetch` for assign/delete instead of `apiFetch` — `[quality]`
`media-manager.tsx:67` (assign) and `:82` (remove) use raw `fetch` with hand-rolled error parsing when both send JSON and could use `apiFetch`. README documents "Mutations: API routes + `apiFetch`" as the one pattern; only client that deviates for non-multipart calls. (Upload at `:44` uses raw `fetch` legitimately for multipart.)

### m10. `MediaAsset.uploadedById` is plain `TEXT` with no FK; no referential integrity to `StaffUser` — `[quality]`
`migrations/20260728190455_p3_storefront/migration.sql:36` declares `"uploadedById" TEXT` with no `AddForeignKey`; `schema.prisma:589` has `uploadedById String?` with no `@relation`. Deleting a staff user leaves dangling uploader ids. Consistent with audit log's plain-string `actorId` convention; first P3 entity referencing staff without a relation.

### m11. Quick-view dialog has no focus trap and no Escape-to-close — `[quality]`
`packages-grid.tsx:138-205` renders `role="dialog" aria-modal="true"` but traps nothing; focus stays on trigger, Escape doesn't close, only Tab to Close button or backdrop click. clean-code lists a11y under "never cut."

### m12. Replacement-link editor allows backwards links (current season → older) with no direction check — `[quality]`
`product-form.tsx:199-213` populates "Replaced by" from all products except self across all seasons; PATCH route (`api/admin/products/[id]/route.ts:80-88`) only validates `replacedById !== id` and target exists, not that target's season is newer. P10's repeat-order chain walk expects forward links; validation gap locked in now.

### m13. `priceLabel` in `packages-grid.tsx` has a dead branch — `[quality]`
`packages-grid.tsx:32` checks `lowest > product.basePriceCents` but `lowestPriceCents` (line 27) = `basePriceCents + Math.min(0, ...deltas)`, so `lowest <= basePriceCents` always. The `lowest > base` disjunct can never fire; "from" prefix controlled entirely by `product.options.length > 0`. No wrong label, but misleading dead code.

### m14. Closed banner copy assumes a past season exists — `[quality]`
`app/(storefront)/layout.tsx:17-25` shows "browse past collections" whenever `!openSeason`. On a fresh install with zero seasons, banner links to `/past-collections` which renders "No past seasons yet — this is our first year." Circular empty-state copy; not a broken flow.

### m15. Vague naming in `note` helper at `settings-tabs.tsx:64` (function name + `result` parameter) — `[rules, clean-code]`
`function note(result: { ok: boolean; body: { error?: string } }, okMessage: string)`. `note` doesn't describe what it does (it's a status-reporter); `result` is on the banned standalone names list. Rename function to `reportSaveResult` / `setStatusFromResponse`; rename param to `apiResult` / `response`. (Merges Rules M-2 and Clean-code m1, same location.)

### m16. Vague parameter name `data` in `lib/hmac.ts:18` — `[rules]`
`export async function hmacSha256(secret: string, data: string)`. `data` is on the banned standalone list. Borderline (conventional Web Crypto term), but `message` / `payload` would be no worse.

### m17. Vague variable name `data` in `app/api/admin/addons/[id]/route.ts:35` — `[clean-code]`
`const data: { name?: string; priceCents?: number; active?: boolean } = {}` mutated and passed to `prisma.addOn.update`. Holds the patch payload; `patchPayload` / `updateFields` would say so.

### m18. Vague state name `result` in `checkout/zip-check-form.tsx:12` — `[clean-code]`
`const [result, setResult] = useState<{ deliverable: boolean; postalCode: string } | null>(null)`. `result` is on the banned standalone list. `deliveryResult` / `zipCheck` would read as the yes/no question.

### m19. Vague loop variable `item` in `components/admin/sidebar.tsx:17` — `[rules, clean-code]`
`items.map((item) => { ... })`. `item` is on the banned standalone list. Array is `SidebarItem[]` with `href`/`label`; `link` / `navItem` is the obvious rename. (Merges Rules M-4 and Clean-code m4.)

### m20. Silent delete failure in local media driver — `[rules]`
`lib/media/storage.ts:49` — `await unlink(path.join(UPLOADS_DIR, storedName)).catch(() => undefined)`. Idempotent-delete pattern, but `.catch(() => undefined)` swallows every failure including non-ENOENT (EACCES, EBUSY), leaving a `MediaAsset` row deleted in DB but the file still on disk. Narrower `.catch` tolerating only `ENOENT` would honor the rule.

### m21. Swallowed error in settings POST catch — `[clean-code]`
`app/api/admin/settings/route.ts:29-39` — `try { ... } catch { return NextResponse.json({ error: "That value doesn't match..." }, { status: 400 }); }`. Catch binding discarded; real validation/parse error replaced by generic string, so a schema bug or Prisma failure looks identical to bad-shape client input. At minimum log the caught error server-side.

---

## Source index

- `[security]` = `P3-security-arm-06.md` (M1–M4, m1–m6)
- `[quality]` = `P3-quality-arm-06.md` (B1, M1–M3, m1–m8)
- `[rules]` = `P3-rules-arm-06.md` (M-1 absorbed into M8, M-2 → m15, M-3 → m16, M-4 → m19, M-5 → m20)
- `[clean-code]` = `P3-clean-code-arm-06.md` (M1 → M8, m1 → m15, m2 → m17, m3 → m18, m4 → m19, m5 → m21)

