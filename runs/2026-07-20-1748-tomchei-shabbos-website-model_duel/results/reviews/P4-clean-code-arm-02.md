# Reviewer specialist — Clean-code

**Arm:** `arm-02`
**Tree / phase:** P4 — Cart-first order builder, address book, customer account (`arms/arm-02/workspace/`)
**Rules:** `arms/arm-02/rules/clean-code.md`
**Output:** `results/reviews/P4-clean-code-arm-02.md`

Focus: duplication, naming, god files, pattern drift. Findings only. Blind to model name.

---

## Findings — 16

### F1. [Medium] Duplicated `SavedAddress → AddressInput` mapping (Rule of 2 met)
The same "build an `AddressInput` from a saved address" object is hand-constructed in two places:

```154:164:arms/arm-02/workspace/components/builder/assignment-dialog.tsx
                      onClick={() => {
                        setEditingAddressId(address.id);
                        setEditDraft({
                          recipient: address.recipient,
                          label: address.label ?? undefined,
                          line1: address.line1,
                          line2: address.line2 ?? undefined,
                          city: address.city,
                          state: address.state,
                          zip: address.zip,
                        });
                        setErrorMessage(null);
                      }}
```

And `arms/arm-02/workspace/components/account/addresses-manager.tsx:26-34` (`startEdit`) builds the identical object. Extract `toAddressInput(address: SavedAddress): AddressInput` (next to `SavedAddress` in `components/builder/types.ts` or in `lib/addresses/normalize.ts`) and call it from both. Risk otherwise: a new field (e.g. `label` becoming required) gets updated in one and silently dropped in the other.

### F2. [Medium] Duplicated address display string (3 call sites)
The `{line1}{line2 ? `, ${line2}` : ""}, {city}, {state} {zip}` block is repeated three times:

```145:149:arms/arm-02/workspace/components/builder/assignment-dialog.tsx
                      <span className="text-xs text-muted">
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state}{" "}
                        {address.zip}
                      </span>
```

Also in `components/account/addresses-manager.tsx:94-96` and `app/(storefront)/account/orders/[id]/page.tsx:75-77`. Extract `formatAddressLine(address)` into `lib/addresses/normalize.ts` (or a `lib/addresses/format.ts`) and reuse. Three call sites is past the Rule-of-2 threshold and the next format tweak (e.g. adding country) will diverge across the builder, account, and order detail.

### F3. [Medium] Staff address PATCH inlines the field-map + geocode instead of reusing `updateAddressBookEntry`
`lib/addresses/book.ts` already exports `updateAddressBookEntry(addressId, input)` which recomputes the dedupe key, geocodes, and writes all seven fields. The customer PATCH route (`app/api/account/addresses/[id]/route.ts:30`) calls it. The staff PATCH route re-implements the same update inline:

```32:47:arms/arm-02/workspace/app/api/admin/customers/[id]/addresses/[addressId]/route.ts
      const row = await tx.customerAddress.update({
        where: { id: addressId },
        data: {
          normalizedKey: normalizedAddressKey(parsed.data),
          label: parsed.data.label,
          recipient: parsed.data.recipient,
          line1: parsed.data.line1,
          line2: parsed.data.line2,
          city: parsed.data.city,
          state: parsed.data.state,
          zip: parsed.data.zip,
          ...(coordinates
            ? { ...coordinates, geocodedAt: new Date() }
            : { latitude: null, longitude: null, geocodedAt: null }),
        },
      });
```

The audit log is the only legitimate addition; the field-mapping and geocode are duplicated. Call `updateAddressBookEntry` inside the transaction (it uses the default `db` client — pass a `tx`-capable variant, or refactor `updateAddressBookEntry` to accept a client) and then write the audit row. Two paths writing the same seven fields will drift the first time one side adds a column (e.g. `deliveryNotes`).

### F4. [Medium] Active-draft query duplicated in account pages instead of reusing `findActiveDraft`
`lib/order-builder/draft-store.ts` already exports `findActiveDraft(seasonId, owner)` for the exact "customer's ACTIVE draft for this season" lookup. The account pages re-query it inline:

```16:20:arms/arm-02/workspace/app/(storefront)/account/page.tsx
      ? db.orderDraft.findFirst({
          where: { customerId: customer.id, seasonId: season.id, status: "ACTIVE" },
          orderBy: { updatedAt: "desc" },
        })
      : null,
```

Also in `app/(storefront)/account/orders/page.tsx:18-22` (without the `orderBy`). The draft-store helper is the single source of truth for "what is an active draft" — including the guest case. The account pages bypass it and re-derive the customer-only filter, and the two copies already disagree on `orderBy`. Use `findActiveDraft(season.id, { kind: "customer", customerId: customer.id })` (and `resolveDraftOwner()` if the guest case should also surface here).

### F5. [Medium] "Get customer's address book" query duplicated (3+ sites)
The same `db.customerAddress.findMany({ where: { customerId }, orderBy: { updatedAt: "desc" } })` appears in:

