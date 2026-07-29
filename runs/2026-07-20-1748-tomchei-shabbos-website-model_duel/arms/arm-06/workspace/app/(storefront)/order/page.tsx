import type { Metadata } from "next";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getCustomerContext } from "@/lib/customers/session";
import { loadDraft } from "@/lib/orders/drafts";
import { readGuestDraftToken } from "@/lib/orders/guest-draft-cookie";
import { loadBookAddresses, loadBuilderProducts } from "@/lib/storefront/builder-products";
import { ClosedNotice } from "@/components/storefront/closed-notice";
import { BookAddress } from "@/components/order-builder/types";
import { recipientFromOrderRow } from "@/components/order-builder/recipients";
import { LoadedDraft, OrderBuilderShell } from "@/components/order-builder/order-builder-shell";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

// UR-006/R-019: the cart-first order builder. R-002's closure gate still runs
// first; catalog rows come from the same include as the storefront grid so
// stock math never drifts between browsing and building (R-020).
export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const openSeason = await getOpenSeason();
  if (!openSeason) {
    return <ClosedNotice attempted="Ordering" />;
  }

  const { draft: draftRef } = await searchParams;
  const customerCtx = await getCustomerContext();

  // Continue-draft entry (account "continue" link, guest bookmark). Ownership
  // runs through loadDraft — a foreign or missing draft just starts empty.
  let initialDraft: LoadedDraft | null = null;
  if (draftRef) {
    const order = await loadDraft(draftRef, {
      customerId: customerCtx?.customer.id,
      guestToken: await readGuestDraftToken(draftRef),
    });
    if (order) {
      initialDraft = {
        draftRef,
        recipients: order.recipients.map(recipientFromOrderRow),
        lines: order.lines
          .filter((line) => line.productId !== null)
          .map((line) => ({
            clientId: line.id,
            productId: line.productId!,
            optionValueId: line.optionValueId,
            qty: line.qty,
            addOnIds: order.lines
              .filter((child) => child.parentLineId === line.id && child.addOnId)
              .map((child) => child.addOnId!),
            recipientClientId: line.recipientId,
          })),
      };
    }
  }

  const builderProducts = await loadBuilderProducts(openSeason.id);

  let bookAddresses: BookAddress[] = [];
  if (customerCtx) {
    bookAddresses = await loadBookAddresses(customerCtx.customer.id);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Build your order</h1>
        <p className="mt-1 text-sm text-stone-600">
          Add packages to your cart first, then assign each one to a recipient — yourself, someone from
          your address book, or someone new.
        </p>
      </div>
      <OrderBuilderShell
        products={builderProducts}
        bookAddresses={bookAddresses}
        viewer={
          customerCtx
            ? { kind: "customer", name: customerCtx.customer.name, email: customerCtx.customer.email }
            : { kind: "guest" }
        }
        initialDraft={initialDraft}
      />
    </main>
  );
}
