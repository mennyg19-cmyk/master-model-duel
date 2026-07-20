"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BuilderProductCard,
  ProductQuickView,
} from "@/components/builder-product-card";
import {
  AddressPicker,
  RecipientAddressDialog,
} from "@/components/recipient-address-dialog";
import { formatCurrency } from "@/lib/currency";
import { getOrderDraftStorageKey } from "@/lib/order-draft-storage";

export type BuilderAddress = {
  id: string;
  label: string | null;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  version: number;
};

export type BuilderProduct = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  priceCents: number;
  availableQuantity: number | null;
  options: {
    id: string;
    value: string;
    priceAdjustmentCents: number;
    isDefault: boolean;
  }[];
  addOns: {
    id: string;
    name: string;
    priceCents: number;
    availableQuantity: number | null;
  }[];
};

type BuilderLine = {
  clientId: string;
  productId: string;
  productOptionId: string | null;
  addOnIds: string[];
  quantity: number;
  recipientAddressId: string | null;
  recipientSource: "ON_ORDER" | "ADDRESS_BOOK" | "NEW_RECIPIENT" | null;
};

function toBuilderLines(lines: {
  id: string;
  productId: string;
  productOptionId: string | null;
  quantity: number;
  recipientAddressId: string | null;
  recipientSource: BuilderLine["recipientSource"];
  addOns: { addOnProductId: string }[];
}[]) {
  return lines.map((line) => ({
    clientId: line.id,
    productId: line.productId,
    productOptionId: line.productOptionId,
    quantity: line.quantity,
    recipientAddressId: line.recipientAddressId,
    recipientSource: line.recipientSource,
    addOnIds: line.addOns.map((addOn) => addOn.addOnProductId),
  }));
}

