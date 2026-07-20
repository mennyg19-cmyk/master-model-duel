import Link from "next/link";
import { getOpenSeason } from "@/lib/season";
import { getSetting } from "@/lib/settings";
import { ZipChecker } from "@/components/storefront/zip-checker";

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

  return (
    <main className="mx-auto max-w-3xl flex-1 px-6 py-16" data-store-state="open">
      <h1 className="text-2xl font-semibold">Start your {season.name} order</h1>
      <p className="mt-3 text-muted">
        The full order builder — cart, recipients, and greetings — ships in the next release.
        Meanwhile, browse the <Link href="/catalog" className="text-brand hover:underline">catalog</Link> and
        check whether we deliver to your recipients.
      </p>
      <ZipChecker />
    </main>
  );
}
