"use client";

import { useCallback, useState } from "react";
import { formatCents } from "@/lib/catalog";
import { OrderBuilder } from "@/components/builder/order-builder";
import type { BuilderCatalog, Cart, PricedCart, SavedAddress } from "@/components/builder/types";
import { Card, CardTitle } from "@/components/ui/card";

// POS (R-059..R-061, UR-006, UR-011): pick or create the customer, build the
// order in the SAME cart-first builder the storefront uses (staff draft
// endpoints), then take cash/check through the shared quote engine.

type PosCustomer = { id: string; name: string; email: string; phone: string | null };

export function PosClient({ seasonName, catalog }: { seasonName: string; catalog: BuilderCatalog }) {
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [draft, setDraft] = useState<{ cart: Cart | null; priced: PricedCart | null; addressBook: SavedAddress[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderNumber: number | null; totalCents: number } | null>(null);

  async function selectCustomer(next: PosCustomer) {
    setLoadError(null);
    setDone(null);
    const response = await fetch(`/api/admin/pos/draft?customerId=${encodeURIComponent(next.id)}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setLoadError(body?.error ?? "Could not open a POS cart for this customer");
      return;
    }
    setDraft({
      cart: body.draft?.priced.cart ?? null,
      priced: body.draft?.priced ?? null,
      addressBook: body.addressBook ?? [],
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

function CustomerPicker({
  onSelect,
  error,
}: {
  onSelect: (customer: PosCustomer) => void;
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [searched, setSearched] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", email: "", phone: "" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/customers?q=${encodeURIComponent(query.trim())}`);
      const body = await response.json().catch(() => null);
      setResults(body?.customers ?? []);
      setSearched(true);
    } finally {
      setBusy(false);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name,
          email: createForm.email,
          phone: createForm.phone || undefined,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setCreateError(body?.error ?? "Could not create the customer");
        return;
      }
      onSelect(body.customer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      <Card>
        <CardTitle className="mb-3">Find customer</CardTitle>
        <form onSubmit={search} className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, email, or phone"
            className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-sm text-ink"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            Search
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <ul className="mt-3 space-y-1 text-sm">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                onClick={() => onSelect(result)}
                className="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-brand-soft"
              >
                <span className="font-medium">{result.name}</span>{" "}
                <span className="text-muted">
                  {result.email}
                  {result.phone ? ` · ${result.phone}` : ""}
                </span>
              </button>
            </li>
          ))}
          {searched && results.length === 0 && <li className="text-muted">No matches — create them on the right.</li>}
        </ul>
      </Card>

      <Card>
        <CardTitle className="mb-3">New walk-in customer</CardTitle>
        <form onSubmit={create} className="space-y-2 text-sm">
          <input
            required
            value={createForm.name}
            onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
            placeholder="Full name"
            className="w-full rounded-md border border-border bg-white px-3 py-1.5 text-ink"
          />
          <input
            required
            type="email"
            value={createForm.email}
            onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
            placeholder="Email"
            className="w-full rounded-md border border-border bg-white px-3 py-1.5 text-ink"
          />
          <input
            value={createForm.phone}
            onChange={(event) => setCreateForm({ ...createForm, phone: event.target.value })}
            placeholder="Phone (optional)"
            className="w-full rounded-md border border-border bg-white px-3 py-1.5 text-ink"
          />
          {createError && <p className="text-danger">{createError}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand px-4 py-1.5 font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            Create and start order
          </button>
        </form>
      </Card>
    </div>
  );
}

type PosQuote = {
  itemsCents: number;
  issues: string[];
  recipients: { key: string; recipientName: string; cityZip: string; rememberedGreeting: string | null }[];
  methods: { id: string; name: string; kind: string }[];
  purimDayChoices: string[];
  fees: { ok: true; feesCents: number; feeLines: { label: string; amountCents: number }[]; requiresDeliveryDay: boolean } | { ok: false; errors: string[] } | null;
};