```19:24:arms/arm-02/workspace/app/api/draft/route.ts
async function ownerAddressBook(customerId: string | null) {
  if (!customerId) return [];
  return db.customerAddress.findMany({
    where: { customerId },
    orderBy: { updatedAt: "desc" },
  });
}
```

Also in `app/(storefront)/order/page.tsx:43-48`, `app/(storefront)/account/addresses/page.tsx:7-10`, and `app/api/account/addresses/route.ts:9-12` (the last without `orderBy`). Extract `getCustomerAddressBook(customerId)` into `lib/addresses/book.ts` and call it everywhere. Four call sites, and the API route already diverges on sort order.

### F6. [Medium] DELETE responses not checked — swallowed failures
Two client-side delete paths fire-and-forget the response and refresh regardless of outcome:

```56:60:arms/arm-02/workspace/components/account/addresses-manager.tsx
  async function remove(addressId: string) {
    if (!confirm("Remove this recipient from your address book?")) return;
    await fetch(`/api/account/addresses/${addressId}`, { method: "DELETE" });
    router.refresh();
  }
```

And `components/account/draft-actions.tsx:16-18` (`cancelDraft`) does the same. If the DELETE 401s (session expired) or 404s (already gone), the UI still refreshes as if it succeeded — the user sees the row disappear from a stale cache and it comes back on next navigation. Check `response.ok`, surface an error message on failure. This is the "no swallowed errors" rule applied to fetch results, not just `catch` blocks.

### F7. [Medium] `SavedAddress` type hand-mirrors Prisma `CustomerAddress` (type drift risk)
`components/builder/types.ts` defines `SavedAddress` field-by-field:

```11:20:arms/arm-02/workspace/components/builder/types.ts
export type SavedAddress = {
  id: string;
  label: string | null;
  recipient: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
};
```

This is a manual mirror of the Prisma `CustomerAddress` model. The schema is the source of truth; if a column is added/renamed (e.g. `recipient` → `recipientName`), this type breaks silently and the client renders `undefined`. Derive it: `export type SavedAddress = Prisma.CustomerAddressGetPayload<{}>` (or a `Pick` of the fields actually sent client-side), colocated with the server query that produces it. Same concern applies to the hand-written `LiveStock` shape in the same file (lines 22-25) which mirrors the `/api/order-builder/stock` response without sharing a type.

### F8. [Medium] P2002 unique-error handling duplicated (customer + staff address routes)
Both address PATCH routes independently catch `Prisma.PrismaClientKnownRequestError` with code `P2002` and return a 409:

```32:37:arms/arm-02/workspace/app/api/account/addresses/[id]/route.ts
  try {
    const address = await updateAddressBookEntry(id, parsed.data);
    return Response.json({ address });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "You already have this exact address saved" }, { status: 409 });
    }
    throw error;
  }
```

And `app/api/admin/customers/[id]/addresses/[addressId]/route.ts:72-80` does the same with a slightly different message. Extract `handleUniqueViolation(error, message)` (or a `withDuplicateGuard(handler, message)` wrapper) into `lib/addresses/book.ts` or a `lib/db/errors.ts`. Two call sites today, more coming (P5 checkout will likely upsert addresses too).

### F9. [Low] `isComplete` mirrors `addressInputSchema` (client/server validation drift)
`assignment-dialog.tsx:54-62` re-implements the server's address validity rules by hand:

```54:62:arms/arm-02/workspace/components/builder/assignment-dialog.tsx
  function isComplete(address: AddressInput): boolean {
    return Boolean(
      address.recipient.trim() &&
        address.line1.trim() &&
        address.city.trim() &&
        address.state.trim().length === 2 &&
        /^\d{5}$/.test(address.zip)
    );
  }
```

The zip regex `/^\d{5}$/` and the `state.length === 2` rule are exactly what `addressInputSchema` in `lib/addresses/normalize.ts:11-16` encodes. If the server schema relaxes (e.g. ZIP+4, or state becomes optional), this client gate will keep rejecting valid input. `addressInputSchema` is pure Zod and bundle-safe for the client — import it and use `addressInputSchema.safeParse(address).success` for the "disable button" check, or share a `isAddressComplete` helper.

### F10. [Low] Magic numbers
- `components/builder/address-form.tsx:50` — debounce `250` ms (inline).
- `lib/addresses/autocomplete.ts:66` — `take: 5`; line 80 — `.slice(0, 8)`. Two different caps for the same "suggestion list size" concern.
- `lib/order-builder/cart.ts:19` — `.max(999)` (quantity); line 20 — `.max(20)` (optionIds); line 23 — `.max(20)` (addOns); line 25 — `.max(500)` (greeting); line 31 — `.max(200)` (lines). The `20` is duplicated across two unrelated fields.

