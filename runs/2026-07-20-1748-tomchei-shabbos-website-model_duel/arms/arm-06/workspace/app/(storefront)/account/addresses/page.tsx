import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireCustomer } from "@/lib/customers/session";
import { addressSummary } from "@/lib/customers/addresses";
import { AddressBook } from "./address-book";

export const metadata: Metadata = { title: "Saved addresses" };
export const dynamic = "force-dynamic";

// R-043: the account address book — every saved address with add/edit/delete.
// Mid-order edits (R-029) hit the same API as this page.
export default async function AddressesPage() {
  const ctx = await requireCustomer();

  const addresses = await prisma.address.findMany({
    where: { customerId: ctx.customer.id },
    orderBy: [{ label: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="max-w-2xl" data-account-addresses>
      <h2 className="text-lg font-semibold text-stone-900">Address book</h2>
      <p className="mt-1 text-sm text-stone-600">
        One book for every recipient you ship to. New recipients you add while ordering land here
        automatically.
      </p>
      <AddressBook
        initialAddresses={addresses.map((address) => ({
          id: address.id,
          label: address.label,
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          region: address.region,
          postalCode: address.postalCode,
          country: address.country,
          summary: addressSummary(address),
        }))}
      />
    </div>
  );
}
