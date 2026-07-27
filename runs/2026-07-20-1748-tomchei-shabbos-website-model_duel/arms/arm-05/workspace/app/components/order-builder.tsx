"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/foundation";
import { isProductAvailable } from "@/lib/inventory";

type Address = {
  id: string;
  label: string | null;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  options: { id: string; name: string; value: string; priceAdjustmentCents: number }[];
  inventoryItems: { quantityOnHand: number; quantityReserved: number }[];
  restrictedAddons: {
    id: string;
    addOnProduct: { id: string; name: string; priceCents: number; isActive: boolean; inventoryItems: { quantityOnHand: number; quantityReserved: number }[] };
  }[];
};

type Recipient =
  | { kind: "self"; addressId?: string }
  | { kind: "saved"; addressId: string }
  | { kind: "new"; recipientName: string; line1: string; line2?: string; city: string; state: string; postalCode: string; label?: string };

type PersistedCartLine = {
  productId: string;
  quantity: number;
  productOptionId?: string;
  addOns: { productAddOnId: string; quantity: number }[];
  recipient: Recipient;
};

type CartLine = PersistedCartLine & { lineId: string };

type Draft = {
  id: string;
  subtotalCents: number;
  totalCents: number;
  wireFormat: { lines?: PersistedCartLine[] };
  addresses: Address[];
};

const storageKey = "tomchei-order-draft";

function withLineIds(lines: PersistedCartLine[]) {
  return lines.map((line) => ({ ...line, lineId: crypto.randomUUID() }));
}

function defaultRecipient(addresses: Address[]): Recipient {
  return addresses[0] ? { kind: "self", addressId: addresses[0].id } : {
    kind: "new",
    recipientName: "",
    line1: "",
    city: "",
    state: "NY",
    postalCode: "",
  };
}