The builder already shows the right pattern (`AUTOSAVE_DELAY_MS`, `STOCK_REFRESH_MS` in `order-builder.tsx:20-21`). Pull the cart limits into named constants (`MAX_LINE_QUANTITY`, `MAX_OPTIONS_PER_LINE`, etc.) and the autocomplete caps into `MAX_SAVED_SUGGESTIONS` / `MAX_TOTAL_SUGGESTIONS`.

### F11. [Low] Non-null `!` assertions rely on guards not visible at the call site
- `components/builder/assignment-dialog.tsx:66` — `onEditSavedAddress(editingAddressId!, editDraft)`. The `!` is sound only because `saveEditedAddress` is invoked from a button inside the `editingAddressId === address.id` branch. A future refactor that moves the button will silently break it.
- `app/(storefront)/account/page.tsx:11`, `account/orders/page.tsx:14`, `account/addresses/page.tsx:6`, `account/profile/page.tsx:7`, `account/orders/[id]/page.tsx:17` — `const customer = (await getCustomerContext())!;` relies on the layout's `if (!customer) redirect("/signin")` gate (R-038). The dependency is real but invisible at the page.

Both are "redundant assertions the compiler can't verify" — the rule explicitly calls these out. Prefer an explicit guard (`if (!editingAddressId) return;`) or, for the account pages, a small `requireCustomer()` helper that returns a non-nullable `CustomerContext` and throws/redirects otherwise, so the invariant is documented in code rather than in a comment.

### F12. [Low] `priceCart` approaches 3+ levels of nesting
`lib/order-builder/cart.ts:91-167` is a single `cart.lines.map` whose callback contains nested `for` loops over `line.optionIds` and `line.addOns`, each with conditionals and `issues.push`. The addOn branch alone is three levels deep (`map` → `for` → `if isRestricted` → `if trackInventory`). The rule: "if a function has more than 3 levels of nesting, refactor it." Extract `priceLine(line, ctx)` and `priceAddOns(line, addOnById, product)` helpers; the outer `map` then stays flat.

### F13. [Low] Active-draft query inconsistent `orderBy` across account pages
`account/page.tsx:18` uses `orderBy: { updatedAt: "desc" }`; `account/orders/page.tsx:19-21` omits `orderBy` entirely for the same query. Since a customer has at most one ACTIVE draft per season the difference is moot today, but it is pattern drift within the same feature — pick one and apply it (or, per F4, delete both in favor of `findActiveDraft`).

### F14. [Low] `updateAddressBookEntry` and the `update` branch of `saveToAddressBook` near-duplicate the field map
`lib/addresses/book.ts:15-36` (`saveToAddressBook`'s `update`) and lines 52-65 (`updateAddressBookEntry`) write the same seven fields plus `normalizedKey` plus the geocode spread. The only real difference is the `where` clause (unique-key upsert vs id update) and the geocode-on-null handling. Extract `addressWriteData(input)` returning the field map, and have both callers spread it. Saves a field-drift bug the next time a column is added.

### F15. [Low] Curly quotes in order detail greeting
`app/(storefront)/account/orders/[id]/page.tsx:78` uses typographic curly quotes around the greeting:

```78:78:arms/arm-02/workspace/app/(storefront)/account/orders/[id]/page.tsx
              {line.greeting && <p className="mt-1 text-xs italic text-muted">“{line.greeting}”</p>}
```

Every other string in the P4 surface uses straight ASCII quotes. Minor, but it is a UI-consistency drift — pick one quote style for user-facing punctuation.

### F16. [Low] `LOCAL_STREETS` and `ZIP_CENTROIDS` hardcoded as data inside source files
`lib/addresses/autocomplete.ts:16-30` embeds 13 Lakewood-area streets as a literal array; `lib/addresses/geocode.ts:9-14` embeds 4 ZIP centroids. Both are documented as local stand-ins for a real provider, which is fine — but they are domain data living in `.ts` source. When the provider swap happens, the data should move to a JSON/seed file and the code should just read it. Flagging now so the swap is "replace the data source" not "edit the source array."

---

## Summary

16 findings — **0 High, 8 Medium (F1–F8), 8 Low (F9–F16)**.

Highest-impact: F3 (staff route re-implements the customer update path — two writes to the same model will diverge), F4/F5 (account pages bypass existing `findActiveDraft` / address-book helpers — the helpers exist and aren't used), F6 (swallowed DELETE failures — user-visible correctness), F7 (`SavedAddress` hand-mirrors the Prisma model — silent breakage on schema change). F1/F2/F8 are straightforward Rule-of-2 extractions. The Low tier is naming, magic values, nesting, and minor consistency drift.

No findings against comment quality (comments are intent-focused, R-XXX-referenced, not narration), banned-name naming, god files (largest is `order-builder.tsx` at 268 lines), or empty catch blocks. The autosave race handling in `order-builder.tsx` (`pendingEditsRef` guard) is genuinely well-factored.
