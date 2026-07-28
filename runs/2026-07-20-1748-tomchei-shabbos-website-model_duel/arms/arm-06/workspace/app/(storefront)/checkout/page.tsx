import type { Metadata } from "next";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getSetting } from "@/lib/settings";
import { ClosedNotice } from "@/components/storefront/closed-notice";
import { ZipCheckForm } from "@/app/(storefront)/checkout/zip-check-form";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

// R-002 + G-014: closure enforcement on checkout plus the live delivery-ZIP
// probe. The ZIP check reads the manager's allowlist on every request, so
// settings edits take effect immediately (full checkout lands in P5).
export default async function CheckoutPage() {
  const openSeason = await getOpenSeason();
  if (!openSeason) {
    return <ClosedNotice attempted="Checkout" />;
  }

  const deliveryZips = (await getSetting("shipping.deliveryZips")) ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-stone-900">Checkout</h1>
      <p className="mt-4 text-stone-600">
        Payment and fulfillment arrive with the checkout release. You can already check whether an
        address is inside this season&apos;s delivery area.
      </p>
      <ZipCheckForm />
      <p className="mt-3 text-xs text-stone-500">
        Delivering to {deliveryZips.length} ZIP code{deliveryZips.length === 1 ? "" : "s"} this
        season.
      </p>
    </main>
  );
}