export function OrderBuilder({
  products,
  initialAddresses,
  isAuthenticated,
  storageOwnerKey,
  initialDraftId = null,
  mode = "storefront",
}: {
  products: BuilderProduct[];
  initialAddresses: BuilderAddress[];
  isAuthenticated: boolean;
  storageOwnerKey: string;
  initialDraftId?: string | null;
  mode?: "storefront" | "pos";
}) {
  const [lines, setLines] = useState<BuilderLine[]>([]);
  const [addresses, setAddresses] = useState(initialAddresses);
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [draftVersion, setDraftVersion] = useState(1);
  const [saveState, setSaveState] = useState("Your draft saves automatically");
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [quickView, setQuickView] = useState<BuilderProduct | null>(null);
  const [addressDialog, setAddressDialog] = useState<{
    lineId: string;
    address: BuilderAddress | null;
    draftId: string | null;
  } | null>(null);
  const draftCreationRef = useRef<Promise<string> | null>(null);
  const draftVersionRef = useRef(1);
  const hasLoadedRef = useRef(false);
  const storageKey = getOrderDraftStorageKey(storageOwnerKey);

  useEffect(() => {
    const restoreTimer = window.setTimeout(async () => {
      window.localStorage.removeItem("tomchei-p4-draft");
      const persisted = !initialDraftId
        ? window.localStorage.getItem(storageKey)
        : null;
      let parsed: {
        draftId: string | null;
        draftVersion: number;
        lines: BuilderLine[];
      } | null = null;
      try {
        parsed = persisted ? JSON.parse(persisted) : null;
      } catch {
        window.localStorage.removeItem(storageKey);
      }

      const restoreDraftId = initialDraftId ?? parsed?.draftId;
      if (restoreDraftId) {
        try {
          const response = await fetch(`/api/order/drafts/${restoreDraftId}`);
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error ?? "Draft could not be restored.");
          }
          setDraftId(restoreDraftId);
          setDraftVersion(payload.order.version);
          draftVersionRef.current = payload.order.version;
          setLines(toBuilderLines(payload.order.lines));
          const addressResponse = await fetch(
            `/api/account/addresses?draftId=${encodeURIComponent(restoreDraftId)}`,
          );
          if (addressResponse.ok) {
            const addressPayload = await addressResponse.json();
            setAddresses(addressPayload.addresses);
          }
          setSaveState("Draft restored");
        } catch (error) {
          if (persisted) window.localStorage.removeItem(storageKey);
          setSaveState(
            error instanceof Error ? error.message : "Draft could not be restored.",
          );
        }
      } else if (parsed) {
        setLines(parsed.lines);
      }
      hasLoadedRef.current = true;
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [initialDraftId, storageKey]);

  async function ensureDraft() {
    if (draftId) return draftId;
    if (!draftCreationRef.current) {
      draftCreationRef.current = fetch("/api/order/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Draft could not be started.");
          setDraftId(payload.order.id);
          setDraftVersion(payload.order.version);
          draftVersionRef.current = payload.order.version;
          return payload.order.id as string;
        })
        .finally(() => {
          draftCreationRef.current = null;
        });
    }
    return draftCreationRef.current;
  }

  async function saveDraft(nextLines: BuilderLine[]) {
    setSaveState("Saving…");
    try {
      const currentDraftId = await ensureDraft();
      const sendUpdate = (version: number) =>
        fetch(`/api/order/drafts/${currentDraftId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lines: nextLines, version }),
        });
      let response = await sendUpdate(draftVersionRef.current);
      if (response.status === 409) {
        const latestResponse = await fetch(`/api/order/drafts/${currentDraftId}`);
        const latestPayload = await latestResponse.json();
        if (!latestResponse.ok) {
          throw new Error(latestPayload.error ?? "Draft could not be refreshed.");
        }
        draftVersionRef.current = latestPayload.order.version;
        setDraftVersion(latestPayload.order.version);
        response = await sendUpdate(latestPayload.order.version);
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Draft could not be saved.");
      setDraftVersion(payload.order.version);
      draftVersionRef.current = payload.order.version;
      setSaveState("Saved");
      return currentDraftId;
    } catch (error) {
      setSaveState(error instanceof Error ? error.message : "Draft could not be saved.");
      return null;
    }
  }

  async function continueToCheckout() {
    if (lines.some((line) => !line.recipientAddressId)) {
      setSaveState("Choose a recipient for every gift before checkout.");
      return;
    }
    const savedDraftId = await saveDraft(lines);
    if (savedDraftId) window.location.assign(`/checkout/${savedDraftId}`);
  }

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ draftId, draftVersion, lines }),
    );
    if (lines.length === 0) return;
    const timer = window.setTimeout(() => void saveDraft(lines), 500);
    return () => window.clearTimeout(timer);
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  function addProduct(product: BuilderProduct) {
    if (product.availableQuantity === 0) return;
    setLines((currentLines) => [
      ...currentLines,
      {
        clientId: crypto.randomUUID(),
        productId: product.id,
        productOptionId:
          product.options.find((option) => option.isDefault)?.id ??
          product.options[0]?.id ??
          null,
        addOnIds: [],
        quantity: 1,
        recipientAddressId: null,
        recipientSource: null,
      },
    ]);
  }

  function updateLine(clientId: string, changes: Partial<BuilderLine>) {
    setLines((currentLines) =>
      currentLines.map((line) =>
        line.clientId === clientId ? { ...line, ...changes } : line,
      ),
    );
  }

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

  return (
    <div className="mx-auto max-w-7xl px-5 py-10">
      <div className="mb-8 max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
          {mode === "pos" ? "Staff order" : "Build your Purim gifts"}
        </p>
        <h1 className="mt-3 font-serif text-4xl font-bold md:text-5xl">
          Pick gifts first. Choose recipients second.
        </h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          Stock updates live. Add every gift to your cart, then assign each one
          to someone already on this order, your address book, or a new recipient.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_390px]">
        <section>
          <div className="grid gap-5 sm:grid-cols-2">
            {products.map((product) => (
              <BuilderProductCard
                key={product.id}
                onAdd={() => addProduct(product)}
                onQuickView={() => setQuickView(product)}
                product={product}
              />
            ))}
          </div>
        </section>

        <aside
          className={`${isCartOpen ? "fixed inset-0 z-40 overflow-auto bg-[var(--cream)] p-5" : "hidden"} lg:sticky lg:top-5 lg:block lg:self-start lg:rounded-[2rem] lg:border lg:border-[var(--border)] lg:bg-white lg:p-6`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black">Your cart</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{saveState}</p>
            </div>
            <button
              className="rounded-full border border-[var(--border)] px-4 py-2 font-bold lg:hidden"
              onClick={() => setIsCartOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
          <div className="mt-6 space-y-5">
            {lines.map((line) => {
              const product = products.find((candidate) => candidate.id === line.productId);
              if (!product) return null;
              const onOrderAddresses = addresses.filter((address) =>
                lines.some(
                  (candidate) =>
                    candidate.clientId !== line.clientId &&
                    candidate.recipientAddressId === address.id,
                ),
              );
              return (
                <article
                  className="rounded-2xl border border-[var(--border)] p-4"
                  key={line.clientId}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold">{product.name}</h3>
                    <button
                      aria-label={`Remove ${product.name}`}
                      className="text-sm font-bold text-[var(--danger)]"
                      onClick={() =>
                        setLines((currentLines) =>
                          currentLines.filter((candidate) => candidate.clientId !== line.clientId),
                        )
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                  <label className="mt-4 block text-sm font-bold">
                    Quantity
                    <input
                      className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
                      max={product.availableQuantity ?? 99}
                      min="1"
                      onChange={(event) =>
                        updateLine(line.clientId, {
                          quantity: Math.max(1, Number(event.target.value)),
                        })
                      }
                      type="number"
                      value={line.quantity}
                    />
                  </label>
                  {product.options.length > 0 && (
                    <label className="mt-3 block text-sm font-bold">
                      Option
                      <select
                        className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
                        onChange={(event) =>
                          updateLine(line.clientId, {
                            productOptionId: event.target.value,
                          })
                        }
                        value={line.productOptionId ?? ""}
                      >
                        {product.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.value}
                            {option.priceAdjustmentCents
                              ? ` (+${formatCurrency(option.priceAdjustmentCents)})`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {product.addOns.map((addOn) => (
                    <label className="mt-3 flex gap-2 text-sm" key={addOn.id}>
                      <input
                        checked={line.addOnIds.includes(addOn.id)}
                        disabled={addOn.availableQuantity === 0}
                        onChange={(event) =>
                          updateLine(line.clientId, {
                            addOnIds: event.target.checked
                              ? [...line.addOnIds, addOn.id]
                              : line.addOnIds.filter((id) => id !== addOn.id),
                          })
                        }
                        type="checkbox"
                      />
                      {addOn.name} (+{formatCurrency(addOn.priceCents)})
                    </label>
                  ))}
                  <fieldset className="mt-5 border-t border-[var(--border)] pt-4">
                    <legend className="font-bold">Who receives this?</legend>
                    <select
                      aria-label={`Recipient source for ${product.name}`}
                      className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2"
                      onChange={(event) => {
                        const source = event.target.value as BuilderLine["recipientSource"];
                        if (source === "NEW_RECIPIENT") {
                          void ensureDraft().then((createdDraftId) =>
                            setAddressDialog({
                              lineId: line.clientId,
                              address: null,
                              draftId: createdDraftId,
                            }),
                          );
                        } else {
                          updateLine(line.clientId, {
                            recipientSource: source || null,
                            recipientAddressId: null,
                          });
                        }
                      }}
                      value={line.recipientSource ?? ""}
                    >
                      <option value="">Choose a source</option>
                      <option value="ON_ORDER">Already on this order</option>
                      <option value="ADDRESS_BOOK">My address book</option>
                      <option value="NEW_RECIPIENT">Add a new recipient</option>
                    </select>
                    {line.recipientSource === "ON_ORDER" && (
                      onOrderAddresses.length ? (
                        <AddressPicker
                          addresses={onOrderAddresses}
                          onChange={(recipientAddressId) =>
                            updateLine(line.clientId, { recipientAddressId })
                          }
                          onEdit={(address) =>
                            setAddressDialog({
                              lineId: line.clientId,
                              address,
                              draftId,
                            })
                          }
                          value={line.recipientAddressId}
                        />
                      ) : (
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          Assign another item to a recipient first.
                        </p>
                      )
                    )}
                    {line.recipientSource === "ADDRESS_BOOK" && (
                      <AddressPicker
                        addresses={addresses}
                        onChange={(recipientAddressId) =>
                          updateLine(line.clientId, { recipientAddressId })
                        }
                        onEdit={(address) =>
                          setAddressDialog({
                            lineId: line.clientId,
                            address,
                            draftId,
                          })
                        }
                        value={line.recipientAddressId}
                      />
                    )}
                  </fieldset>
                </article>
              );
            })}
            {lines.length === 0 && (
              <p className="rounded-2xl bg-[var(--surface)] p-6 text-center text-[var(--muted)]">
                Your cart is empty.
              </p>
            )}
          </div>
          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <div className="flex justify-between text-xl font-black">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotalCents)}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              Delivery, greetings, and secure payment continue in the next step.
              {isAuthenticated ? " This draft is linked to your account." : " Your guest access is protected by an expiring token."}
            </p>
            <button
              className="mt-5 w-full rounded-full bg-[var(--ink)] px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={lines.length === 0 || lines.some((line) => !line.recipientAddressId)}
              onClick={() => void continueToCheckout()}
              type="button"
            >
              Continue to checkout
            </button>
          </div>
        </aside>
      </div>

      <button
        className="fixed bottom-5 right-5 z-30 rounded-full bg-[var(--ink)] px-6 py-4 font-bold text-white shadow-2xl lg:hidden"
        onClick={() => setIsCartOpen(true)}
        type="button"
      >
        Cart ({lines.length}) · {formatCurrency(subtotalCents)}
      </button>

      {addressDialog && (
        <RecipientAddressDialog
          address={addressDialog.address}
          draftId={addressDialog.draftId}
          onClose={() => setAddressDialog(null)}
          onSaved={(address) => {
            setAddresses((currentAddresses) => {
              const hasAddress = currentAddresses.some(
                (candidate) => candidate.id === address.id,
              );
              return hasAddress
                ? currentAddresses.map((candidate) =>
                    candidate.id === address.id ? address : candidate,
                  )
                : [...currentAddresses, address];
            });
            updateLine(addressDialog.lineId, {
              recipientAddressId: address.id,
              recipientSource: addressDialog.address
                ? lines.find((line) => line.clientId === addressDialog.lineId)
                    ?.recipientSource
                : "NEW_RECIPIENT",
            });
            setAddressDialog(null);
          }}
        />
      )}
      {quickView && (
        <ProductQuickView
          onAdd={() => {
            addProduct(quickView);
            setQuickView(null);
          }}
          onClose={() => setQuickView(null)}
          product={quickView}
        />
      )}
    </div>
  );
}