function PosCheckout({
  customerId,
  onDone,
}: {
  customerId: string;
  onDone: (summary: { orderNumber: number | null; totalCents: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<PosQuote | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [deliveryDay, setDeliveryDay] = useState<string>("");
  const [greetingDefault, setGreetingDefault] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "CHECK">("CASH");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchQuote = useCallback(
    async (nextChoices: Record<string, string>, nextDeliveryDay: string) => {
      setError(null);
      const choiceList = Object.entries(nextChoices).map(([recipientKey, methodId]) => ({ recipientKey, methodId }));
      const response = await fetch("/api/admin/pos/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          choices: choiceList.length ? choiceList : null,
          deliveryDay: nextDeliveryDay || null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Quote failed");
        setQuote(null);
        return;
      }
      setQuote(body);
    },
    [customerId]
  );

  // Event-driven refetch: opening the panel and every choice/day change asks
  // the server for a fresh quote — no client-side fee math to drift.
  const updateChoices = (next: Record<string, string>) => {
    setChoices(next);
    fetchQuote(next, deliveryDay);
  };
  const updateDeliveryDay = (next: string) => {
    setDeliveryDay(next);
    fetchQuote(choices, next);
  };

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            fetchQuote(choices, deliveryDay);
          }}
          className="rounded-md bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-strong"
          data-testid="pos-checkout-open"
        >
          Continue to payment
        </button>
      </div>
    );
  }

  const feesOk = quote?.fees && quote.fees.ok ? quote.fees : null;
  const totalCents = quote ? quote.itemsCents + (feesOk?.feesCents ?? 0) : 0;
  const allChosen = quote ? quote.recipients.every((recipient) => choices[recipient.key]) : false;
  const needsDay = feesOk?.requiresDeliveryDay ?? false;

  async function submit() {
    if (!quote || !feesOk || !allChosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/pos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          choices: Object.entries(choices).map(([recipientKey, methodId]) => ({ recipientKey, methodId })),
          deliveryDay: deliveryDay || null,
          greetingDefault,
          expectedTotalCents: totalCents,
          payment: { method: payMethod, note: note || undefined },
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.error) {
        setError(body?.error ?? `Checkout failed (${response.status})`);
        if (body?.freshTotalCents) fetchQuote(choices, deliveryDay);
        return;
      }
      onDone({ orderNumber: body.orderNumber, totalCents: body.totalCents });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 max-w-3xl" data-testid="pos-checkout">
      <CardTitle className="mb-3">Payment</CardTitle>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {quote?.issues.length ? (
        <ul className="mb-2 list-disc pl-5 text-sm text-danger">
          {quote.issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      ) : null}

      {quote && (
        <>
          <div className="space-y-2 text-sm">
            {quote.recipients.map((recipient) => (
              <div key={recipient.key} className="flex items-center justify-between gap-3">
                <span>
                  {recipient.recipientName} <span className="text-muted">({recipient.cityZip})</span>
                </span>
                <select
                  value={choices[recipient.key] ?? ""}
                  onChange={(event) => updateChoices({ ...choices, [recipient.key]: event.target.value })}
                  className="rounded-md border border-border bg-white px-2 py-1 text-ink"
                >
                  <option value="">Choose delivery…</option>
                  {quote.methods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {needsDay && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-muted">Purim delivery day</span>
              <select
                value={deliveryDay}
                onChange={(event) => updateDeliveryDay(event.target.value)}
                className="rounded-md border border-border bg-white px-2 py-1 text-ink"
              >
                <option value="">Choose…</option>
                {quote.purimDayChoices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="mt-3 block text-sm">
            <span className="text-muted">Greeting (default for all packages)</span>
            <input
              value={greetingDefault}
              onChange={(event) => setGreetingDefault(event.target.value)}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-border bg-white px-3 py-1.5 text-ink"
            />
          </label>

          <div className="mt-3 border-t border-border pt-3 text-sm space-y-1">
            <p className="flex justify-between">
              <span className="text-muted">Items</span>
              <span>{formatCents(quote.itemsCents)}</span>
            </p>
            {feesOk?.feeLines.map((fee, index) => (
              <p key={index} className="flex justify-between">
                <span className="text-muted">{fee.label}</span>
                <span>{formatCents(fee.amountCents)}</span>
              </p>
            ))}
            {quote.fees && !quote.fees.ok && (
              <ul className="list-disc pl-5 text-danger">
                {quote.fees.errors.map((feeError, index) => (
                  <li key={index}>{feeError}</li>
                ))}
              </ul>
            )}
            <p className="flex justify-between font-semibold">
              <span>Total due</span>
              <span data-testid="pos-total">{formatCents(totalCents)}</span>
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-muted">
              Method
              <select
                value={payMethod}
                onChange={(event) => setPayMethod(event.target.value as "CASH" | "CHECK")}
                className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
              >
                <option value="CASH">Cash</option>
                <option value="CHECK">Check</option>
              </select>
            </label>
            <label className="flex flex-col text-xs text-muted">
              Note
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="Check #, drawer, etc."
                className="mt-1 w-48 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <button
              type="button"
              disabled={busy || !feesOk || !allChosen || (needsDay && !deliveryDay) || totalCents <= 0}
              onClick={submit}
              className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              data-testid="pos-take-payment"
            >
              Take {formatCents(totalCents)} {payMethod === "CASH" ? "cash" : "check"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
