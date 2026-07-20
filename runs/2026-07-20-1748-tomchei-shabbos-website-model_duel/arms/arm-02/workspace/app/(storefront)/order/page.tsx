import Link from "next/link";
import { getOpenSeason } from "@/lib/season";
import { getSetting } from "@/lib/settings";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { getBuilderCatalog, priceCart, cartSchema } from "@/lib/order-builder/cart";
import { resolveDraftOwner, findActiveDraft } from "@/lib/order-builder/draft-store";
import { getCustomerAddressBook } from "@/lib/addresses/book";
import { OrderBuilder } from "@/components/builder/order-builder";

/**
 * Season closure is enforced here on the server (R-002): when no season is
 * open this page renders the closed notice and no ordering UI exists in the
 * response at all — nothing to bypass client-side.
 */
export default async function OrderPage() {
  const season = await getOpenSeason();

  if (!season) {
    const closedMessage = await getSetting("store.closed_message");
    return (
      <main className="mx-auto max-w-3xl flex-1 px-6 py-20 text-center" data-store-state="closed">
        <h1 className="text-2xl font-semibold">Ordering is closed</h1>
        <p className="mt-3 text-muted">{closedMessage}</p>
        <Link
          href="/collections"
          className="mt-6 inline-block rounded-md bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-strong"
        >
          Browse past collections
        </Link>
      </main>
    );
  }

  // Resume (R-022): the draft the request's cookies own, priced fresh.
  const [catalog, customer, owner] = await Promise.all([
    getBuilderCatalog(season.id),
    getCustomerContext(),
    resolveDraftOwner(),
  ]);
  const draft = await findActiveDraft(season.id, owner);
  const cart = draft ? cartSchema.parse(draft.cart) : null;
  const priced = cart ? await priceCart(season.id, cart) : null;
  const addressBook = customer ? await getCustomerAddressBook(customer.id) : [];

  return (
    <main className="flex flex-1" data-store-state="open">
      <OrderBuilder
        seasonName={season.name}
        catalog={catalog}
        initialCart={cart}
        initialPriced={priced}
        initialAddressBook={addressBook}
        isSignedIn={customer !== null}
      />
    </main>
  );
}
