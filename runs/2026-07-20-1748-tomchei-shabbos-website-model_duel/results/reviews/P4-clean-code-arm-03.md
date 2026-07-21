# Reviewer specialist — Clean-code

**Arm:** `arm-03`
**Tree / phase:** P4 — Cart-first order builder, address book, customer account (`arms/arm-03/workspace/`)
**Rules:** `arms/arm-03/rules/clean-code.md`
**Output:** `results/reviews/P4-clean-code-arm-03.md`

Scope: `src/components/order/*`, `src/components/account/account-dashboard.tsx`, `src/app/(storefront)/{order,account}/**`, `src/app/api/{drafts,addresses,account,builder}/**`, `src/lib/orders/{drafts,draft-access,draft-wire,guest-token,grouping,totals}.ts`, `src/lib/address/*`.

Focus: duplication, magic values, type drift, god files, error handling. Findings only.

---

## Findings — 11

### F1. `draftInclude` Prisma include object duplicated 3×
The identical `draftInclude` constant is copy-pasted in three files:

```13:26:src/lib/orders/drafts.ts
const draftInclude = {
  lines: {
    include: {
      product: { include: { inventory: true } },
      productOption: true,
      addOns: { include: { addOn: true } },
      savedAddress: true,
      fulfillmentMethod: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  customer: true,
  season: true,
};
```

Byte-identical copies live in `src/app/api/drafts/route.ts:12-25` and `src/app/api/drafts/[draftRef]/route.ts:11-24`. Rule-of-2 is met (3 sites). The next time a relation is added or a `where` clause changes on one copy, the other two silently drift — exactly the schema-drift category the rules call out. Export `draftInclude` from `lib/orders/drafts.ts` (or `draft-wire.ts`) and import it in both routes.

### F2. `addressSchema` zod object duplicated 3× (+ a 4th narrower variant)
The same address zod schema is repeated verbatim in three routes:

```8:19:src/app/api/addresses/route.ts
const schema = z.object({
  label: z.string().optional().nullable(),
  recipientName: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(2).max(2),
  postalCode: z.string().min(5),
  country: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});
```

Identical copies in `src/app/api/addresses/[id]/route.ts:10-21` and `src/app/api/drafts/[draftRef]/assign/route.ts:9-20`. A fourth, narrower variant (no `label`/`phone`/`isDefault`) sits in `src/app/api/addresses/autocomplete/route.ts:19-27`. Extract a shared `addressSchema` (and an `addressValidationSchema` subset) into `lib/address/schema.ts` and reuse from all four. Rule-of-2 met; four call sites guarantees drift otherwise.

### F3. `SavedAddress` client type defined 4× with drifting shapes
Four hand-rolled client types describe the same SavedAddress entity:

- `src/components/order/builder-shell.tsx:11-20` — `SavedAddress` (8 fields)
- `src/components/order/assign-dialog.tsx:6-15` — `SavedAddress` (identical 8 fields, copy-pasted)
- `src/components/account/account-dashboard.tsx:14-26` — `AccountPayload.addresses` (adds `latitude`/`longitude`/`geocodeStatus`/`addressNorm`)
- `src/app/(storefront)/account/addresses/page.tsx:7-20` — `Address` (yet another shape)

The first two are byte-identical; the latter two each drift a different subset. Centralize one `ClientSavedAddress` type (and an `AccountAddress` extension if the dashboard truly needs the geo fields) in `lib/address/types.ts` and import everywhere. This is the type/schema-drift category — the API returns one shape, the client redeclares it four times.

### F4. `"US"` magic string repeated 6× as the default country
`"US"` is inlined as the default country across the address/order domain:

- `src/lib/orders/drafts.ts:336` — `let country = "US";`
- `src/lib/address/normalize.ts:24` — `part(input.country ?? "US")`
- `src/lib/address/normalize.ts:37` — `const country = (input.country ?? "US")...`
- `src/lib/address/geocode.ts:21` — `(input.country ?? "US")...`
- `src/lib/orders/grouping.ts:29` — `normalizePart(input.country ?? "US")`
- `src/lib/orders/finalize.ts:148` — `country: head.country ?? "US"`

`src/lib/constants.ts` already exists but holds only `SETUP_LOCK_KEY`. Define `export const DEFAULT_COUNTRY = "US"` there and import it at all six sites. The value has domain meaning (the only supported country in P4) and a future country addition would require a six-site edit.

### F5. `void allowedIds;` — dead code with a lint-suppression
`src/lib/orders/drafts.ts:219-232`:

```219:232:src/lib/orders/drafts.ts
  const allowedIds = new Set(product.allowedAddOns.map((a) => a.addOnId));
  const addOnCreates: Array<{ addOnId: string; quantity: number; unitPriceCents: number }> = [];
  for (const addOnId of input.addOnIds ?? []) {
    const allow = product.allowedAddOns.find((a) => a.addOnId === addOnId);
    if (!allow || !allow.addOn.isActive) {
      return err("addon", "That add-on is not allowed on this product.");
    }
    // Restricted add-ons are allowed only when explicitly on the allow-list (already checked).
    addOnCreates.push({
      addOnId,
      quantity: 1,
      unitPriceCents: allow.addOn.priceCents,
    });
    void allowedIds;
  }
```

`allowedIds` is built but never read — the loop validates each add-on via `product.allowedAddOns.find(...)`. The trailing `void allowedIds;` exists solely to suppress the unused-variable lint. Per the anti-AI-tics rule ("no 'just in case' code — every line must have a reason") and the dead-code category, delete both the `Set` construction and the `void`.

