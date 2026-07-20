"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/catalog";
import { Modal } from "@/components/ui/modal";
import { ProductPanel } from "@/components/builder/product-panel";
import { CartPanel } from "@/components/builder/cart-panel";
import { AssignmentDialog } from "@/components/builder/assignment-dialog";
import type { AddressInput } from "@/lib/addresses/normalize";
import type {
  BuilderCatalog,
  BuilderProduct,
  Cart,
  PricedCart,
  SavedAddress,
  LiveStock,
} from "@/components/builder/types";
import { emptyCart } from "@/components/builder/types";

const AUTOSAVE_DELAY_MS = 800;
const STOCK_REFRESH_MS = 30_000;

/**
 * The shared builder shell (R-019, R-031): cart-first — products and
 * quantities first, recipients per line after. The storefront mounts it here;
 * POS (P6) mounts the same shell with mode="pos".
 */
export function OrderBuilder({
  seasonName,
  catalog,
  initialCart,
  initialPriced,
  initialAddressBook,
  isSignedIn,
  mode = "storefront",
}: {
  seasonName: string;
  catalog: BuilderCatalog;
  initialCart: Cart | null;
  initialPriced: PricedCart | null;
  initialAddressBook: SavedAddress[];
  isSignedIn: boolean;
  mode?: "storefront" | "pos";
}) {
  const [cart, setCart] = useState<Cart>(initialCart ?? emptyCart());
  const [priced, setPriced] = useState<PricedCart | null>(initialPriced);
  const [addressBook, setAddressBook] = useState<SavedAddress[]>(initialAddressBook);
  const [stock, setStock] = useState<LiveStock | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [assigningLineId, setAssigningLineId] = useState<string | null>(null);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  // Autosave (R-022): every cart edit schedules a save; the newest edit wins.
  // pendingEdits guards against a slow response clobbering fresher local state.
  const pendingEditsRef = useRef(0);
  const cartRef = useRef(cart);
  cartRef.current = cart;

  const persistCart = useCallback(async () => {
    setSaveState("saving");
    const editsAtSend = pendingEditsRef.current;
    try {
      const response = await fetch("/api/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cartRef.current),
      });
      if (!response.ok) throw new Error(`Draft save failed with ${response.status}`);
      const body = await response.json();
      setPriced(body.draft.priced);
      setAddressBook(body.addressBook ?? []);
      // Adopt the server's cart (it rewrites new recipients into address-book
      // entries) only if nothing changed locally while the request flew.
      if (pendingEditsRef.current === editsAtSend) {
        setCart(body.draft.priced.cart);
        setSaveState("saved");
      }
    } catch {
      setSaveState("error");
    }
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    pendingEditsRef.current += 1;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(persistCart, AUTOSAVE_DELAY_MS);
  }, [persistCart]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // Live stock (R-020): refresh periodically and after every save.
  useEffect(() => {
    let cancelled = false;
    async function refreshStock() {
      const response = await fetch("/api/order-builder/stock");
      if (!response.ok || cancelled) return;
      setStock(await response.json());
    }
    refreshStock();
    const interval = setInterval(refreshStock, STOCK_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [saveState]);

  const updateCart = useCallback(
    (mutate: (current: Cart) => Cart) => {
      setCart((current) => mutate(current));
      scheduleSave();
    },
    [scheduleSave]
  );

  function addProduct(
    product: BuilderProduct,
    config: { quantity: number; optionIds: string[]; addOns: { addOnId: string; quantity: number }[] }
  ) {
    updateCart((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          id: crypto.randomUUID(),
          productId: product.id,
          quantity: config.quantity,
          optionIds: config.optionIds,
          addOns: config.addOns,
          greeting: "",
          assignment: null,
        },
      ],
    }));
  }

  function changeQuantity(lineId: string, quantity: number) {
    if (quantity < 1) {
      removeLine(lineId);
      return;
    }
    updateCart((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === lineId ? { ...line, quantity } : line)),
    }));
  }

  function removeLine(lineId: string) {
    updateCart((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.id !== lineId),
    }));
  }

  function assignLine(
    lineId: string,
    assignment: NonNullable<Cart["lines"][number]["assignment"]>,
    newOnOrderRecipient?: AddressInput
  ) {
    updateCart((current) => ({
      ...current,
      onOrderRecipient: newOnOrderRecipient ?? current.onOrderRecipient,
      lines: current.lines.map((line) => (line.id === lineId ? { ...line, assignment } : line)),
    }));
    setAssigningLineId(null);
  }

  // Mid-order saved-address edit (R-029). Returns an error message or null.
  async function editSavedAddress(addressId: string, address: AddressInput): Promise<string | null> {
    const response = await fetch(`/api/account/addresses/${addressId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(address),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) return body?.error ?? "Could not save the address";
    setAddressBook((current) =>
      current.map((entry) => (entry.id === addressId ? { ...entry, ...body.address } : entry))
    );
    return null;
  }

  // Merge live stock over the initial catalog snapshot.
  const stockByProduct = new Map((stock?.products ?? []).map((entry) => [entry.id, entry]));
  const stockByAddOn = new Map((stock?.addOns ?? []).map((entry) => [entry.id, entry]));
  const products = catalog.products.map((product) => {
    const live = stockByProduct.get(product.id);
    return live ? { ...product, soldOut: live.soldOut, available: live.available } : product;
  });
  const addOns = catalog.addOns.map((addOn) => {
    const live = stockByAddOn.get(addOn.id);
    return live ? { ...addOn, available: live.available } : addOn;
  });

  const assigningLine = cart.lines.find((line) => line.id === assigningLineId) ?? null;
  const itemCount = cart.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-8 sm:px-6" data-builder-mode={mode}>
      <section className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold">Build your {seasonName} order</h1>
        <p className="mt-1 mb-5 text-sm text-muted">
          Add packages and quantities first — then choose who each one goes to.
        </p>
        <ProductPanel products={products} addOns={addOns} onAdd={addProduct} />
      </section>

      {/* Desktop cart sidebar (R-030) */}
      <aside className="sticky top-20 hidden w-80 shrink-0 self-start rounded-lg border border-border bg-surface p-4 shadow-sm lg:block">
        <h2 className="mb-3 font-semibold">Your order</h2>
        <CartPanel
          cart={cart}
          priced={priced}
          addressBook={addressBook}
          saveState={saveState}
          onChangeQuantity={changeQuantity}
          onRemoveLine={removeLine}
          onOpenAssignment={setAssigningLineId}
        />
      </aside>

      {/* Mobile cart FAB (R-030) */}
      <button
        type="button"
        onClick={() => setCartDrawerOpen(true)}
        aria-label={`Open cart, ${itemCount} items`}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-brand px-5 py-3 font-semibold text-white shadow-lg lg:hidden"
        data-testid="cart-fab"
      >
        🛒 {itemCount}
        {priced && <span className="text-sm font-normal">{formatCents(priced.totalCents)}</span>}
      </button>

      {cartDrawerOpen && (
        <Modal title="Your order" onClose={() => setCartDrawerOpen(false)}>
          <CartPanel
            cart={cart}
            priced={priced}
            addressBook={addressBook}
            saveState={saveState}
            onChangeQuantity={changeQuantity}
            onRemoveLine={removeLine}
            onOpenAssignment={(lineId) => {
              setCartDrawerOpen(false);
              setAssigningLineId(lineId);
            }}
          />
        </Modal>
      )}

      {assigningLine && (
        <AssignmentDialog
          current={assigningLine.assignment}
          onOrderRecipient={cart.onOrderRecipient}
          otherOnOrderLineCount={
            cart.lines.filter(
              (line) => line.id !== assigningLine.id && line.assignment?.type === "onOrder"
            ).length
          }
          addressBook={addressBook}
          isSignedIn={isSignedIn}
          onAssign={(assignment, newOnOrderRecipient) =>
            assignLine(assigningLine.id, assignment, newOnOrderRecipient)
          }
          onEditSavedAddress={editSavedAddress}
          onClose={() => setAssigningLineId(null)}
        />
      )}
    </div>
  );
}
