"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@/lib/storefront/catalog-shared";
import { ProductPanel, type BuilderProduct } from "@/components/order/product-panel";
import { CartSidebar, type DraftState } from "@/components/order/cart-sidebar";
import { AssignDialog } from "@/components/order/assign-dialog";

export type BuilderMode = "storefront" | "pos";

type SavedAddress = {
  id: string;
  label: string | null;
  recipientName: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) {
    throw new Error(json.error?.message || json.error || res.statusText);
  }
  return json as T;
}

export function OrderBuilderShell({
  mode = "storefront",
  initialCustomerId = null,
  onDraftChange,
}: {
  mode?: BuilderMode;
  initialCustomerId?: string | null;
  onDraftChange?: (draft: DraftState | null) => void;
}) {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [products, setProducts] = useState<BuilderProduct[]>([]);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignLineId, setAssignLineId] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(Boolean(initialCustomerId));

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const refreshAddresses = useCallback(async () => {
    try {
      const data = await api<{ ok: true; addresses: SavedAddress[] }>("/api/addresses");
      setAddresses(data.addresses);
      setSignedIn(true);
    } catch {
      setAddresses([]);
    }
  }, []);

  const ensureDraft = useCallback(async () => {
    const existing = await api<{ ok: true; draft: DraftState | null }>("/api/drafts");
    if (existing.draft) {
      setDraft(existing.draft);
      return existing.draft;
    }
    const created = await api<{ ok: true; draft: DraftState }>("/api/drafts", {
      method: "POST",
      body: JSON.stringify({ guest: !signedIn }),
    });
    setDraft(created.draft);
    return created.draft;
  }, [signedIn]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [catalog] = await Promise.all([
          api<{ ok: true; products: BuilderProduct[] }>("/api/builder/catalog"),
          refreshAddresses(),
        ]);
        if (cancelled) return;
        setProducts(catalog.products);
        await ensureDraft();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureDraft, refreshAddresses]);

  async function addProduct(
    product: BuilderProduct,
    opts: { optionId?: string | null; addOnIds: string[]; quantity: number },
  ) {
    const current = draft ?? (await ensureDraft());
    const data = await api<{ ok: true; draft: DraftState }>(
      `/api/drafts/${current.draftRef}/lines`,
      {
        method: "POST",
        body: JSON.stringify({
          productId: product.id,
          productOptionId: opts.optionId,
          quantity: opts.quantity,
          addOnIds: opts.addOnIds,
        }),
      },
    );
    setDraft(data.draft);
    setMobileCartOpen(true);
  }

  async function assignLine(payload: {
    mode: "on_order" | "address_book" | "new_recipient";
    savedAddressId?: string;
    newRecipient?: Record<string, unknown>;
  }) {
    if (!draft || !assignLineId) return;
    const data = await api<{ ok: true; draft: DraftState }>(
      `/api/drafts/${draft.draftRef}/assign`,
      {
        method: "POST",
        body: JSON.stringify({ lineId: assignLineId, autoSaveNew: true, ...payload }),
      },
    );
    setDraft(data.draft);
    setAssignLineId(null);
    await refreshAddresses();
  }

  if (loading) {
    return (
      <div
        className="relative mx-auto flex max-w-6xl gap-6 px-4 py-16"
        data-testid="order-builder"
        data-builder-mode={mode}
      >
        <div className="min-w-0 flex-1 text-center text-sm" data-testid="builder-loading">
          Loading order builder…
        </div>
        <aside
          className="sticky top-24 hidden w-80 shrink-0 self-start lg:block"
          data-testid="cart-sidebar-desktop"
        />
        <button
          type="button"
          className="fixed bottom-5 right-5 z-40 flex h-14 items-center gap-2 rounded-full bg-[var(--color-leaf)] px-5 text-sm font-semibold text-white shadow-lg lg:hidden"
          data-testid="cart-fab"
          aria-hidden
        >
          Cart
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="builder-error">
        <p className="font-semibold text-red-700">{error}</p>
      </div>
    );
  }

  const lineCount = draft?.lineCount ?? 0;

  return (
    <div
      className="relative mx-auto flex max-w-6xl gap-6 px-4 py-8"
      data-testid="order-builder"
      data-builder-mode={mode}
    >
      <div className="min-w-0 flex-1">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-leaf)]">
            {mode === "pos" ? "POS builder" : "Cart-first order"}
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            Build your order
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink)]/70">
            Add packages and quantities first, then assign each line to a recipient.
          </p>
        </header>
        <ProductPanel products={products} onAdd={addProduct} />
      </div>

      {/* Desktop sidebar */}
      <aside
        className="sticky top-24 hidden w-80 shrink-0 self-start lg:block"
        data-testid="cart-sidebar-desktop"
      >
        <CartSidebar
          draft={draft}
          onAssign={(lineId) => setAssignLineId(lineId)}
          onRefresh={setDraft}
          checkoutMode={mode}
        />
      </aside>

      {/* Mobile FAB */}
      <button
        type="button"
        className="fixed bottom-5 right-5 z-40 flex h-14 items-center gap-2 rounded-full bg-[var(--color-leaf)] px-5 text-sm font-semibold text-white shadow-lg lg:hidden"
        data-testid="cart-fab"
        onClick={() => setMobileCartOpen(true)}
      >
        Cart
        <span className="rounded-full bg-white/20 px-2 py-0.5">{lineCount}</span>
        {draft ? (
          <span className="text-xs opacity-90">{formatCents(draft.subtotalCents)}</span>
        ) : null}
      </button>

      {mobileCartOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/40 lg:hidden"
          data-testid="cart-drawer"
          onClick={() => setMobileCartOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-auto rounded-t-2xl bg-[var(--color-cream)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Your cart</h2>
              <button type="button" className="text-sm" onClick={() => setMobileCartOpen(false)}>
                Close
              </button>
            </div>
            <CartSidebar
              draft={draft}
              onAssign={(lineId) => {
                setAssignLineId(lineId);
                setMobileCartOpen(false);
              }}
              onRefresh={setDraft}
              checkoutMode={mode}
            />
          </div>
        </div>
      ) : null}

      {assignLineId && draft ? (
        <AssignDialog
          addresses={addresses}
          signedIn={signedIn || addresses.length > 0}
          onClose={() => setAssignLineId(null)}
          onAssign={assignLine}
          onAddressesChange={refreshAddresses}
        />
      ) : null}
    </div>
  );
}