### F6. `void AuthError;` — dead import in account order detail
`src/app/(storefront)/account/orders/[id]/page.tsx:3,32`:

```3:3:src/app/(storefront)/account/orders/[id]/page.tsx
import { AuthError } from "@/lib/auth";
```

```31:32:src/app/(storefront)/account/orders/[id]/page.tsx
  // Ownership already enforced by customerId filter (R-042).
  void AuthError;
```

`AuthError` is imported only to be `void`-ed; the comment is a narration/restatement of the `where: { id, customerId }` filter two lines above. Drop the import and the `void` line. If the intent was to document the ownership guarantee, the `findFirst({ where: { id, customerId } })` already conveys it.

### F7. Redundant nested ternary — staff and guest branches identical
`src/app/api/drafts/[draftRef]/assign/route.ts:35-40`:

```35:40:src/app/api/drafts/[draftRef]/assign/route.ts
    const customerId =
      actor.kind === "customer"
        ? actor.customerId
        : actor.kind === "staff"
          ? order.customerId
          : order.customerId;
```

The `staff` and `guest` branches both return `order.customerId`, so the inner ternary is dead logic. Collapse to `actor.kind === "customer" ? actor.customerId : order.customerId`. The staff-vs-guest distinction has no effect here; keeping it implies a difference that does not exist (anti-AI-tics: no copy-paste patterns with minor variations).

### F8. `assignDraftLine` copies 7 address fields field-by-field in 3 branches
`src/lib/orders/drafts.ts:339-398` sets `recipientName`/`addressLine1`/`addressLine2`/`city`/`state`/`postalCode`/`country`/`savedAddressId` in three sequential branches. The `address_book` branch (339-353) and the `on_order` branch (354-374) are near-identical: both destructure a `SavedAddress` row into the same eight locals. Extract `addressFieldsFromSaved(addr): { recipientName; addressLine1; addressLine2; city; state; postalCode; country; savedAddressId }` and call it from both branches; the `new_recipient` branch (375-397) differs enough to stay inline. Rule-of-2 met; the two saved-address branches will otherwise drift on the next field addition.

### F9. Double address validation in autocomplete POST
`src/app/api/addresses/autocomplete/route.ts:29-35`:

```29:35:src/app/api/addresses/autocomplete/route.ts
export async function POST(request: Request) {
  try {
    const body = validateSchema.parse(await request.json());
    const message = validateAddressInput(body);
    if (message) {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
```

Zod (`validateSchema.parse`) checks `recipientName`/`line1`/`city`/`state`/`postalCode`/`country`, then `validateAddressInput` (hand-rolled regexes in `lib/address/normalize.ts:31-40`) re-checks the same fields plus the US-only constraint. Two validators for one shape — same class as P3 F5 (double email validation). Pick one: either move the `STATE_RE`/`ZIP_RE`/US-only rules into `.refine`s on the shared zod schema (F2) and drop `validateAddressInput`, or keep `validateAddressInput` as the sole validator and reduce zod to a raw `.parse(z.object({ ... }))` shape check. Do not run both.

### F10. Vague name `quick` (repeat of P3 F10 in a new file)
`src/components/order/product-panel.tsx:43-46`:

```43:46:src/components/order/product-panel.tsx
  const quick = useMemo(
    () => products.find((p) => p.id === quickViewId) ?? null,
    [products, quickViewId],
  );
```

`quick` is on the naming-rule ban list (vague standalone name) and the P3 review already flagged the identical name in `catalog-browser.tsx:38`. It holds the currently-selected quick-view product. Rename to `quickViewProduct` for grepability and to match the surrounding `quickViewId` / `data-testid="builder-quick-view"` naming.

### F11. `normalizePart` / `part` — identical normalizer duplicated 2×
The same string normalizer is defined in two address modules under different names:

```16:18:src/lib/orders/grouping.ts
function normalizePart(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
```

```11:13:src/lib/address/normalize.ts
function part(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
```

Byte-identical bodies, different names. `src/lib/normalize.ts` already exists (it exports `normalizeEmail`) and is the natural home for a shared `normalizePart` helper. Rule-of-2 met; export once and import in both modules.

---

## Summary

11 findings. Severity counts:

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 5 (F1, F2, F3, F4, F8) |
| Low | 5 (F5, F6, F7, F9, F10) |
| Info | 1 (F11) |

Highest-impact: **F1** and **F2** (Prisma include + zod schema duplicated 3× each — guaranteed drift on the next schema change), **F3** (four client types for one SavedAddress entity), **F4** (`"US"` magic at six sites). F5/F6/F7 are dead-code / dead-logic cleanups (`void allowedIds`, `void AuthError`, identical ternary branches). F8 is a Rule-of-2 field-copy extraction. F9 is a double-validation repeat of P3 F5. F10 is a repeat naming offense from P3. F11 is a small normalizer duplication.

No god files in the P4 surface: `drafts.ts` (491 lines) is the largest file and is single-concern (draft lifecycle); `builder-shell.tsx` (260), `assign-dialog.tsx` (252), `account-dashboard.tsx` (248), and `product-panel.tsx` (220) are all under the 500-line threshold and split by concern. Error handling is consistent across P4 routes — all go through `apiErrorResponse` and the `Result`/`maskError` pattern from P2 is reused.
