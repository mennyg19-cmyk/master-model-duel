"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { BookAddress, BuilderProduct, CartLine, DraftState, PosConfig, ViewerContext } from "./types";
import { cartTotalCents, draftReducer, EMPTY_DRAFT } from "./draft-reducer";
import {
  linesPayload,
  readGuestDraft,
  recipientsPayload,
  useAutoSave,
  writeGuestDraft,
} from "./use-auto-save";
import { ProductPanel } from "./product-panel";
import { ProductQuickView } from "./product-quick-view";
import { CartPanel } from "./cart-panel";
import { OrderSidebar } from "./order-sidebar";
import { MobileCartFab } from "./mobile-cart-fab";
import { RecipientAssignDialog } from "./recipient-assign-dialog";
import { EditSavedAddressDialog } from "./edit-saved-address-dialog";
import { GuestIdentity, GuestIdentityDialog } from "./guest-identity-dialog";

export interface LoadedDraft extends DraftState {
  draftRef: string;
}

// R-019/R-030/R-031: the shared builder shell. Storefront mounts it with the
// signed-in viewer (or guest); POS mounts the same shell in P6 with a staff
// viewer and POS checkout — products/cart/recipients/autosave don't change.
export function OrderBuilderShell({
  products,
  bookAddresses: initialBookAddresses,
  viewer,
  initialDraft,
  pos,
}: {
  products: BuilderProduct[];
  bookAddresses: BookAddress[];
  viewer: ViewerContext;
  initialDraft: LoadedDraft | null;
  pos?: PosConfig;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(draftReducer, EMPTY_DRAFT);
  const [bookAddresses, setBookAddresses] = useState(initialBookAddresses);
  const [serverDraftRef, setServerDraftRef] = useState<string | null>(initialDraft?.draftRef ?? null);
  const [hydrated, setHydrated] = useState(Boolean(initialDraft));
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [quickViewProduct, setQuickViewProduct] = useState<BuilderProduct | null>(null);
  const [assigningLineId, setAssigningLineId] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState<BookAddress | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [guestIdentityOpen, setGuestIdentityOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Guest hydration: server draft in the URL wins; otherwise restore the
  // localStorage copy. Refresh restores either way (S2). The guest's access
  // token lives only in an httpOnly cookie — this client never sees it.
  useEffect(() => {
    if (hydrated) return;
    if (viewer.kind === "guest") {
      const stored = readGuestDraft();
      if (stored) {
        dispatch({
          type: "hydrate",
          state: { lines: stored.lines, recipients: stored.recipients },
        });
        if (stored.draftRef) setServerDraftRef(stored.draftRef);
      }
    }
    setHydrated(true);
  }, [hydrated, viewer.kind]);

  const { status: saveStatus } = useAutoSave({
    state,
    viewer,
    serverDraftRef,
    onSaved: ({ draftRef }) => setServerDraftRef(draftRef),
    saveUrl: pos?.saveUrl,
    bodyExtra: pos ? { customerId: pos.customerId } : undefined,
  });

  const addLine = useCallback((line: CartLine) => dispatch({ type: "add-line", line }), []);

  async function saveNow(extra?: { guest?: GuestIdentity }): Promise<{ draftRef: string }> {
    const saveResult = await apiFetch<{ draftRef?: string }>(pos?.saveUrl ?? "/api/drafts", {
      method: "POST",
      body: {
        ...(pos ? { customerId: pos.customerId } : {}),
        ...(serverDraftRef ? { draftRef: serverDraftRef } : {}),
        ...(extra?.guest ? { guest: extra.guest } : {}),
        lines: linesPayload(state),
        recipients: recipientsPayload(state.recipients),
      },
    });
    if (!saveResult.ok || !saveResult.body.draftRef) {
      throw new Error(saveResult.body.error ?? "Could not save the draft");
    }
    return { draftRef: saveResult.body.draftRef };
  }

  async function runCheckoutFlow(save: () => Promise<{ draftRef: string }>) {
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const { draftRef } = await save();
      setServerDraftRef(draftRef);
      const destination = pos ? pos.checkoutUrl : "/checkout";
      router.push(`${destination}?ref=${encodeURIComponent(draftRef)}`);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Checkout failed");
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function proceedToCheckout() {
    setCheckoutError(null);
    if (viewer.kind === "guest" && !serverDraftRef) {
      setGuestIdentityOpen(true);
      return;
    }
    await runCheckoutFlow(saveNow);
  }

  async function submitGuestIdentity(identity: GuestIdentity) {
    await runCheckoutFlow(async () => {
      const saved = await saveNow({ guest: identity });
      writeGuestDraft({ ...state, draftRef: saved.draftRef });
      setGuestIdentityOpen(false);
      return saved;
    });
  }

  const assigningLine = state.lines.find((line) => line.clientId === assigningLineId) ?? null;
  const assigningProduct = assigningLine
    ? products.find((product) => product.id === assigningLine.productId)
    : null;

  const cartPanel = (
    <CartPanel
      state={state}
      products={products}
      saveStatus={saveStatus}
      checkoutBusy={checkoutBusy}
      onSetQty={(clientId, qty) => dispatch({ type: "set-qty", clientId, qty })}
      onRemoveLine={(clientId) => dispatch({ type: "remove-line", clientId })}
      onAssign={(clientId) => setAssigningLineId(clientId)}
      onRemoveRecipient={(clientId) => dispatch({ type: "remove-recipient", clientId })}
      onCheckout={proceedToCheckout}
    />
  );

  return (
    <div className="flex gap-8" data-order-builder>
      <div className="min-w-0 flex-1">
        <ProductPanel
          products={products}
          activeCategory={activeCategory}
          onCategory={setActiveCategory}
          onQuickView={setQuickViewProduct}
        />
      </div>

      <OrderSidebar>{cartPanel}</OrderSidebar>
      <MobileCartFab
        itemCount={state.lines.reduce((sum, line) => sum + line.qty, 0)}
        totalCents={cartTotalCents(state, products)}
        isOpen={cartOpen}
        onOpen={() => setCartOpen(true)}
        onClose={() => setCartOpen(false)}
      >
        {cartPanel}
      </MobileCartFab>

      {quickViewProduct && (
        <ProductQuickView
          product={quickViewProduct}
          onAdd={addLine}
          onClose={() => setQuickViewProduct(null)}
        />
      )}

      {assigningLine && assigningProduct && (
        <RecipientAssignDialog
          lineLabel={assigningProduct.name}
          currentRecipientId={assigningLine.recipientClientId}
          recipients={state.recipients}
          bookAddresses={bookAddresses}
          isCustomer={viewer.kind === "customer"}
          onAssign={(recipientClientId) =>
            dispatch({ type: "assign-recipient", clientId: assigningLine.clientId, recipientClientId })
          }
          onRecipientCreated={(recipient) => dispatch({ type: "upsert-recipient", recipient })}
          onEditAddress={(address) => setEditingAddress(address)}
          onClose={() => setAssigningLineId(null)}
        />
      )}

      {editingAddress && (
        <EditSavedAddressDialog
          address={editingAddress}
          onSaved={(updated) =>
            setBookAddresses((addresses) =>
              addresses.map((address) => (address.id === updated.id ? updated : address)),
            )
          }
          onClose={() => setEditingAddress(null)}
        />
      )}

      {guestIdentityOpen && (
        <GuestIdentityDialog
          busy={checkoutBusy}
          error={checkoutError}
          onSubmit={submitGuestIdentity}
          onClose={() => setGuestIdentityOpen(false)}
        />
      )}

      {checkoutError && !guestIdentityOpen && (
        <p className="fixed bottom-5 left-5 z-40 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg" role="alert">
          {checkoutError}
        </p>
      )}
    </div>
  );
}
