import Link from "next/link";
import { OrderBuilder } from "@/components/order-builder";
import { PosCustomerCreator } from "@/components/pos-customer-picker";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAvailableQuantity, getCurrentSeason } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; customerId?: string }>;
}) {
  await requirePermission("payments:manage");
  const query = await searchParams;
  const [season, selectedCustomer, matches] = await Promise.all([
    getCurrentSeason(),
    query.customerId
      ? db.customer.findUnique({
          where: { id: query.customerId },
          include: { addresses: { orderBy: { recipientName: "asc" } } },
        })
      : null,
    query.q
      ? db.customer.findMany({
          where: {
            OR: [
              { displayName: { contains: query.q, mode: "insensitive" } },
              { email: { contains: query.q, mode: "insensitive" } },
              { phone: { contains: query.q, mode: "insensitive" } },
            ],
          },
          orderBy: [{ displayName: "asc" }, { id: "asc" }],
          take: 10,
        })
      : [],
  ]);
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Point of sale</p>
      <h1 className="mt-2 text-4xl font-black">Walk-in order</h1>
      <section className="mt-7 rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-bold">1. Find the customer</h2>
        <form className="mt-4 flex gap-3">
          <input className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-4 py-3" defaultValue={query.q} name="q" placeholder="Name, email, or phone" />
          <button className="rounded-xl border border-[var(--ink)] px-5 py-3 font-bold">Search</button>
        </form>
        {matches.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{matches.map((customer) => <Link className="rounded-full bg-[var(--brand-soft)] px-4 py-2 font-semibold" href={`/admin/pos?customerId=${customer.id}`} key={customer.id}>{customer.displayName}</Link>)}</div>}
        <div className="mt-5"><PosCustomerCreator /></div>
      </section>
      {selectedCustomer && season && (
        <section className="mt-8 overflow-hidden rounded-3xl border border-[var(--border)] bg-white">
          <div className="border-b border-[var(--border)] p-6"><h2 className="text-xl font-bold">2. Build order for {selectedCustomer.displayName}</h2><p className="text-sm text-[var(--muted)]">The same cart-first product, option, add-on, and recipient builder used online.</p></div>
          <OrderBuilder
            checkoutBasePath="/admin/pos/checkout"
            draftRequestBody={{ posCustomerId: selectedCustomer.id }}
            initialAddresses={selectedCustomer.addresses}
            isAuthenticated
            mode="pos"
            storageOwnerKey={`pos-${selectedCustomer.id}`}
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
        </section>
      )}
    </div>
  );
}
