import { notFound } from "next/navigation";
import { getAuthenticatedCustomer } from "@/lib/customer-access";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AccountAddressesPage() {
  const account = await getAuthenticatedCustomer();
  if (!account?.customerId) notFound();
  const addresses = await db.customerAddress.findMany({
    where: { customerId: account.customerId },
    orderBy: [{ label: "asc" }, { recipientName: "asc" }],
  });

  return (
    <div>
      <h1 className="text-4xl font-black">Address book</h1>
      <p className="mt-2 text-[var(--muted)]">
        New recipients from an order are saved here automatically.
      </p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        {addresses.map((address) => (
          <article className="rounded-2xl border border-[var(--border)] bg-white p-5" key={address.id}>
            <p className="text-sm font-bold uppercase tracking-wide text-[var(--brand)]">
              {address.label ?? "Recipient"}
            </p>
            <h2 className="mt-2 text-xl font-black">{address.recipientName}</h2>
            <address className="mt-2 not-italic leading-6 text-[var(--muted)]">
              {address.line1}
              {address.line2 && <><br />{address.line2}</>}
              <br />
              {address.city}, {address.region} {address.postalCode}
            </address>
            <p className="mt-3 text-xs font-semibold text-[var(--muted)]">
              {address.geocodeProvider
                ? `Validated by ${address.geocodeProvider}`
                : "Validation pending"}
            </p>
          </article>
        ))}
        {addresses.length === 0 && (
          <p className="rounded-2xl bg-white p-8 text-center text-[var(--muted)]">
            No saved recipients yet.
          </p>
        )}
      </div>
    </div>
  );
}
