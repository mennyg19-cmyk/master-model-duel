# Reviewer specialist — Clean-code

**Arm:** `arm-01`
**Tree / phase:** P4 — Cart-first order builder, address book, customer account (`arms/arm-01/workspace/`)
**Rules:** `arms/arm-01/rules/clean-code.md`
**Output:** `results/reviews/P4-clean-code-arm-01.md`

Focus: duplication, naming, god files, pattern drift. Findings only.

---

## Findings — 9

### F1. Duplicated address-book query (Rule of 2 met)
The identical `db.customerAddress.findMany({ where: { customerId }, orderBy: [{ label: "asc" }, { recipientName: "asc" }] })` query is copy-pasted across three call sites:

```25:30:src/app/(storefront)/order/page.tsx
    const addresses = account?.customerId
      ? await db.customerAddress.findMany({
          where: { customerId: account.customerId },
          orderBy: [{ label: "asc" }, { recipientName: "asc" }],
        })
      : [];
```

Also in `src/app/(storefront)/account/addresses/page.tsx:10-13` and `src/app/api/account/addresses/route.ts:25-28`. Extract a `getCustomerAddresses(customerId)` helper into `lib/customer-access.ts` (already the customer-domain module) and call it from all three. Risk otherwise: orderBy drift the next time someone wants to change sort order.

### F2. Duplicated line unit-price calculation — client/server drift risk
`order-builder.tsx` computes the subtotal inline:

```220:234:src/components/order-builder.tsx
  const subtotalCents = useMemo(
    () =>
      lines.reduce((total, line) => {
        const product = products.find((candidate) => candidate.id === line.productId);
        if (!product) return total;
        const optionPrice =
          product.options.find((option) => option.id === line.productOptionId)
            ?.priceAdjustmentCents ?? 0;
        const addOnPrice = product.addOns
          .filter((addOn) => line.addOnIds.includes(addOn.id))
          .reduce((addOnTotal, addOn) => addOnTotal + addOn.priceCents, 0);
        return total + (product.priceCents + optionPrice + addOnPrice) * line.quantity;
      }, 0),
    [lines, products],
  );
```

The server re-implements the same formula in `src/app/api/order/drafts/[draftId]/route.ts:134-138`:

```134:138:src/app/api/order/drafts/[draftId]/route.ts
    const unitPriceCents =
      product.priceCents +
      (option?.priceAdjustmentCents ?? 0) +
      addOns.reduce((total, addOn) => total + addOn.priceCents, 0);
    subtotalCents += unitPriceCents * line.quantity;
```

Two call sites, same logic, no shared source. Extract `computeLineUnitPriceCents(product, option, addOns)` (and a `computeSubtotalCents` reducer) into `domain/order-engine.ts` so the client preview and the server source-of-truth cannot diverge. This is exactly the "type/schema drift" / duplicated-logic category the rules call out.

### F3. `getAvailableQuantity` not reused on the write path
`lib/storefront.ts` already exports `getAvailableQuantity` (used by `catalog/page.tsx` and `order/page.tsx`), but the PATCH draft route re-implements the math inline twice — once for the product, once for add-ons — and without the `Math.max(0, …)` floor or the `tracksInventory ? null : …` contract:

```103:108:src/app/api/order/drafts/[draftId]/route.ts
    const availableQuantity = product.tracksInventory
      ? (product.inventoryItem?.onHand ?? 0) - (product.inventoryItem?.reserved ?? 0)
      : null;
    if (availableQuantity !== null && line.quantity > availableQuantity) {
      throw new Error(`${product.name} has only ${Math.max(0, availableQuantity)} available.`);
    }
```

And again at lines 120-125 for add-ons. The add-on branch even reuses `getAvailableQuantity`'s sibling in `order/page.tsx:55-58` by passing a synthesized shape — proof the helper is the right abstraction. Reuse `getAvailableQuantity` on the server; do not re-derive. The inline version also drops the `Math.max(0, …)` floor that the shared helper enforces, so the two paths already disagree on negative stock.

