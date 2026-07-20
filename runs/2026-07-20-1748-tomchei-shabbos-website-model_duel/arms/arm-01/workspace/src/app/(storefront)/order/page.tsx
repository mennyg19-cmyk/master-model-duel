import Link from "next/link";
import { OrderBuilder } from "@/components/order-builder";
import { getAuthenticatedCustomer } from "@/lib/customer-access";
import { db } from "@/lib/db";
import { getDeliveryZips } from "@/lib/store-settings";
import { getAvailableQuantity, getCurrentSeason } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function OrderGatePage({
  searchParams,
}: {
  searchParams: Promise<{ zip?: string; draft?: string }>;
}) {
  const [{ zip, draft }, season, deliveryZips, account] = await Promise.all([
    searchParams,
    getCurrentSeason(),
    getDeliveryZips(),
    getAuthenticatedCustomer(),
  ]);
  const isOpen = season?.status === "OPEN";
  const isDeliveryZipAllowed = !zip || deliveryZips.includes(zip.trim());

  if (isOpen && isDeliveryZipAllowed && season) {
    const addresses = account?.customerId
      ? await db.customerAddress.findMany({
          where: { customerId: account.customerId },
          orderBy: [{ label: "asc" }, { recipientName: "asc" }],
        })
      : [];
    return (
      <main className="bg-[var(--cream)]">
        <OrderBuilder
          initialDraftId={draft}
          initialAddresses={addresses}
          isAuthenticated={Boolean(account?.customerId)}
          products={season.products.map((product) => ({
            id: product.id,
            name: product.name,
            description: product.description,
            category: product.category,
            imageUrl: product.imageUrl,
            priceCents: product.priceCents,
            availableQuantity: getAvailableQuantity(product),
            options: product.options.map((option) => ({
              id: option.id,
              value: option.value,
              priceAdjustmentCents: option.priceAdjustmentCents,
              isDefault: option.isDefault,
            })),
            addOns: product.allowedAddOns.map(({ addOn }) => ({
              id: addOn.id,
              name: addOn.name,
              priceCents: addOn.priceCents,
              availableQuantity: getAvailableQuantity({
                tracksInventory: addOn.tracksInventory,
                inventoryItem: addOn.addOnInventoryItem,
              }),
            })),
          }))}
        />
      </main>
    );
  }

  return (
    <main className="grid min-h-[60vh] place-items-center bg-[var(--cream)] px-5 py-20">
      <div className="max-w-xl rounded-[2rem] border border-[var(--border)] bg-white p-9 text-center shadow-xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
          Order access
        </p>
        {!isOpen ? (
          <>
            <h1 className="mt-4 text-3xl font-black">Ordering is closed</h1>
            <p className="mt-4 leading-7 text-[var(--muted)]">
              The {season?.year} season is browse-only. No order can be started
              while the season is closed.
            </p>
          </>
        ) : !isDeliveryZipAllowed ? (
          <>
            <h1 className="mt-4 text-3xl font-black">Delivery is unavailable to {zip}</h1>
            <p className="mt-4 leading-7 text-[var(--muted)]">
              That postal code is outside the current delivery area. This check
              uses the latest staff settings.
            </p>
          </>
        ) : null}
        <Link
          className="mt-7 inline-block rounded-full bg-[var(--ink)] px-6 py-3 font-bold text-white"
          href={isOpen ? "/catalog" : "/collections"}
        >
          {isOpen ? "Return to gifts" : "Browse the archive"}
        </Link>
      </div>
    </main>
  );
}
