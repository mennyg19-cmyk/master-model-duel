"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatCents } from "@/lib/catalog";
import { OrderBuilder } from "@/components/builder/order-builder";
import type { BuilderCatalog, Cart, PricedCart, SavedAddress } from "@/components/builder/types";
import { Card, CardTitle } from "@/components/ui/card";
import { CustomerPicker, type PosCustomer } from "@/components/admin/pos-customer-picker";
import { PosCheckout } from "@/components/admin/pos-checkout";

// POS (R-059..R-061, UR-006, UR-011): pick or create the customer, build the
// order in the SAME cart-first builder the storefront uses (staff draft
// endpoints), then take cash/check through the shared quote engine. Step
// screens live in their own files: pos-customer-picker.tsx, pos-checkout.tsx.

type PosDraft = { cart: Cart | null; priced: PricedCart | null; addressBook: SavedAddress[] };

export function PosClient({ seasonName, catalog }: { seasonName: string; catalog: BuilderCatalog }) {
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [draft, setDraft] = useState<PosDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderNumber: number | null; totalCents: number } | null>(null);

  async function selectCustomer(next: PosCustomer) {
    setLoadError(null);
    setDone(null);
    const result = await apiFetch<{ draft?: { priced: PricedCart & { cart: Cart } } | null; addressBook?: SavedAddress[] }>(
      `/api/admin/pos/draft?customerId=${encodeURIComponent(next.id)}`
    );
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setDraft({
      cart: result.body.draft?.priced.cart ?? null,
      priced: result.body.draft?.priced ?? null,
      addressBook: result.body.addressBook ?? [],
    });
    setCustomer(next);
  }

  function reset() {
    setCustomer(null);
    setDraft(null);
    setDone(null);
  }

  if (done) {
    return (
      <Card className="max-w-lg">
        <CardTitle className="mb-2">Order placed</CardTitle>
        <p className="text-sm">
          {done.orderNumber ? `Order #${done.orderNumber}` : "Order"} for {customer?.name} —{" "}
          {formatCents(done.totalCents)} collected.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          Next customer
        </button>
      </Card>
    );
  }

  if (!customer || !draft) {
    return <CustomerPicker onSelect={selectCustomer} error={loadError} />;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between rounded-md border border-border bg-surface px-4 py-2 text-sm">
        <span>
          Customer: <strong>{customer.name}</strong> ({customer.email})
        </span>
        <button type="button" onClick={reset} className="text-brand hover:underline">
          Switch customer
        </button>
      </div>
      <OrderBuilder
        key={customer.id}
        seasonName={seasonName}
        catalog={catalog}
        initialCart={draft.cart}
        initialPriced={draft.priced}
        initialAddressBook={draft.addressBook}
        isSignedIn
        mode="pos"
        draftUrl={`/api/admin/pos/draft?customerId=${encodeURIComponent(customer.id)}`}
        addressUrlFor={(addressId) =>
          `/api/admin/customers/${encodeURIComponent(customer.id)}/addresses/${encodeURIComponent(addressId)}`
        }
      />
      <PosCheckout
        customerId={customer.id}
        onDone={(summary) => setDone(summary)}
      />
    </div>
  );
}