### F4. `formatDraftReference` is dead code; drafts route uses an ad-hoc format
`domain/order-engine.ts:15-21` exports `formatDraftReference(sequence)` (pad to 8 digits, `D-` prefix). It has zero call sites outside its own file. Meanwhile `api/order/drafts/route.ts` invents its own reference:

```41:41:src/app/api/order/drafts/route.ts
      draftReference: `D-${randomInt(1, 100_000_000).toString().padStart(8, "0")}`,
```

Two ways to format a draft reference = pattern drift. Either delete `formatDraftReference` (if the random form is intentional) or call it from the route. As written, the helper is dead code and the route's format is unverified.

### F5. `order-builder.tsx` is a god file (486 lines, mixed concerns)
486 lines and four concerns in one component: draft lifecycle (create / restore / autosave / version ref / localStorage), line CRUD, subtotal memo, and the full cart + recipient-assignment JSX. The rules say split when `>500 lines, mixed concerns, or a refactor command` — this file trips two of three and will cross 500 on the next feature. Extract:
- `useDraftPersistence(initialDraftId)` hook → owns `draftId`, `draftVersion`, `ensureDraft`, `saveDraft`, localStorage restore.
- `useOrderLines()` hook → owns `lines`, `addProduct`, `updateLine`, remove.
- `CartLineCard` component → the per-line `<article>` (lines 282-419).
- `CartAside` component → the cart shell + subtotal.

Each new file has a single concern; none is a size-only split.

### F6. Duplicated draft-access resolution
`api/account/addresses/route.ts:12-17` and `api/account/addresses/[addressId]/route.ts:18-22` both implement "authenticated customer, else fall back to `findAccessibleDraft(request, draftId).customerId`":

```12:17:src/app/api/account/addresses/route.ts
async function resolveCustomerId(request: Request, draftId?: string) {
  const account = await getAuthenticatedCustomer();
  if (account?.customerId) return account.customerId;
  if (!draftId) return null;
  return (await findAccessibleDraft(request, draftId))?.customerId ?? null;
}
```

The `[addressId]` route inlines a narrower version. Extract `resolveCustomerId(request, draftId?)` into `lib/customer-access.ts` and use it from both routes — the rule-of-2 is met and the two will otherwise drift on the guest-vs-authenticated policy.

### F7. Magic string `"US"` repeated
`"US"` appears as a literal default in `recipient-address-dialog.tsx:75` (`countryCode: "US"`), `domain/customer-address.ts:39` and `:53` (`(address.countryCode ?? "US")`), and the dialog hardcodes it for every new address. Define `const DEFAULT_COUNTRY = "US"` in `domain/customer-address.ts` and import it. Minor, but it is a magic value with a domain meaning and three call sites.

### F8. `STORAGE_KEY` embeds a phase name
```59:59:src/components/order-builder.tsx
const STORAGE_KEY = "tomchei-p4-draft";
```
The `p4` segment is a change-explanation artifact — the storage key is a long-lived client contract and will outlive this phase. Rename to `tomchei-order-draft` (or `tomchei-cart-draft`). Migrating existing keys is out of scope; flag for the next schema bump.

### F9. `geocodeProvider` magic string + `geocodedAt = new Date()` masquerading as geocode
```56:57:src/domain/customer-address.ts
    geocodedAt: new Date(),
    geocodeProvider: "server-postal-validation",
```
Two issues: (a) `"server-postal-validation"` is a magic string repeated at the write site and rendered in `account/addresses/page.tsx:35-37`; pull it into a constant. (b) Setting `geocodedAt = new Date()` on every save — including pure label edits — claims a geocode happened when only postal regex ran. This is the "no defensive/just-in-case code" and "error messages say what the expected state was" spirit: the field asserts a fact the code did not establish. Either gate `geocodedAt` on actual geocoding or rename the provider to `postal-format` and leave `geocodedAt` null until a real geocode runs.

---

## Summary

9 findings. Highest-impact: F2 and F3 (client/server logic drift on money and stock), F4 (dead helper + ad-hoc duplicate), F5 (god file at the threshold). F1/F6 are straightforward Rule-of-2 extractions. F7/F8/F9 are naming/magic-value cleanups. No findings against comment quality, naming of banned words, or error-handling — those areas are clean in the P4 surface.