export function OrderBuilder({ products }: { products: Product[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [message, setMessage] = useState("Preparing your saved cart…");
  const [isSaving, setIsSaving] = useState(false);

  const requestHeaders = useCallback(() => {
    const stored = sessionStorage.getItem(storageKey);
    const access = stored ? (JSON.parse(stored) as { token?: string }).token : undefined;
    return { "content-type": "application/json", ...(access ? { "x-draft-access-token": access } : {}) };
  }, []);

  const loadDraft = useCallback(async (draftId: string) => {
    const response = await fetch(`/api/order/drafts/${draftId}`, { headers: requestHeaders() });
    if (!response.ok) return null;
    const body = await response.json() as { draft: Draft };
    setDraft(body.draft);
    setLines(withLineIds(body.draft.wireFormat.lines ?? []));
    return body.draft;
  }, [requestHeaders]);

  useEffect(() => {
    void (async () => {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const restored = await loadDraft((JSON.parse(stored) as { id: string }).id);
        if (restored) {
          setMessage("Your draft was restored.");
          return;
        }
        sessionStorage.removeItem(storageKey);
      }
      const response = await fetch("/api/order/drafts", {
        method: "POST",
        headers: { "content-type": "application/json", origin: window.location.origin },
      });
      const body = await response.json() as { draft?: Draft; guestToken?: string; error?: string };
      if (!response.ok || !body.draft) {
        setMessage(body.error ?? "Unable to start an order.");
        return;
      }
      sessionStorage.setItem(storageKey, JSON.stringify({ id: body.draft.id, token: body.guestToken }));
      await loadDraft(body.draft.id);
      setMessage("Your draft is saved on this device.");
    })();
  }, [loadDraft]);

  const save = useCallback(async () => {
    if (!draft || lines.length === 0) return;
    setIsSaving(true);
    const response = await fetch(`/api/order/drafts/${draft.id}`, {
      method: "PUT",
      headers: { ...requestHeaders(), origin: window.location.origin },
      body: JSON.stringify({ lines }),
    });
    const body = await response.json() as { draft?: Draft; error?: string };
    setIsSaving(false);
    if (!response.ok || !body.draft) {
      setMessage(body.error ?? "Unable to save this draft.");
      return;
    }
    setDraft(body.draft);
    setLines((currentLines) => (body.draft?.wireFormat.lines ?? []).map((line, index) => ({
      ...line,
      lineId: currentLines[index]?.lineId ?? crypto.randomUUID(),
    })));
    setMessage("Draft saved.");
  }, [draft, lines, requestHeaders]);

  useEffect(() => {
    if (!draft || lines.length === 0) return;
    const timeout = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timeout);
  }, [draft, lines, save]);

  const total = useMemo(() => lines.reduce((sum, line) => {
    const product = products.find((candidate) => candidate.id === line.productId);
    if (!product) return sum;
    const option = product.options.find((candidate) => candidate.id === line.productOptionId);
    const addons = line.addOns.reduce((addonTotal, selected) => {
      const addon = product.restrictedAddons.find((candidate) => candidate.id === selected.productAddOnId)?.addOnProduct;
      return addonTotal + (addon?.priceCents ?? 0) * selected.quantity;
    }, 0);
    return sum + (product.priceCents + (option?.priceAdjustmentCents ?? 0) + addons) * line.quantity;
  }, 0), [lines, products]);

  function addProduct(product: Product) {
    const available = isProductAvailable(product);
    if (!available) return;
    setLines((cart) => [...cart, {
      lineId: crypto.randomUUID(),
      productId: product.id,
      quantity: 1,
      productOptionId: product.options[0]?.id,
      addOns: [],
      recipient: defaultRecipient(draft?.addresses ?? []),
    }]);
  }

  function changeLine(index: number, patch: Partial<CartLine>) {
    setLines((cart) => cart.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  return (
    <div className="order-layout">
      <section>
        <p className="eyebrow">Build your order</p>
        <h1>Choose gifts, then decide who receives each one.</h1>
        <p className="lead">Every item stays flexible until checkout. New recipients become part of your address book.</p>
        <p aria-live="polite" className="notice">{message}</p>
        <div className="catalog-grid">
          {products.map((product) => {
            const available = isProductAvailable(product);
            return (
              <article className="product-card" key={product.id}>
                <p className="eyebrow">Available {available ? "now" : "later"}</p>
                <h2>{product.name}</h2>
                <p>{product.description ?? "A Purim gift prepared with care."}</p>
                <strong>{formatMoney(product.priceCents)}</strong>
                <button className="button" disabled={!available} onClick={() => addProduct(product)} type="button">
                  {available ? "Add to cart" : "Sold out"}
                </button>
              </article>
            );
          })}
        </div>
        {lines.map((line, index) => {
          const product = products.find((candidate) => candidate.id === line.productId);
          if (!product) return null;
          return (
            <section className="card order-line" key={line.lineId}>
              <button className="close" aria-label={`Remove ${product.name}`} onClick={() => setLines((cart) => cart.filter((_, lineIndex) => lineIndex !== index))} type="button">×</button>
              <h2>{product.name}</h2>
              <label>Quantity
                <input min="1" max="100" onChange={(event) => changeLine(index, { quantity: Number(event.target.value) })} type="number" value={line.quantity} />
              </label>
              {product.options.length > 0 && <label>Option
                <select onChange={(event) => changeLine(index, { productOptionId: event.target.value })} value={line.productOptionId}>
                  {product.options.map((option) => <option key={option.id} value={option.id}>{option.name}: {option.value} ({option.priceAdjustmentCents >= 0 ? "+" : ""}{formatMoney(option.priceAdjustmentCents)})</option>)}
                </select>
              </label>}
              {product.restrictedAddons.length > 0 && <fieldset><legend>Available add-ons</legend>
                {product.restrictedAddons.map(({ id, addOnProduct }) => {
                  const selected = line.addOns.find((addon) => addon.productAddOnId === id);
                  return <label className="check-row" key={id}>
                    <input checked={Boolean(selected)} onChange={(event) => changeLine(index, {
                      addOns: event.target.checked
                        ? [...line.addOns, { productAddOnId: id, quantity: 1 }]
                        : line.addOns.filter((addon) => addon.productAddOnId !== id),
                    })} type="checkbox" />
                    {addOnProduct.name} (+{formatMoney(addOnProduct.priceCents)})
                  </label>;
                })}
              </fieldset>}
              <label>Send this gift to
                <select onChange={(event) => {
                  const kind = event.target.value as Recipient["kind"];
                  changeLine(index, { recipient: kind === "new" ? defaultRecipient([]) : kind === "saved" && draft?.addresses[0] ? { kind, addressId: draft.addresses[0].id } : defaultRecipient(draft?.addresses ?? []) });
                }} value={line.recipient.kind}>
                  <option value="self">Me / my saved address</option>
                  <option disabled={!draft?.addresses.length} value="saved">Someone in my address book</option>
                  <option value="new">A new recipient</option>
                </select>
              </label>
              {(line.recipient.kind === "self" || line.recipient.kind === "saved") && draft?.addresses.length ? <label>Address
                <select onChange={(event) => changeLine(index, { recipient: { kind: line.recipient.kind, addressId: event.target.value } as Recipient })} value={line.recipient.addressId}>
                  {draft.addresses.map((address) => <option key={address.id} value={address.id}>{address.recipientName} · {address.line1}, {address.city}</option>)}
                </select>
              </label> : null}
              {line.recipient.kind === "new" && <div className="address-fields">
                <label>Recipient<input onChange={(event) => changeLine(index, { recipient: { ...(line.recipient as Extract<Recipient, { kind: "new" }>), recipientName: event.target.value } })} value={line.recipient.recipientName} /></label>
                <label>Street address<input onChange={(event) => changeLine(index, { recipient: { ...(line.recipient as Extract<Recipient, { kind: "new" }>), line1: event.target.value } })} value={line.recipient.line1} /></label>
                <label>City<input onChange={(event) => changeLine(index, { recipient: { ...(line.recipient as Extract<Recipient, { kind: "new" }>), city: event.target.value } })} value={line.recipient.city} /></label>
                <label>State<input maxLength={2} onChange={(event) => changeLine(index, { recipient: { ...(line.recipient as Extract<Recipient, { kind: "new" }>), state: event.target.value } })} value={line.recipient.state} /></label>
                <label>ZIP code<input onChange={(event) => changeLine(index, { recipient: { ...(line.recipient as Extract<Recipient, { kind: "new" }>), postalCode: event.target.value } })} value={line.recipient.postalCode} /></label>
              </div>}
            </section>
          );
        })}
      </section>
      <aside className="cart-sidebar">
        <p className="eyebrow">Cart</p>
        <h2>{lines.length} {lines.length === 1 ? "gift" : "gifts"}</h2>
        <strong className="cart-total">{formatMoney(total)}</strong>
        <button className="button" disabled={lines.length === 0 || isSaving} onClick={() => void save()} type="button">{isSaving ? "Saving…" : "Save draft"}</button>
        <p>Checkout and payment open in the next step.</p>
      </aside>
      <button className="cart-fab" onClick={() => document.querySelector(".cart-sidebar")?.scrollIntoView({ behavior: "smooth" })} type="button">Cart · {formatMoney(total)}</button>
    </div>
  );
}
